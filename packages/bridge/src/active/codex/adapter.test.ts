import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import packageMetadata from "../../../package.json" with { type: "json" };

import type {
  AgentDeliveryLifecycle,
  AgentDeliveryPhase,
  AgentHandoffSnapshot,
} from "../types.js";
import { connectCodexAppServer, type CodexAppServerAdapter } from "./adapter.js";
import { CODEX_ADAPTER_ERROR_CODES } from "./errors.js";

interface FakeScenario {
  readonly exitDuringInitialize?: boolean;
  readonly exitOnTurnStart?: boolean;
  readonly malformedTurnResponse?: boolean;
  readonly mcpReady?: boolean;
  readonly mcpExtraTool?: boolean;
  readonly mcpSessionExtra?: boolean;
  readonly mcpSessionReady?: boolean;
  readonly notificationMetadata?: "invalid" | "unknown";
  readonly omitMcpNextCursor?: boolean;
  readonly ignoreSigterm?: boolean;
  readonly notificationOrder?: "normal" | "completed-first" | "completed-only" | "none";
  readonly oversizedTurnResponseBytes?: number;
  readonly reverseMethods?: readonly string[];
  readonly stderrBytes?: number;
  readonly stallDuringInitialize?: boolean;
  readonly spawnDescendant?: boolean;
  readonly trailingInvalidNotification?: "thread-start" | "mcp-status";
  readonly turnResponseError?: boolean;
  readonly turnStatuses?: readonly ("completed" | "failed" | "interrupted")[];
  readonly workspaceRoots?: "external-runtime" | "external-writable";
  readonly wrongTurnResponseId?: boolean;
}

interface Harness {
  readonly capturePath: string;
  readonly pathValue: string;
  readonly projectRoot: string;
  readonly scenarioPath: string;
}

const FAKE_APP_SERVER = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");

if (process.argv[2] === "--version") {
  process.stdout.write("codex-cli 0.149.0\n");
  process.exit(0);
}
if (process.argv[2] !== "app-server") process.exit(64);

const scenario = JSON.parse(fs.readFileSync(path.join(__dirname, "scenario.json"), "utf8"));
const capturePath = path.join(__dirname, "capture.jsonl");
const capture = (value) => fs.appendFileSync(capturePath, JSON.stringify(value) + "\n");
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const sendBatch = (...values) => process.stdout.write(
  values.map((value) => JSON.stringify(value)).join("\n") + "\n",
);
capture({ kind: "launch", argv: process.argv.slice(2), cwd: process.cwd(), pid: process.pid });
if (scenario.ignoreSigterm) process.on("SIGTERM", () => {});
if (scenario.spawnDescendant) {
  const descendant = spawn(
    process.execPath,
    ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
    { stdio: "ignore" },
  );
  capture({ kind: "descendant", pid: descendant.pid });
}
if (scenario.stderrBytes) process.stderr.write("s".repeat(scenario.stderrBytes));

