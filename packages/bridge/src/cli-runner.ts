import path from "node:path";

import {
  ERROR_CODES,
  EXTERNAL_HANDOFF_LIMITS,
  SpotPatchError,
} from "@spotpatch/shared";

import { serveClaudeChannelMcp } from "./active/claude/index.js";
import {
  CODEX_ADAPTER_ERROR_CODES,
  CodexAdapterError,
  connectCodexAppServer,
} from "./active/codex/index.js";
import {
  createActiveEventPump,
  type ActiveEventPumpEvent,
} from "./active/event-pump.js";
import { createSpotPatchBridgeClient } from "./client.js";
import { resolveExactProjectSessionId } from "./discovery.js";
import { serveSpotPatchMcp } from "./mcp.js";
import {
  applyBridgeSetupPlan,
  createBridgeSetupPlan,
  type BridgeCliAdapter,
} from "./setup.js";

export interface RunSpotPatchBridgeCliOptions {
  readonly adapter?: BridgeCliAdapter;
  readonly cwd?: string;
  readonly stderr?: Pick<NodeJS.WriteStream, "write">;
  readonly stdout?: Pick<NodeJS.WriteStream, "write">;
}

function optionValue(arguments_: readonly string[], name: string): string | undefined {
  const index = arguments_.indexOf(name);
  if (index === -1) return undefined;
  const value = arguments_[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
  }
  return value;
}

function allowedArguments(
  arguments_: readonly string[],
  booleanOptions: readonly string[],
  valueOptions: readonly string[],
): void {
  const allowed = new Set([...booleanOptions, ...valueOptions]);
  const seen = new Set<string>();

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === undefined || !allowed.has(argument) || seen.has(argument)) {
      throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
    }
    seen.add(argument);

    if (valueOptions.includes(argument)) {
      const value = arguments_[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
      }
      index += 1;
    }
  }
}

function exitCode(error: unknown): number {
  if (error instanceof CodexAdapterError) {
    if (error.code === CODEX_ADAPTER_ERROR_CODES.EXECUTABLE_UNTRUSTED) return 7;
    if (
      error.code === CODEX_ADAPTER_ERROR_CODES.MCP_NOT_READY ||
      error.code === CODEX_ADAPTER_ERROR_CODES.PROTOCOL ||
      error.code === CODEX_ADAPTER_ERROR_CODES.UNSUPPORTED_VERSION
    ) {
      return 6;
    }
    if (
      error.code === CODEX_ADAPTER_ERROR_CODES.BUSY ||
      error.code === CODEX_ADAPTER_ERROR_CODES.CLOSED ||
      error.code === CODEX_ADAPTER_ERROR_CODES.EXECUTABLE_NOT_FOUND ||
      error.code === CODEX_ADAPTER_ERROR_CODES.PROCESS_EXITED ||
      error.code === CODEX_ADAPTER_ERROR_CODES.REQUEST_TIMEOUT
    ) {
      return 8;
    }
    return 1;
  }

  if (!(error instanceof SpotPatchError)) return 1;

  if (error.code === ERROR_CODES.INVALID_REQUEST) return 2;
  if (error.code === ERROR_CODES.SESSION_NOT_FOUND) return 3;
  if (
    error.code === ERROR_CODES.HANDOFF_NOT_FOUND ||
    error.code === ERROR_CODES.HANDOFF_EXPIRED
  ) {
    return 4;
  }
  if (error.code === ERROR_CODES.SESSION_AMBIGUOUS) return 5;
  if (error.code === ERROR_CODES.BRIDGE_PROTOCOL_MISMATCH) return 6;
  if (error.code === ERROR_CODES.BRIDGE_UNAUTHORIZED) return 7;
  if (
    error.code === ERROR_CODES.SESSION_CLOSED ||
    error.code === ERROR_CODES.EXTERNAL_HANDOFF_UNAVAILABLE
  ) {
    return 8;
  }
  return 1;
}

function writeJson(
  stdout: Pick<NodeJS.WriteStream, "write">,
  command: string,
  data: unknown,
): void {
  stdout.write(`${JSON.stringify({ schemaVersion: 1, command, data })}\n`);
}

function usage(stderr: Pick<NodeJS.WriteStream, "write">): void {
  stderr.write(
    "Usage: spotpatch-bridge <sessions|current|wait|ack|mcp|channel|connect|setup> [options]\n",
  );
}

interface ProcessSignalScope {
  readonly interrupted: () => boolean;
  readonly remove: () => void;
}

function abortError(): Error {
  const error = new Error("The SpotPatch command was interrupted.");
  error.name = "AbortError";
  return error;
}

function abortableOperation<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise<T>((resolve, reject) => {
    const finish = (): void => {
      signal.removeEventListener("abort", abort);
    };
    const abort = (): void => {
      finish();
      reject(abortError());
    };

    signal.addEventListener("abort", abort, { once: true });
    void operation.then(
      (value) => {
        finish();
        resolve(value);
      },
      (error: unknown) => {
        finish();
        reject(
          error instanceof Error
            ? error
            : new Error("The SpotPatch operation failed.", { cause: error }),
        );
      },
    );
  });
}