let turnIndex = 0;
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  const message = JSON.parse(line);
  capture({ kind: "input", message });

  if (message.method === "initialize") {
    if (scenario.exitDuringInitialize) process.exit(70);
    if (scenario.stallDuringInitialize) return;
    const response = {
      id: message.id,
      result: {
        userAgent: "codex_cli_rs/0.149.0",
        codexHome: __dirname,
        platformFamily: "unix",
        platformOs: process.platform,
      },
    };
    const notification = {
      method: "remoteControl/status/changed",
      params: {},
      emittedAtMs: scenario.notificationMetadata === "invalid" ? "invalid" : 1,
      ...(scenario.notificationMetadata === "unknown" ? { unexpected: true } : {}),
    };
    sendBatch(response, notification);
    return;
  }
  if (message.method === "initialized") {
    (scenario.reverseMethods || []).forEach((method, index) => {
      send({ id: 900 + index, method, params: {} });
    });
    return;
  }
  if (message.method === "thread/start") {
    const policy = message.params.config.sandbox_workspace_write;
    const response = {
      id: message.id,
      result: {
        thread: {
          id: "thread-spotpatch",
          ephemeral: message.params.ephemeral,
          cwd: message.params.cwd,
        },
        cwd: message.params.cwd,
        runtimeWorkspaceRoots: scenario.workspaceRoots === "external-runtime"
          ? [path.dirname(message.params.cwd)]
          : [message.params.cwd],
        approvalPolicy: message.params.approvalPolicy,
        sandbox: {
          type: "workspaceWrite",
          writableRoots: scenario.workspaceRoots === "external-writable"
            ? [path.dirname(message.params.cwd)]
            : [],
          networkAccess: policy.network_access,
          excludeTmpdirEnvVar: policy.exclude_tmpdir_env_var,
          excludeSlashTmp: policy.exclude_slash_tmp,
        },
      },
    };
    if (scenario.trailingInvalidNotification === "thread-start") {
      sendBatch(response, {
        method: "remoteControl/status/changed",
        params: {},
        emittedAtMs: "invalid",
      });
    } else {
      send(response);
    }
    return;
  }
  if (message.method === "mcpServerStatus/list") {
    const tools = scenario.mcpReady === false
      ? {}
      : {
          spotpatch_list_sessions: { name: "spotpatch_list_sessions" },
          ...(scenario.mcpExtraTool
            ? {
                spotpatch_get_current_handoff: {
                  name: "spotpatch_get_current_handoff",
                },
              }
            : {}),
        };
    const response = {
      id: message.id,
      result: {
        data: [{ name: "spotpatch", tools }],
        ...(scenario.omitMcpNextCursor ? {} : { nextCursor: null }),
      },
    };
    if (scenario.trailingInvalidNotification === "mcp-status") {
      sendBatch(response, {
        method: "remoteControl/status/changed",
        params: {},
        emittedAtMs: "invalid",
      });
    } else {
      send(response);
    }
    return;
  }
  if (message.method === "mcpServer/tool/call") {
    send({
      id: message.id,
      result: {
        content: [{ type: "text", text: "SpotPatch session probe." }],
        structuredContent: {
          outcome: "sessions",
          sessions: scenario.mcpSessionReady === false
            ? []
            : [
                {
                  sessionId: "0123456789abcdef012345",
                  framework: "vite",
                  current: null,
                },
                ...(scenario.mcpSessionExtra
                  ? [{
                      sessionId: "fedcba9876543210fedcba",
                      framework: "next",
                      current: null,
                    }]
                  : []),
              ],
        },
      },
    });
    return;
  }
  if (message.method !== "turn/start") return;

  if (scenario.exitOnTurnStart) process.exit(71);
  if (scenario.turnResponseError) {
    send({ id: message.id, error: { code: -32000, message: "rejected" } });
    return;
  }
  if (scenario.malformedTurnResponse) {
    process.stdout.write("{malformed\n");
    return;
  }
  if (scenario.oversizedTurnResponseBytes) {
    process.stdout.write("x".repeat(scenario.oversizedTurnResponseBytes) + "\n");
    return;
  }

  turnIndex += 1;
  const turnId = "turn-" + turnIndex;
  const status = (scenario.turnStatuses || ["completed"])[turnIndex - 1] || "completed";
  const started = {
    method: "turn/started",
    params: { threadId: "thread-spotpatch", turn: { id: turnId, status: "inProgress" } },
    emittedAtMs: 10 + turnIndex,
  };
  const completed = {
    method: "turn/completed",
    params: { threadId: "thread-spotpatch", turn: { id: turnId, status } },
    emittedAtMs: 20 + turnIndex,
  };
  const response = {
    id: scenario.wrongTurnResponseId ? message.id + 100 : message.id,
    result: { turn: { id: turnId, status: "inProgress" } },
  };

  if (scenario.notificationOrder === "completed-first") {
    send(response);
    send(completed);
    send(started);
    return;
  }
  if (scenario.notificationOrder === "completed-only") {
    send(response);
    send(completed);
    return;
  }
  if (scenario.notificationOrder === "none") {
    send(response);
    return;
  }
  send(started);
  send(response);
  send(started);
  send(completed);
  send(completed);
});
`;

function snapshot(revision: number): AgentHandoffSnapshot {
  const page = {
    url: "http://127.0.0.1:5173/catalog",
    pathname: "/catalog",
    title: "Catalog",
    viewportWidth: 1_440,
    viewportHeight: 900,
    devicePixelRatio: 2,
  };
  return {
    schemaVersion: 1,
    revision,
    cursor: `cursor_${String(revision).padStart(22, "0")}`,
    session: { id: "0123456789abcdef012345", framework: "vite" },
    publishedAt: "2026-08-23T00:00:00.000Z",
    expiresAt: "2026-08-23T00:15:00.000Z",
    annotation: {
      schemaVersion: 3,
      id: "codex-adapter-test",
      locale: "en-US",
      page,
      targets: [
        {
          instruction: "Make the selected card deep blue.\nKeep its contrast readable.",
          source: {
            relativePath: "src/Card.tsx",
            line: 42,
            column: 7,
            origin: "jsx-host",
            confidence: "exact",
          },
          react: { supported: true, componentStack: ["Card"] },
          element: {
            tagName: "div",
            selector: "div.card",
            sanitizedHtml: '<div class="card">Card</div>',
            rect: { x: 0, y: 0, width: 100, height: 40 },
          },
          styles: {
            classNames: ["card"],
            matchedRules: [],
            computed: { display: "block" },
            warnings: [],
          },
          warnings: [],
        },
      ],
      createdAt: "2026-08-23T00:00:00.000Z",
    },
  };
}

function lifecycle(): Readonly<{
  phases: AgentDeliveryPhase[];
  value: AgentDeliveryLifecycle;
}> {
  const phases: AgentDeliveryPhase[] = [];
  return {
    phases,
    value: {
      report(phase) {
        phases.push(phase);
        return Promise.resolve();
      },
    },
  };
}

async function captured(capturePath: string): Promise<unknown[]> {
  const content = await readFile(capturePath, "utf8").catch(() => "");
  return content
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

function capturedMethods(records: readonly unknown[]): string[] {
  return records.flatMap((record) => {
    if (typeof record !== "object" || record === null || !("message" in record)) {
      return [];
    }
    const message = record.message;
    if (
      typeof message !== "object" ||
      message === null ||
      !("method" in message) ||
      typeof message.method !== "string"
    ) {
      return [];
    }
    return [message.method];
  });
}

const describeCodexAdapter = process.platform === "win32" ? describe.skip : describe;

describeCodexAdapter("Codex App Server adapter contract", () => {
  let temporaryRoot: string;
  let harness: Harness;
  const adapters: CodexAppServerAdapter[] = [];

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "spotpatch-codex-app-"));
    const projectRoot = path.join(temporaryRoot, "project");
    const pathValue = path.join(temporaryRoot, "trusted-bin");
    await mkdir(projectRoot);
    await mkdir(pathValue);
    const target = path.join(pathValue, "codex-bin");
    await writeFile(target, FAKE_APP_SERVER);
    await chmod(target, 0o700);
    await symlink(target, path.join(pathValue, "codex"));
    harness = {
      capturePath: path.join(pathValue, "capture.jsonl"),
      pathValue,
      projectRoot: await realpath(projectRoot),
      scenarioPath: path.join(pathValue, "scenario.json"),
    };
  });

  afterEach(async () => {
    await Promise.all(adapters.splice(0).map(async (adapter) => adapter.close()));
    await rm(temporaryRoot, { force: true, recursive: true });
  });

  async function connect(
    scenario: FakeScenario = {},
    overrides: Readonly<{
      maximumLineBytes?: number;
      maximumStderrBytes?: number;
      processShutdownTimeoutMs?: number;
      terminalTimeoutMs?: number;
    }> = {},
  ): Promise<CodexAppServerAdapter> {
    await writeFile(harness.scenarioPath, JSON.stringify(scenario));
    const adapter = await connectCodexAppServer({
      allowWorkspaceWrite: true,
      bridgeAdapter: "next",
      pathValue: harness.pathValue,
      projectRoot: harness.projectRoot,
      requestTimeoutMs: 1_000,
      sessionId: "0123456789abcdef012345",
      ...overrides,
    });
    adapters.push(adapter);
    return adapter;
  }

  it("uses the locked startup handshake and fixed least-privilege requests", async () => {
    const adapter = await connect({ turnStatuses: ["completed", "completed"] });
    const first = lifecycle();
    const second = lifecycle();

    await adapter.deliver(snapshot(1), first.value, new AbortController().signal);
    await adapter.deliver(snapshot(2), second.value, new AbortController().signal);

    expect(first.phases).toEqual(["dispatched", "working", "completed"]);
    expect(second.phases).toEqual(["dispatched", "working", "completed"]);
    const records = (await captured(harness.capturePath)) as {
      kind: string;
      argv?: string[];
      cwd?: string;
      pid?: number;
      message?: Record<string, unknown>;
    }[];
    expect(records[0]).toMatchObject({
      kind: "launch",
      argv: ["app-server"],
      cwd: harness.projectRoot,
    });
    expect(typeof records[0]?.pid).toBe("number");
    const messages = records
      .filter(
        (record): record is typeof record & { message: Record<string, unknown> } =>
          record.kind === "input" && record.message !== undefined,
      )
      .map((record) => record.message);
    expect(messages.map((message) => message.method).slice(0, 5)).toEqual([
      "initialize",
      "initialized",
      "thread/start",
      "mcpServerStatus/list",
      "mcpServer/tool/call",
    ]);
    expect(messages[0]).toEqual({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: {
          name: "spotpatch",
          title: "SpotPatch",
          version: packageMetadata.version,
        },
        capabilities: { experimentalApi: false, requestAttestation: false },
      },
    });
    expect(messages[1]).toEqual({ method: "initialized" });
    expect(messages[2]).toMatchObject({
      method: "thread/start",
      params: {
        cwd: harness.projectRoot,
        approvalPolicy: "never",
        sandbox: "workspace-write",
        ephemeral: true,
        config: {
          sandbox_workspace_write: {
            writable_roots: [harness.projectRoot],
            network_access: false,
            exclude_tmpdir_env_var: true,
            exclude_slash_tmp: true,
          },
          mcp_servers: {
            spotpatch: {
              command: "node",
              args: [
                "./node_modules/@spotpatch/next/dist/cli.js",
                "bridge",
                "mcp",
                "--session",
                "0123456789abcdef012345",
              ],
              env_vars: ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"],
              enabled_tools: ["spotpatch_list_sessions"],
              required: true,
              tool_timeout_sec: 30,
            },
          },
        },
      },
    });
    expect(messages[3]).toEqual({
      id: 3,
      method: "mcpServerStatus/list",
      params: {
        cursor: null,
        limit: 100,
        detail: "toolsAndAuthOnly",
        threadId: "thread-spotpatch",
      },
    });
    expect(messages[4]).toEqual({
      id: 4,
      method: "mcpServer/tool/call",
      params: {
        threadId: "thread-spotpatch",
        server: "spotpatch",
        tool: "spotpatch_list_sessions",
        arguments: {},
      },
    });
    const turns = messages.filter((message) => message.method === "turn/start");
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({
      params: {
        threadId: "thread-spotpatch",
        cwd: harness.projectRoot,
        approvalPolicy: "never",
        sandboxPolicy: {
          type: "workspaceWrite",
          writableRoots: [harness.projectRoot],
          networkAccess: false,
          excludeTmpdirEnvVar: true,
          excludeSlashTmp: true,
        },
      },
    });
    expect(JSON.stringify(turns[0]?.params)).toContain("Source: src/Card.tsx:42:7");
    expect(JSON.stringify(turns[0]?.params)).toContain("Element: <div>");
    expect(JSON.stringify(turns[0]?.params)).toContain(
      "Request: Make the selected card deep blue. Keep its contrast readable.",
    );
    expect(JSON.stringify(turns[0]?.params)).toContain(
      "intentionally receives no full SpotPatch snapshot tool",
    );
    expect(JSON.stringify(turns[0]?.params)).not.toContain("sanitizedHtml");
    expect(JSON.stringify(turns[0]?.params)).not.toContain(snapshot(1).cursor);
    expect(JSON.stringify(messages[2]?.params)).not.toContain(
      "spotpatch_get_current_handoff",
    );
    expect(JSON.stringify(turns)).not.toContain("turn/steer");
  });

  it.each(["failed", "interrupted"] as const)(
    "maps a matching %s terminal notification to failed",
    async (status) => {
      const adapter = await connect({ turnStatuses: [status] });
      const delivery = lifecycle();

      await adapter.deliver(snapshot(1), delivery.value, new AbortController().signal);

      expect(delivery.phases).toEqual(["dispatched", "working", "failed"]);
    },
  );

  it("accepts an omitted optional MCP status cursor", async () => {
    await expect(connect({ omitMcpNextCursor: true })).resolves.toBeDefined();
  });

  it("buffers out-of-order terminal events and ignores duplicate matching events", async () => {
    const adapter = await connect({ notificationOrder: "completed-first" });
    const delivery = lifecycle();

    await adapter.deliver(snapshot(1), delivery.value, new AbortController().signal);

    expect(delivery.phases).toEqual(["dispatched", "working", "completed"]);
  });

  it("keeps capacity at one and never converts a busy turn into steer", async () => {
    const adapter = await connect(
      { notificationOrder: "none" },
      { terminalTimeoutMs: 5_000 },
    );
    const first = lifecycle();
    const firstDelivery = adapter.deliver(
      snapshot(1),
      first.value,
      new AbortController().signal,
    );
    const firstOutcome = firstDelivery.then(
      () => undefined,
      (error: unknown) => error,
    );
    await vi.waitFor(() => {
      expect(first.phases).toEqual(["dispatched"]);
    });

    await expect(
      adapter.deliver(snapshot(2), lifecycle().value, new AbortController().signal),
    ).rejects.toMatchObject({ code: CODEX_ADAPTER_ERROR_CODES.BUSY });
    await adapter.close();
    await expect(firstOutcome).resolves.toMatchObject({
      name: "ActiveDeliveryUnknownError",
    });
    const records = JSON.stringify(await captured(harness.capturePath));
    expect(records.match(/turn\/start/gu)).toHaveLength(1);
    expect(records).not.toContain("turn/steer");
  });

  it("fails before turn/start when a selected target has no actionable source", async () => {
    const adapter = await connect();
    const delivery = lifecycle();
    const handoff = snapshot(1);
    const target = handoff.annotation.targets[0];
    if (target === undefined) throw new Error("Missing test target.");
    const targetWithoutCode = { ...target };
    delete targetWithoutCode.code;
    const sourceUnavailable = {
      ...handoff,
      annotation: {
        ...handoff.annotation,
        targets: [
          {
            ...targetWithoutCode,
            source: { origin: "none" as const, confidence: "unknown" as const },
          },
        ],
      },
    };

    await adapter.deliver(
      sourceUnavailable,
      delivery.value,
      new AbortController().signal,
    );

    expect(delivery.phases).toEqual(["failed"]);
    const records = await captured(harness.capturePath);
    expect(capturedMethods(records)).not.toContain("turn/start");
  });

  it("fails before turn/start for non-normalized or non-project-relative source paths", async () => {
    const adapter = await connect();
    const handoff = snapshot(1);
    const target = handoff.annotation.targets[0];
    if (target === undefined) throw new Error("Missing test target.");
    const invalidPaths = [
      "",
      "/tmp/Outside.tsx",
      "../Outside.tsx",
      "src/../Outside.tsx",
      "./src/Card.tsx",
      "src//Card.tsx",
      "src/Card.tsx/",
      "C:/outside/Card.tsx",
      String.raw`C:\outside\Card.tsx`,
    ];

    for (const relativePath of invalidPaths) {
      const delivery = lifecycle();
      await adapter.deliver(
        {
          ...handoff,
          annotation: {
            ...handoff.annotation,
            targets: [
              {
                ...target,
                source: {
                  relativePath,
                  line: 42,
                  column: 7,
                  origin: "react-fiber",
                  confidence: "probable",
                },
              },
            ],
          },
        },
        delivery.value,
        new AbortController().signal,
      );
      expect(delivery.phases).toEqual(["failed"]);
    }

    const records = await captured(harness.capturePath);
    expect(capturedMethods(records)).not.toContain("turn/start");
  });

  it("fails before turn/start when two targets have the same safe projection", async () => {
    const adapter = await connect();
    const delivery = lifecycle();
    const handoff = snapshot(1);
    const target = handoff.annotation.targets[0];
    if (target === undefined) throw new Error("Missing test target.");

    await adapter.deliver(
      {
        ...handoff,
        annotation: {
          ...handoff.annotation,
          targets: [
            target,
            {
              ...target,
              instruction: "Use a different border.",
              element: {
                ...target.element,
                selector: "div.second-card",
                sanitizedHtml: '<div class="second-card">Second</div>',
              },
            },
          ],
        },
      },
      delivery.value,
      new AbortController().signal,
    );

    expect(delivery.phases).toEqual(["failed"]);
    const records = await captured(harness.capturePath);
    expect(capturedMethods(records)).not.toContain("turn/start");
  });

  it("fails closed when the scoped SpotPatch session-list tool is absent", async () => {
    await writeFile(harness.scenarioPath, JSON.stringify({ mcpReady: false }));

    await expect(
      connectCodexAppServer({
        allowWorkspaceWrite: true,
        bridgeAdapter: "next",
        pathValue: harness.pathValue,
        projectRoot: harness.projectRoot,
        requestTimeoutMs: 1_000,
        sessionId: "0123456789abcdef012345",
      }),
    ).rejects.toMatchObject({
      code: CODEX_ADAPTER_ERROR_CODES.MCP_NOT_READY,
    });
  });

  it("fails closed when the active MCP exposes any additional tool", async () => {
    await writeFile(harness.scenarioPath, JSON.stringify({ mcpExtraTool: true }));

    await expect(
      connectCodexAppServer({
        allowWorkspaceWrite: true,
        bridgeAdapter: "next",
        pathValue: harness.pathValue,
        projectRoot: harness.projectRoot,
        requestTimeoutMs: 1_000,
        sessionId: "0123456789abcdef012345",
      }),
    ).rejects.toMatchObject({
      code: CODEX_ADAPTER_ERROR_CODES.MCP_NOT_READY,
    });
  });

  it("fails closed when the injected MCP cannot discover the selected session", async () => {
    await writeFile(harness.scenarioPath, JSON.stringify({ mcpSessionReady: false }));

    await expect(
      connectCodexAppServer({
        allowWorkspaceWrite: true,
        bridgeAdapter: "next",
        pathValue: harness.pathValue,
        projectRoot: harness.projectRoot,
        requestTimeoutMs: 1_000,
        sessionId: "0123456789abcdef012345",
      }),
    ).rejects.toMatchObject({
      code: CODEX_ADAPTER_ERROR_CODES.MCP_NOT_READY,
    });
  });

  it("fails closed when the injected MCP exposes more than the selected session", async () => {
    await writeFile(harness.scenarioPath, JSON.stringify({ mcpSessionExtra: true }));

    await expect(
      connectCodexAppServer({
        allowWorkspaceWrite: true,
        bridgeAdapter: "next",
        pathValue: harness.pathValue,
        projectRoot: harness.projectRoot,
        requestTimeoutMs: 1_000,
        sessionId: "0123456789abcdef012345",
      }),
    ).rejects.toMatchObject({
      code: CODEX_ADAPTER_ERROR_CODES.MCP_NOT_READY,
    });
  });

  it.each(["invalid", "unknown"] as const)(
    "rejects %s notification envelope metadata",
    async (notificationMetadata) => {
      await writeFile(harness.scenarioPath, JSON.stringify({ notificationMetadata }));

      await expect(
        connectCodexAppServer({
          allowWorkspaceWrite: true,
          bridgeAdapter: "next",
          pathValue: harness.pathValue,
          projectRoot: harness.projectRoot,
          requestTimeoutMs: 1_000,
          sessionId: "0123456789abcdef012345",
        }),
      ).rejects.toMatchObject({ code: CODEX_ADAPTER_ERROR_CODES.PROTOCOL });
    },
  );

  it.each(["thread-start", "mcp-status"] as const)(
    "rejects a trailing protocol error after the %s response",
    async (trailingInvalidNotification) => {
      await writeFile(
        harness.scenarioPath,
        JSON.stringify({ trailingInvalidNotification }),
      );

      await expect(
        connectCodexAppServer({
          allowWorkspaceWrite: true,
          bridgeAdapter: "next",
          pathValue: harness.pathValue,
          projectRoot: harness.projectRoot,
          requestTimeoutMs: 1_000,
          sessionId: "0123456789abcdef012345",
        }),
      ).rejects.toMatchObject({ code: CODEX_ADAPTER_ERROR_CODES.PROTOCOL });
    },
  );

  it.each(["external-runtime", "external-writable"] as const)(
    "rejects %s roots in the effective workspace policy",
    async (workspaceRoots) => {
      await writeFile(harness.scenarioPath, JSON.stringify({ workspaceRoots }));

      await expect(
        connectCodexAppServer({
          allowWorkspaceWrite: true,
          bridgeAdapter: "next",
          pathValue: harness.pathValue,
          projectRoot: harness.projectRoot,
          requestTimeoutMs: 1_000,
          sessionId: "0123456789abcdef012345",
        }),
      ).rejects.toMatchObject({ code: CODEX_ADAPTER_ERROR_CODES.PROTOCOL });
    },
  );

  it("reports a structured turn rejection as failed without retrying", async () => {
    const adapter = await connect({ turnResponseError: true });
    const delivery = lifecycle();

    await adapter.deliver(snapshot(1), delivery.value, new AbortController().signal);

    expect(delivery.phases).toEqual(["failed"]);
    const records = JSON.stringify(await captured(harness.capturePath));
    expect(records.match(/turn\/start/gu)).toHaveLength(1);
  });

  it("fails connection when the process exits before any handoff write", async () => {
    await writeFile(
      harness.scenarioPath,
      JSON.stringify({ exitDuringInitialize: true }),
    );

    await expect(
      connectCodexAppServer({
        allowWorkspaceWrite: true,
        bridgeAdapter: "next",
        pathValue: harness.pathValue,
        projectRoot: harness.projectRoot,
        requestTimeoutMs: 1_000,
        sessionId: "0123456789abcdef012345",
      }),
    ).rejects.toMatchObject({
      code: CODEX_ADAPTER_ERROR_CODES.PROCESS_EXITED,
    });
    const records = JSON.stringify(await captured(harness.capturePath));
    expect(records.match(/initialize/gu)).toHaveLength(1);
    expect(records).not.toContain("turn/start");
  });

  it("aborts an in-flight startup handshake and does not continue to thread/start", async () => {
    await writeFile(
      harness.scenarioPath,
      JSON.stringify({ stallDuringInitialize: true }),
    );
    const controller = new AbortController();
    const connecting = connectCodexAppServer({
      allowWorkspaceWrite: true,
      bridgeAdapter: "next",
      pathValue: harness.pathValue,
      processShutdownTimeoutMs: 25,
      projectRoot: harness.projectRoot,
      requestTimeoutMs: 30_000,
      sessionId: "0123456789abcdef012345",
      signal: controller.signal,
    });

    await vi.waitFor(async () => {
      const records = await captured(harness.capturePath);
      expect(capturedMethods(records)).toContain("initialize");
    });
    controller.abort("test-interrupted");

    await expect(connecting).rejects.toMatchObject({ name: "AbortError" });
    const records = await captured(harness.capturePath);
    expect(capturedMethods(records)).not.toContain("thread/start");
  });

  it("marks process exit after a handoff write as delivery-unknown and never retries", async () => {
    const adapter = await connect({ exitOnTurnStart: true });
    const delivery = lifecycle();

    await expect(
      adapter.deliver(snapshot(1), delivery.value, new AbortController().signal),
    ).rejects.toMatchObject({ name: "ActiveDeliveryUnknownError" });
    expect(delivery.phases).toEqual(["delivery-unknown"]);
    const records = JSON.stringify(await captured(harness.capturePath));
    expect(records.match(/turn\/start/gu)).toHaveLength(1);
  });

  it("fails closed on an uncorrelated response id", async () => {
    const adapter = await connect({ wrongTurnResponseId: true });
    const delivery = lifecycle();

    await expect(
      adapter.deliver(snapshot(1), delivery.value, new AbortController().signal),
    ).rejects.toMatchObject({ name: "ActiveDeliveryUnknownError" });
    expect(delivery.phases).toEqual(["delivery-unknown"]);
  });

  it.each([{ malformedTurnResponse: true }, { oversizedTurnResponseBytes: 4_096 }])(
    "marks malformed or oversized output as delivery-unknown",
    async (scenario) => {
      const adapter = await connect(scenario, { maximumLineBytes: 2_048 });
      const delivery = lifecycle();

      await expect(
        adapter.deliver(snapshot(1), delivery.value, new AbortController().signal),
      ).rejects.toMatchObject({ name: "ActiveDeliveryUnknownError" });
      expect(delivery.phases).toEqual(["delivery-unknown"]);
    },
  );

  it("does not infer working when a matching started event never arrives", async () => {
    const adapter = await connect(
      { notificationOrder: "completed-only" },
      { terminalTimeoutMs: 25 },
    );
    const delivery = lifecycle();

    await expect(
      adapter.deliver(snapshot(1), delivery.value, new AbortController().signal),
    ).rejects.toMatchObject({ name: "ActiveDeliveryUnknownError" });
    expect(delivery.phases).toEqual(["dispatched", "delivery-unknown"]);
  });

  it("returns schema-shaped denials for known reverse requests and a protocol error for unknown methods", async () => {
    const methods = [
      "item/commandExecution/requestApproval",
      "item/fileChange/requestApproval",
      "item/tool/requestUserInput",
      "mcpServer/elicitation/request",
      "item/permissions/requestApproval",
      "item/tool/call",
      "account/chatgptAuthTokens/refresh",
      "attestation/generate",
      "applyPatchApproval",
      "execCommandApproval",
      "future/unknown",
    ];
    await connect({ reverseMethods: methods });

    await vi.waitFor(async () => {
      const records = (await captured(harness.capturePath)) as {
        kind: string;
        message?: Record<string, unknown>;
      }[];
      const responses = records
        .filter((record) => record.kind === "input")
        .map((record) => record.message)
        .filter((message) => typeof message?.id === "number" && message.id >= 900);
      expect(responses).toHaveLength(methods.length);
      expect(responses[0]).toEqual({ id: 900, result: { decision: "decline" } });
      expect(responses[1]).toEqual({ id: 901, result: { decision: "decline" } });
      expect(responses[2]).toEqual({ id: 902, result: { answers: {} } });
      expect(responses[3]).toEqual({
        id: 903,
        result: { action: "decline", content: null, _meta: null },
      });
      expect(responses[4]).toEqual({
        id: 904,
        result: { permissions: {}, scope: "turn", strictAutoReview: true },
      });
      expect(responses[5]).toEqual({
        id: 905,
        result: { contentItems: [], success: false },
      });
      expect(responses[6]).toMatchObject({ id: 906, error: { code: -32_001 } });
      expect(responses[7]).toMatchObject({ id: 907, error: { code: -32_001 } });
      expect(responses[8]).toMatchObject({
        id: 908,
        result: { decision: { denied: {} } },
      });
      expect(responses[9]).toMatchObject({
        id: 909,
        result: { decision: { denied: {} } },
      });
      expect(responses[10]).toEqual({
        id: 910,
        error: { code: -32_601, message: "Method not found." },
      });
    });
  });

  it("drains stderr with a bounded diagnostic and never exposes its contents", async () => {
    const adapter = await connect({ stderrBytes: 512 }, { maximumStderrBytes: 32 });

    await vi.waitFor(() => {
      expect(adapter.diagnostics()).toEqual({
        stderrBytesObserved: 32,
        stderrTruncated: true,
      });
    });
    expect(adapter.diagnostics()).not.toHaveProperty("stderr");
  });

  it.skipIf(process.platform === "win32")(
    "kills the owned process group when App Server and a descendant ignore SIGTERM",
    async () => {
      const adapter = await connect(
        { ignoreSigterm: true, spawnDescendant: true },
        { processShutdownTimeoutMs: 25 },
      );
      let processIds: number[] = [];

      await vi.waitFor(async () => {
        const records = (await captured(harness.capturePath)) as {
          kind: string;
          pid?: number;
        }[];
        processIds = records.flatMap((record) =>
          typeof record.pid === "number" ? [record.pid] : [],
        );
        expect(processIds).toHaveLength(2);
      });

      await adapter.close();
      await vi.waitFor(() => {
        for (const processId of processIds) {
          expect(() => process.kill(processId, 0)).toThrow();
        }
      });
    },
  );

  it("requires terminal workspace-write consent before resolving or spawning Codex", async () => {
    await expect(
      connectCodexAppServer({
        allowWorkspaceWrite: false,
        bridgeAdapter: "next",
        pathValue: harness.pathValue,
        projectRoot: harness.projectRoot,
        sessionId: "0123456789abcdef012345",
      }),
    ).rejects.toMatchObject({
      code: CODEX_ADAPTER_ERROR_CODES.WORKSPACE_WRITE_REQUIRED,
    });
    await expect(readFile(harness.capturePath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