function processSignalScope(onInterrupt: () => void): ProcessSignalScope {
  let interrupted = false;
  const interrupt = (): void => {
    if (interrupted) return;
    interrupted = true;
    onInterrupt();
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);

  return Object.freeze({
    interrupted: () => interrupted,
    remove() {
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", interrupt);
    },
  });
}

async function runClaudeChannel(
  cwd: string,
  sessionId: string | undefined,
): Promise<number> {
  let close: (() => Promise<void>) | undefined;
  const signals = processSignalScope(() => {
    void close?.();
  });

  try {
    const exactSessionId = await resolveExactProjectSessionId(cwd, sessionId);
    const handle = await serveClaudeChannelMcp({ cwd, sessionId: exactSessionId });
    close = handle.close;
    if (signals.interrupted()) await handle.close();
    await handle.done;
    return signals.interrupted() ? 130 : 0;
  } finally {
    signals.remove();
    await close?.().catch(() => undefined);
  }
}

function writeCodexConnectorEvent(
  event: ActiveEventPumpEvent,
  stderr: Pick<NodeJS.WriteStream, "write">,
): void {
  if (event.type === "ready") {
    stderr.write(
      "[spotpatch:bridge] Codex connected and ready for SpotPatch requests.\n",
    );
    return;
  }

  const revision = String(event.revision);
  switch (event.phase) {
    case "dispatching":
      stderr.write(
        `[spotpatch:bridge] SpotPatch is preparing revision ${revision} for Codex.\n`,
      );
      return;
    case "working":
      stderr.write(`[spotpatch:bridge] Codex started revision ${revision}.\n`);
      return;
    case "completed":
      stderr.write(
        `[spotpatch:bridge] Codex turn ended for revision ${revision}; review the workspace. Ready for the next request.\n`,
      );
      return;
    case "failed":
      stderr.write(
        `[spotpatch:bridge] Revision ${revision} failed before a verified Codex turn completed; review the connector output and workspace. Ready for the next request.\n`,
      );
      return;
    case "delivery-unknown":
      stderr.write(
        `[spotpatch:bridge] Codex delivery for revision ${revision} is unknown; the connector will stop.\n`,
      );
      return;
    case "dispatched":
      stderr.write(`[spotpatch:bridge] Codex accepted revision ${revision}.\n`);
      return;
  }
}

async function runCodexConnector(
  adapterKind: BridgeCliAdapter,
  cwd: string,
  stderr: Pick<NodeJS.WriteStream, "write">,
  sessionId: string | undefined,
): Promise<number> {
  const pumpController = new AbortController();
  const startupController = new AbortController();
  let fatalError: CodexAdapterError | undefined;
  const signals = processSignalScope(() => {
    startupController.abort("cli-interrupted");
    pumpController.abort("cli-interrupted");
  });

  try {
    const exactSessionId = await abortableOperation(
      resolveExactProjectSessionId(cwd, sessionId),
      startupController.signal,
    );
    stderr.write(
      "[spotpatch:bridge] Codex active mode injects SpotPatch MCP for this App Server thread without writing project setup, uses project workspace-write, disables sandbox command network, and never relays approvals. Existing enabled Codex MCP servers may also start. Starting App Server may persist this project as trusted in the user's Codex configuration. Keep this process running.\n",
    );
    const adapter = await connectCodexAppServer({
      allowWorkspaceWrite: true,
      bridgeAdapter: adapterKind,
      projectRoot: cwd,
      signal: startupController.signal,
      sessionId: exactSessionId,
      onFatal(error) {
        fatalError = error;
        pumpController.abort("codex-app-server-fatal");
      },
    });
    const pump = createActiveEventPump({
      adapter,
      client: createSpotPatchBridgeClient(cwd),
      onEvent(event) {
        writeCodexConnectorEvent(event, stderr);
      },
      sessionId: exactSessionId,
    });

    try {
      await pump.run(pumpController.signal);
    } finally {
      await pump.close().catch(() => undefined);
    }

    if (fatalError !== undefined) throw fatalError;
    return signals.interrupted() ? 130 : 0;
  } catch (error: unknown) {
    if (signals.interrupted()) return 130;
    throw error;
  } finally {
    signals.remove();
  }
}

export async function runSpotPatchBridgeCli(
  arguments_: readonly string[],
  options: RunSpotPatchBridgeCliOptions = {},
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const adapter = options.adapter ?? "bridge";
  const [command, ...rest] = arguments_;

  if (command === undefined) {
    usage(stderr);
    return 2;
  }

  try {
    if (command === "mcp") {
      allowedArguments(rest, [], ["--session"]);
      const requestedSessionId = optionValue(rest, "--session");
      const exactSessionId =
        requestedSessionId === undefined
          ? undefined
          : await resolveExactProjectSessionId(cwd, requestedSessionId);
      serveSpotPatchMcp(cwd, { sessionId: exactSessionId });
      return 0;
    }

    if (command === "channel") {
      if (rest[0] !== "claude") {
        throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
      }
      const channelArguments = rest.slice(1);
      allowedArguments(channelArguments, [], ["--session"]);
      return await runClaudeChannel(cwd, optionValue(channelArguments, "--session"));
    }

    if (command === "connect") {
      if (rest[0] !== "codex") {
        throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
      }
      const connectorArguments = rest.slice(1);
      allowedArguments(connectorArguments, ["--allow-workspace-write"], ["--session"]);
      if (!connectorArguments.includes("--allow-workspace-write")) {
        throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
      }
      return await runCodexConnector(
        adapter,
        cwd,
        stderr,
        optionValue(connectorArguments, "--session"),
      );
    }

    if (command === "setup") {
      allowedArguments(rest, ["--write"], ["--client", "--mode", "--scope"]);
      const client = optionValue(rest, "--client");
      const mode = optionValue(rest, "--mode") ?? "inbox";
      const scope = optionValue(rest, "--scope") ?? "project";

      if (
        scope !== "project" ||
        (mode !== "inbox" && mode !== "active") ||
        (mode === "active" && client !== "claude") ||
        (client !== "claude" && client !== "cursor" && client !== "codex")
      ) {
        throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
      }

      const plan = createBridgeSetupPlan(client, adapter, cwd, mode);
      const write = rest.includes("--write");
      const result = write ? await applyBridgeSetupPlan(plan) : "dry-run";
      const displayPath = path.relative(cwd, plan.path).split(path.sep).join("/");
      const backup =
        result === "updated" ? `Backup: ${displayPath}.spotpatch.bak\n` : "";
      stdout.write(
        `[spotpatch:bridge] ${result}: ${displayPath}\n${backup}${plan.content}`,
      );
      return 0;
    }

    const client = createSpotPatchBridgeClient(cwd);
    const json = rest.includes("--json");

    if (command === "sessions") {
      allowedArguments(rest, ["--json"], []);
      const sessions = await client.sessions();
      if (json) writeJson(stdout, command, { outcome: "sessions", sessions });
      else
        stdout.write(
          `[spotpatch:bridge] ${String(sessions.length)} active session(s).\n`,
        );
      return sessions.length === 0 ? 3 : 0;
    }

    if (command === "current") {
      allowedArguments(rest, ["--json"], ["--session"]);
      const result = await client.current(optionValue(rest, "--session"));
      if (json) writeJson(stdout, command, result);
      else if (result.outcome === "handoff") {
        stdout.write(
          `[spotpatch:bridge] revision ${String(result.snapshot.revision)} · ${String(result.snapshot.annotation.targets.length)} target(s).\n`,
        );
      } else {
        stdout.write(`[spotpatch:bridge] no current handoff (${result.reason}).\n`);
      }
      return result.outcome === "handoff" ? 0 : 4;
    }

    if (command === "wait") {
      allowedArguments(rest, ["--json"], ["--session", "--after", "--timeout"]);
      const timeoutText = optionValue(rest, "--timeout");
      const timeout = timeoutText === undefined ? undefined : Number(timeoutText);

      if (
        timeout !== undefined &&
        (!Number.isSafeInteger(timeout) ||
          timeout <= 0 ||
          timeout > EXTERNAL_HANDOFF_LIMITS.maximumWaitMs)
      ) {
        throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
      }

      const controller = new AbortController();
      const abort = (): void => {
        controller.abort("cli-interrupted");
      };
      process.once("SIGINT", abort);
      process.once("SIGTERM", abort);

      try {
        const result = await client.wait(
          optionValue(rest, "--session"),
          optionValue(rest, "--after"),
          timeout,
          controller.signal,
        );
        if (json) writeJson(stdout, command, result);
        else stdout.write(`[spotpatch:bridge] ${result.outcome}.\n`);
        return 0;
      } catch (error: unknown) {
        if (controller.signal.aborted) return 130;
        throw error;
      } finally {
        process.removeListener("SIGINT", abort);
        process.removeListener("SIGTERM", abort);
      }
    }

    if (command === "ack") {
      allowedArguments(rest, ["--json"], ["--session", "--cursor"]);
      const cursor = optionValue(rest, "--cursor");
      if (cursor === undefined) throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
      const summary = await client.ack(cursor, optionValue(rest, "--session"));
      const result = { outcome: "acknowledged" as const, summary };
      if (json) writeJson(stdout, command, result);
      else
        stdout.write(
          `[spotpatch:bridge] revision ${String(summary.revision)} acknowledged.\n`,
        );
      return 0;
    }

    usage(stderr);
    return 2;
  } catch (error: unknown) {
    const code =
      error instanceof SpotPatchError || error instanceof CodexAdapterError
        ? error.code
        : ERROR_CODES.INTERNAL_ERROR;
    stderr.write(`[spotpatch:bridge] ${code}\n`);
    if (
      command === "connect" &&
      (code === ERROR_CODES.SESSION_NOT_FOUND || code === ERROR_CODES.SESSION_CLOSED)
    ) {
      stderr.write(
        "[spotpatch:bridge] The SpotPatch development session ended or changed. Keep the dev server running, then rerun the same connect command.\n",
      );
    }
    return exitCode(error);
  }
}
