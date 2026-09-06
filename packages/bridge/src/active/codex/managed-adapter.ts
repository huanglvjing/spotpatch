import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";

import type {
  ManagedExecutionPort,
  ManagedExecutionResult,
  PreparedManagedTask,
} from "@spotpatch/agent";
import {
  ERROR_CODES,
  EXTERNAL_HANDOFF_LIMITS,
  SpotPatchError,
} from "@spotpatch/shared";

import packageMetadata from "../../../package.json" with { type: "json" };
import type {
  ConnectManagedAdapterOptions,
  ManagedAdapterConnection,
} from "../../supervisor/supervisor.js";
import {
  ActiveDeliveryUnknownError,
  type AgentAdapter,
  type AgentDeliveryLifecycle,
  type AgentHandoffSnapshot,
} from "../types.js";
import {
  CODEX_ADAPTER_ERROR_CODES,
  CodexAdapterError,
  CodexRemoteRequestError,
} from "./errors.js";
import { resolveCodexExecutable } from "./executable.js";
import { prepareManagedCodexRuntimeHome } from "./managed-runtime.js";
import { CodexJsonlClient, type CodexProtocolDiagnostics } from "./protocol.js";
import { readCodexModelCatalog } from "./model-catalog.js";

const CLIENT_NAME = "spotpatch";
const CLIENT_TITLE = "SpotPatch";
const MANAGED_PERMISSION_PROFILE = "spotpatch-managed";
const DEFAULT_PROCESS_SHUTDOWN_TIMEOUT_MS = 2_000;
const MAXIMUM_MCP_STATUS_PAGES = 8;

const MANAGED_SHELL_ENVIRONMENT_NAMES = Object.freeze([
  "LANG",
  "LC_ALL",
  "NODE_ENV",
  "NO_COLOR",
  "PATH",
  "PATHEXT",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
] as const);

const MANAGED_SHELL_ENVIRONMENT_FILTERS = Object.freeze(
  Object.fromEntries(
    MANAGED_SHELL_ENVIRONMENT_NAMES.map((name) => [name, "include"] as const),
  ),
);

const MANAGED_SHELL_ENVIRONMENT_POLICY = Object.freeze({
  inherit: "all",
  ignore_default_excludes: false,
  filters: MANAGED_SHELL_ENVIRONMENT_FILTERS,
});

const MANAGED_SHELL_ENVIRONMENT_POLICY_TOML = `{ inherit="all", ignore_default_excludes=false, filters={ ${MANAGED_SHELL_ENVIRONMENT_NAMES.map(
  (name) => `${name}="include"`,
).join(", ")} } }`;

const MANAGED_CODEX_CONFIG_OVERRIDES = Object.freeze([
  "agents.enabled=false",
  "features.apps=false",
  "features.hooks=false",
  "features.plugins=false",
  "features.remote_plugin=false",
  'web_search="disabled"',
  "mcp_servers={}",
  `shell_environment_policy=${MANAGED_SHELL_ENVIRONMENT_POLICY_TOML}`,
] as const);

type JsonRecord = Readonly<Record<string, unknown>>;
type TerminalTurnStatus = "completed" | "failed" | "interrupted";

interface TurnEvent {
  readonly kind: "started" | "completed";
  readonly status: "inProgress" | TerminalTurnStatus;
  readonly threadId: string;
  readonly turnId: string;
}

interface ActiveManagedTurn {
  readonly events: TurnEvent[];
  readonly handoff: AgentHandoffSnapshot;
  readonly lifecycle: AgentDeliveryLifecycle;
  readonly reject: (error: Error) => void;
  readonly resolve: () => void;
  readonly signal: AbortSignal;
  readonly task: PreparedManagedTask;
  readonly terminal: Promise<void>;
  readonly threadId: string;
  finalized: boolean;
  processing: Promise<void>;
  started: boolean;
  timeout: NodeJS.Timeout | undefined;
  terminalEvent: TurnEvent | undefined;
  turnId: string | undefined;
  written: boolean;
}

export interface ConnectManagedCodexAppServerOptions extends ConnectManagedAdapterOptions {
  readonly maximumLineBytes?: number;
  readonly maximumStderrBytes?: number;
  readonly pathValue?: string;
  readonly processShutdownTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly terminalTimeoutMs?: number;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingThreadError(error: unknown, threadId: string): boolean {
  if (!(error instanceof CodexRemoteRequestError)) return false;
  const message = error.remoteMessage.trim();
  return (
    message === `no rollout found for thread id ${threadId}` ||
    /\bthread\b.{0,96}\b(?:not found|does not exist|unknown)\b/iu.test(message)
  );
}

function hasOnlyKeys(value: JsonRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => key in value);
}

function abortError(): Error {
  const error = new Error("The managed Codex operation was aborted.");
  error.name = "AbortError";
  return error;
}

function managedFailureReason(
  error: unknown,
  fallback: "apply" | "snapshot",
): Extract<
  Parameters<ConnectManagedAdapterOptions["onEvent"]>[0],
  { type: "failure" }
>["reason"] {
  if (error instanceof CodexAdapterError) {
    if (error.code === CODEX_ADAPTER_ERROR_CODES.CONFIG_ISOLATION_UNSUPPORTED) {
      return "config-isolation";
    }
    if (
      error.code === CODEX_ADAPTER_ERROR_CODES.PROTOCOL ||
      error.code === CODEX_ADAPTER_ERROR_CODES.REQUEST_FAILED
    ) {
      return "protocol";
    }
    return fallback;
  }
  if (!(error instanceof SpotPatchError)) return fallback;
  switch (error.code) {
    case ERROR_CODES.AGENT_LIMIT_EXCEEDED:
      return "change-limit";
    case ERROR_CODES.PATCH_REJECTED:
    case ERROR_CODES.HANDOFF_VALIDATION_FAILED:
      return "scope";
    case ERROR_CODES.VALIDATION_FAILED:
      return "validation";
    case ERROR_CODES.APPLY_CONFLICT:
      return "workspace-conflict";
    case ERROR_CODES.WORKTREE_CONFLICTED:
    case ERROR_CODES.WORKTREE_DIRTY:
    case ERROR_CODES.WORKTREE_LOCAL_CHANGES_TOO_LARGE:
    case ERROR_CODES.WORKTREE_LOCAL_CHANGES_UNSUPPORTED:
    case ERROR_CODES.WORKTREE_NOT_REPOSITORY:
    case ERROR_CODES.WORKTREE_OPERATION_IN_PROGRESS:
    case ERROR_CODES.WORKTREE_UNTRACKED_UNSUPPORTED:
      return "snapshot";
    default:
      return fallback;
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw abortError();
}

function signalProcessTree(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
): void {
  if (process.platform !== "win32" && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The process may have exited before its process group was signalled.
    }
  }
  child.kill(signal);
}

function managedEnvironment(codexHome: string): NodeJS.ProcessEnv {
  const names = [
    "CODEX_ACCESS_TOKEN",
    "CODEX_API_KEY",
    "OPENAI_API_KEY",
    "PATH",
    "PATHEXT",
    "SYSTEMROOT",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
  ] as const;
  const environment: NodeJS.ProcessEnv = {
    CODEX_HOME: codexHome,
    HOME: codexHome,
    NO_COLOR: "1",
    NODE_ENV: process.env.NODE_ENV ?? "development",
    USERPROFILE: codexHome,
  };
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  const loopback = "localhost,127.0.0.1,::1";
  const existing = process.env.NO_PROXY ?? process.env.no_proxy;
  environment.NO_PROXY = existing === undefined ? loopback : `${loopback},${existing}`;
  environment.no_proxy = environment.NO_PROXY;
  return environment;
}

function managedThreadConfig(): JsonRecord {
  return Object.freeze({
    agents: Object.freeze({ enabled: false }),
    default_permissions: MANAGED_PERMISSION_PROFILE,
    features: Object.freeze({
      apps: false,
      hooks: false,
      plugins: false,
      remote_plugin: false,
    }),
    mcp_servers: Object.freeze({}),
    permissions: Object.freeze({
      [MANAGED_PERMISSION_PROFILE]: Object.freeze({
        filesystem: Object.freeze({
          ":root": "deny",
          ":minimal": "read",
          ":workspace_roots": Object.freeze({ ".": "write" }),
        }),
        network: Object.freeze({ enabled: false }),
      }),
    }),
    shell_environment_policy: MANAGED_SHELL_ENVIRONMENT_POLICY,
    web_search: "disabled",
  });
}

function verifyInitializeResponse(value: unknown, codexHome: string): void {
  if (
    !isRecord(value) ||
    typeof value.userAgent !== "string" ||
    value.codexHome !== codexHome ||
    typeof value.platformFamily !== "string" ||
    typeof value.platformOs !== "string"
  ) {
    throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL);
  }
}

function parseAuthReadiness(value: unknown): ManagedAdapterConnection["authReadiness"] {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["account", "requiresOpenaiAuth"]) ||
    typeof value.requiresOpenaiAuth !== "boolean" ||
    (value.account !== null && !isRecord(value.account))
  ) {
    throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL);
  }
  if (value.account !== null) return "authenticated";
  return value.requiresOpenaiAuth ? "signed-out" : "auth-not-required";
}

function verifyConfigRequirements(value: unknown): void {
  if (!isRecord(value) || !hasOnlyKeys(value, ["requirements"])) {
    throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL);
  }
  if (value.requirements === null) return;
  if (!isRecord(value.requirements)) {
    throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL);
  }
  const approvals = value.requirements.allowedApprovalPolicies;
  const sandboxes = value.requirements.allowedSandboxModes;
  const permissionProfiles = value.requirements.allowedPermissionProfiles;
  if (
    (Array.isArray(approvals) && !approvals.includes("never")) ||
    (permissionProfiles !== null &&
      (!isRecord(permissionProfiles) ||
        permissionProfiles[MANAGED_PERMISSION_PROFILE] !== true)) ||
    (permissionProfiles === null &&
      Array.isArray(sandboxes) &&
      !sandboxes.includes("workspaceWrite"))
  ) {
    throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL);
  }
}

function parseThreadStartResponse(value: unknown, root: string): string {
  if (
    !isRecord(value) ||
    !isRecord(value.thread) ||
    typeof value.thread.id !== "string" ||
    value.thread.ephemeral !== false ||
    value.thread.cwd !== root ||
    value.cwd !== root ||
    value.approvalPolicy !== "never" ||
    !Array.isArray(value.runtimeWorkspaceRoots) ||
    value.runtimeWorkspaceRoots.length !== 1 ||
    value.runtimeWorkspaceRoots[0] !== root ||
    !isRecord(value.activePermissionProfile) ||
    value.activePermissionProfile.id !== MANAGED_PERMISSION_PROFILE
  ) {
    throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL);
  }
  return value.thread.id;
}

function parseTurn(value: unknown): Readonly<{
  id: string;
  status: "inProgress" | TerminalTurnStatus;
}> {
  if (!isRecord(value) || typeof value.id !== "string") {
    throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL);
  }
  if (
    value.status !== "inProgress" &&
    value.status !== "completed" &&
    value.status !== "failed" &&
    value.status !== "interrupted"
  ) {
    throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL);
  }
  return Object.freeze({ id: value.id, status: value.status });
}

function parseTurnEvent(method: string, params: unknown): TurnEvent | undefined {
  if (method !== "turn/started" && method !== "turn/completed") return undefined;
  if (!isRecord(params) || typeof params.threadId !== "string") {
    throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL);
  }
  const turn = parseTurn(params.turn);
  if (
    (method === "turn/started" && turn.status !== "inProgress") ||
    (method === "turn/completed" && turn.status === "inProgress")
  ) {
    throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL);
  }
  return Object.freeze({
    kind: method === "turn/started" ? "started" : "completed",
    status: turn.status,
    threadId: params.threadId,
    turnId: turn.id,
  });
}

async function canonicalRoot(root: string): Promise<string> {
  const canonical = await realpath(root);
  if (!(await stat(canonical)).isDirectory()) {
    throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.EXECUTABLE_UNTRUSTED);
  }
  return canonical;
}

export class ManagedCodexAppServerAdapter implements AgentAdapter {
  readonly kind = "codex-app-server" as const;
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #client: CodexJsonlClient;
  readonly #cleanupJournal: ConnectManagedCodexAppServerOptions["cleanupJournal"];
  readonly #execution: ManagedExecutionPort;
  readonly #onEvent: ConnectManagedCodexAppServerOptions["onEvent"];
  readonly #processShutdownTimeoutMs: number;
  readonly #terminalTimeoutMs: number;
  #active: ActiveManagedTurn | undefined;
  #closed = false;
  #closePromise: Promise<void> | undefined;
  #fatalError: CodexAdapterError | undefined;
  #model: string | undefined;

  private constructor(
    child: ChildProcessWithoutNullStreams,
    client: CodexJsonlClient,
    options: ConnectManagedCodexAppServerOptions,
  ) {
    this.#child = child;
    this.#client = client;
    this.#cleanupJournal = options.cleanupJournal;
    this.#execution = options.execution;
    this.#onEvent = options.onEvent;
    this.#processShutdownTimeoutMs =
      options.processShutdownTimeoutMs ?? DEFAULT_PROCESS_SHUTDOWN_TIMEOUT_MS;
    this.#terminalTimeoutMs =
      options.terminalTimeoutMs ?? EXTERNAL_HANDOFF_LIMITS.activeDispatchTimeoutMs;
  }

  static async connect(options: ConnectManagedCodexAppServerOptions): Promise<
    Readonly<{
      adapter: ManagedCodexAppServerAdapter;
      authReadiness: ManagedAdapterConnection["authReadiness"];
      requestedModel: string;
      effectiveModel: string;
      models: readonly string[];
    }>
  > {
    throwIfAborted(options.signal);
    const projectRoot = await canonicalRoot(options.projectRoot);
    const executable = await resolveCodexExecutable(projectRoot, {
      ...(options.pathValue === undefined ? {} : { pathValue: options.pathValue }),
    });
    let codexHome: string;
    try {
      codexHome = await prepareManagedCodexRuntimeHome({
        excludedRoot: projectRoot,
        ...(options.privateRuntimeBase === undefined
          ? {}
          : { runtimeBase: options.privateRuntimeBase }),
        runtimeKey: options.runtimeKey,
      });
    } catch (error: unknown) {
      throw new CodexAdapterError(
        CODEX_ADAPTER_ERROR_CODES.CONFIG_ISOLATION_UNSUPPORTED,
        error,
      );
    }
    const args = MANAGED_CODEX_CONFIG_OVERRIDES.flatMap((value) => ["-c", value]);
    args.push("app-server");
    const child = spawn(executable.path, args, {
      cwd: path.dirname(executable.path),
      detached: process.platform !== "win32",
      env: managedEnvironment(codexHome),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const state: { adapter?: ManagedCodexAppServerAdapter } = {};
    let earlyFatal: CodexAdapterError | undefined;
    const client = new CodexJsonlClient(child, {
      ...(options.maximumLineBytes === undefined
        ? {}
        : { maximumLineBytes: options.maximumLineBytes }),
      ...(options.maximumStderrBytes === undefined
        ? {}
        : { maximumStderrBytes: options.maximumStderrBytes }),
      ...(options.requestTimeoutMs === undefined
        ? {}
        : { requestTimeoutMs: options.requestTimeoutMs }),
      onFatal(error) {
        if (state.adapter === undefined) earlyFatal = error;
        else state.adapter.#handleFatal(error);
      },
      onNotification(method, params) {
        if (state.adapter !== undefined) {
          state.adapter.#handleNotification(method, params);
        }
      },
    });
    const adapter = new ManagedCodexAppServerAdapter(child, client, options);
    state.adapter = adapter;
    if (earlyFatal !== undefined) adapter.#handleFatal(earlyFatal);
    const abort = (): void => {
      void adapter.close().catch(() => undefined);
    };
    options.signal.addEventListener("abort", abort, { once: true });

    try {
      const initialized = await adapter.#request("initialize", {
        clientInfo: {
          name: CLIENT_NAME,
          title: CLIENT_TITLE,
          version: packageMetadata.version,
        },
        capabilities: { experimentalApi: true, requestAttestation: false },
      });
      verifyInitializeResponse(initialized, codexHome);
      client.notify("initialized");
      const account = parseAuthReadiness(
        await adapter.#request("account/read", { refreshToken: false }),
      );
      if (account === "signed-out") {
        throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.AUTH_REQUIRED);
      }
      const catalog = await readCodexModelCatalog({
        request: (params) => adapter.#request("model/list", params),
        protocolError: () => new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL),
        unavailableError: () =>
          new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.MODEL_UNAVAILABLE),
      });
      const selected =
        options.model === undefined
          ? (catalog.find((entry) => entry.isDefault) ?? catalog[0])
          : catalog.find((entry) => entry.model === options.model);
      if (selected === undefined)
        throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.MODEL_UNAVAILABLE);
      const requestedModel = selected.model;
      adapter.#model = requestedModel;
      verifyConfigRequirements(await adapter.#request("configRequirements/read", {}));
      await adapter.#recoverThreadCleanup();
      throwIfAborted(options.signal);
      return Object.freeze({
        adapter,
        authReadiness: account,
        requestedModel,
        effectiveModel: requestedModel,
        models: Object.freeze(catalog.map((entry) => entry.model)),
      });
    } catch (error: unknown) {
      await adapter.close();
      throwIfAborted(options.signal);
      throw error;
    } finally {
      options.signal.removeEventListener("abort", abort);
    }
  }

  diagnostics(): CodexProtocolDiagnostics {
    return this.#client.diagnostics();
  }

  async deliver(
    handoff: AgentHandoffSnapshot,
    lifecycle: AgentDeliveryLifecycle,
    signal: AbortSignal,
  ): Promise<void> {
    if (this.#active !== undefined) {
      throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.BUSY);
    }
    if (this.#closed) {
      throw this.#fatalError ?? new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.CLOSED);
    }
    this.#onEvent({ type: "phase", revision: handoff.revision, phase: "preparing" });
    let task: PreparedManagedTask;
    try {
      task = await this.#execution.prepare(
        { annotation: handoff.annotation, revision: handoff.revision },
        signal,
      );
    } catch (error: unknown) {
      this.#onEvent({
        type: "failure",
        revision: handoff.revision,
        reason: managedFailureReason(error, "snapshot"),
      });
      await lifecycle.report("failed");
      return;
    }

    let threadId: string | undefined;
    try {
      const thread = await this.#request("thread/start", {
        model: this.#model,
        cwd: task.workspaceRoot,
        runtimeWorkspaceRoots: [task.workspaceRoot],
        approvalPolicy: "never",
        permissions: MANAGED_PERMISSION_PROFILE,
        config: managedThreadConfig(),
        ephemeral: false,
      });
      threadId = parseThreadStartResponse(thread, task.workspaceRoot);
      try {
        await this.#cleanupJournal.add(threadId);
      } catch (error: unknown) {
        await this.#deleteThread(threadId).catch(() => undefined);
        throw new CodexAdapterError(
          CODEX_ADAPTER_ERROR_CODES.THREAD_CLEANUP_INCOMPLETE,
          error,
        );
      }
      await this.#assertNoHooks(task.workspaceRoot);
      await this.#assertNoMcpServers(threadId);
      await this.#runTurn(handoff, task, threadId, lifecycle, signal);
    } catch (error: unknown) {
      if (signal.aborted) throw abortError();
      if (error instanceof ActiveDeliveryUnknownError) throw error;
      this.#onEvent({
        type: "failure",
        revision: handoff.revision,
        reason: managedFailureReason(error, "apply"),
      });
      await lifecycle.report("failed").catch(() => undefined);
    } finally {
      if (threadId !== undefined && this.#threadCleanupAvailable()) {
        try {
          await this.#deleteThread(threadId);
          await this.#cleanupJournal.remove(threadId);
        } catch {
          this.#onEvent({
            type: "cleanup-warning",
            revision: handoff.revision,
          });
        }
      }
    }
  }

  close(): Promise<void> {
    this.#closePromise ??= this.#closeResources();
    return this.#closePromise;
  }

  async #assertNoMcpServers(threadId: string): Promise<void> {
    let cursor: string | null = null;
    const seen = new Set<string>();

    for (let page = 0; page < MAXIMUM_MCP_STATUS_PAGES; page += 1) {
      const value = await this.#request("mcpServerStatus/list", {
        cursor,
        limit: 100,
        detail: "toolsAndAuthOnly",
        threadId,
      });
      if (
        !isRecord(value) ||
        !Array.isArray(value.data) ||
        (value.nextCursor !== null &&
          value.nextCursor !== undefined &&
          typeof value.nextCursor !== "string")
      ) {
        throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL);
      }
      if (value.data.length > 0) {
        throw new CodexAdapterError(
          CODEX_ADAPTER_ERROR_CODES.CONFIG_ISOLATION_UNSUPPORTED,
        );
      }
      const nextCursor = value.nextCursor ?? null;
      if (nextCursor === null || seen.has(nextCursor)) return;
      seen.add(nextCursor);
      cursor = nextCursor;
    }
    throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL);
  }

  async #assertNoHooks(workspaceRoot: string): Promise<void> {
    const value = await this.#request("hooks/list", { cwds: [workspaceRoot] });
    if (!isRecord(value) || !Array.isArray(value.data) || value.data.length !== 1) {
      throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL);
    }
    const [entry] = value.data as unknown[];
    if (
      !isRecord(entry) ||
      entry.cwd !== workspaceRoot ||
      !Array.isArray(entry.hooks) ||
      !Array.isArray(entry.warnings) ||
      !Array.isArray(entry.errors)
    ) {
      throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL);
    }
    if (
      entry.hooks.length > 0 ||
      entry.warnings.length > 0 ||
      entry.errors.length > 0
    ) {
      throw new CodexAdapterError(
        CODEX_ADAPTER_ERROR_CODES.CONFIG_ISOLATION_UNSUPPORTED,
      );
    }
  }

  async #recoverThreadCleanup(): Promise<void> {
    try {
      for (const entry of await this.#cleanupJournal.list()) {
        await this.#deleteThread(entry.threadId).catch((error: unknown) => {
          if (isMissingThreadError(error, entry.threadId)) return;
          throw error;
        });
        await this.#cleanupJournal.remove(entry.threadId);
      }
    } catch (error: unknown) {
      throw new CodexAdapterError(
        CODEX_ADAPTER_ERROR_CODES.THREAD_CLEANUP_INCOMPLETE,
        error,
      );
    }
  }

  async #runTurn(
    handoff: AgentHandoffSnapshot,
    task: PreparedManagedTask,
    threadId: string,
    lifecycle: AgentDeliveryLifecycle,
    signal: AbortSignal,
  ): Promise<void> {
    let resolveTerminal: (() => void) | undefined;
    let rejectTerminal: ((error: Error) => void) | undefined;
    const terminal = new Promise<void>((resolve, reject) => {
      resolveTerminal = resolve;
      rejectTerminal = reject;
    });
    const active: ActiveManagedTurn = {
      events: [],
      handoff,
      lifecycle,
      reject: (error) => rejectTerminal?.(error),
      resolve: () => resolveTerminal?.(),
      signal,
      task,
      terminal,
      threadId,
      finalized: false,
      processing: Promise.resolve(),
      started: false,
      timeout: undefined,
      terminalEvent: undefined,
      turnId: undefined,
      written: false,
    };
    this.#active = active;
    const abort = (): void => {
      void this.#interruptAndFail(active, threadId);
    };
    signal.addEventListener("abort", abort, { once: true });

    try {
      const value = await this.#client.request(
        "turn/start",
        {
          threadId,
          input: [{ type: "text", text: task.prompt, text_elements: [] }],
          model: this.#model,
          cwd: task.workspaceRoot,
          approvalPolicy: "never",
        },
        () => {
          active.written = true;
        },
      );
      if (!isRecord(value) || !hasOnlyKeys(value, ["turn"])) {
        throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL);
      }
      const turn = parseTurn(value.turn);
      if (turn.status !== "inProgress") {
        throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL);
      }
      active.turnId = turn.id;
      await lifecycle.report("dispatched");
      active.timeout = setTimeout(() => {
        void this.#finishUnknown(active);
      }, this.#terminalTimeoutMs);
      active.timeout.unref();
      this.#schedule(active);
      await terminal;
    } catch (error: unknown) {
      const explicitlyRejected =
        error instanceof CodexAdapterError &&
        error.code === CODEX_ADAPTER_ERROR_CODES.REQUEST_FAILED;
      if (!active.finalized) {
        if (explicitlyRejected) {
          this.#onEvent({
            type: "failure",
            revision: handoff.revision,
            reason: "protocol",
          });
          await this.#finishFailed(active);
        } else if (active.written) {
          await this.#finishUnknown(active);
        } else {
          await this.#finishFailed(active);
        }
      }
      await terminal;
      if (error instanceof ActiveDeliveryUnknownError) throw error;
    } finally {
      signal.removeEventListener("abort", abort);
      this.#cleanup(active);
    }
  }

  #handleNotification(method: string, params: unknown): void {
    let event: TurnEvent | undefined;
    try {
      event = parseTurnEvent(method, params);
    } catch {
      const active = this.#active;
      if (active !== undefined) void this.#finishUnknown(active);
      this.#client.close();
      return;
    }
    if (event === undefined) return;
    const active = this.#active;
    if (
      active === undefined ||
      active.finalized ||
      event.threadId !== active.threadId
    ) {
      return;
    }
    active.events.push(event);
    this.#schedule(active);
  }

  #schedule(active: ActiveManagedTurn): void {
    if (active.turnId === undefined || active.finalized) return;
    active.processing = active.processing
      .then(async () => {
        while (active.events.length > 0 && !active.finalized) {
          const event = active.events.shift();
          if (event?.threadId !== active.threadId || event.turnId !== active.turnId) {
            continue;
          }
          if (event.kind === "started") {
            if (!active.started) {
              active.started = true;
              this.#onEvent({
                type: "phase",
                revision: active.handoff.revision,
                phase: "running",
              });
              await active.lifecycle.report("working");
            }
            const terminalEvent = active.terminalEvent;
            active.terminalEvent = undefined;
            if (terminalEvent !== undefined) {
              if (terminalEvent.status === "completed") {
                await this.#finishCompleted(active);
              } else {
                await this.#finishFailed(active);
              }
            }
            continue;
          }
          if (!active.started) {
            active.terminalEvent = event;
            continue;
          }
          if (event.status === "completed") await this.#finishCompleted(active);
          else await this.#finishFailed(active);
        }
      })
      .catch(async () => this.#finishUnknown(active));
  }

  async #finishCompleted(active: ActiveManagedTurn): Promise<void> {
    if (active.finalized) return;
    active.finalized = true;
    try {
      this.#onEvent({
        type: "phase",
        revision: active.handoff.revision,
        phase: "auditing",
      });
      const result: ManagedExecutionResult = await this.#execution.auditAndApply(
        active.task,
        active.signal,
        (phase) => {
          this.#onEvent({
            type: "phase",
            revision: active.handoff.revision,
            phase,
          });
        },
      );
      this.#onEvent({ type: "result", result });
      await active.lifecycle.report("completed");
      active.resolve();
    } catch (error: unknown) {
      this.#onEvent({
        type: "failure",
        revision: active.handoff.revision,
        reason: managedFailureReason(error, "apply"),
      });
      active.finalized = false;
      await this.#finishFailed(active);
    }
  }

  async #finishFailed(active: ActiveManagedTurn): Promise<void> {
    if (active.finalized) return;
    active.finalized = true;
    try {
      await active.lifecycle.report("failed");
    } finally {
      active.resolve();
    }
  }

  async #finishUnknown(active: ActiveManagedTurn): Promise<void> {
    if (active.finalized) return;
    active.finalized = true;
    await active.lifecycle.report("delivery-unknown").catch(() => undefined);
    active.reject(new ActiveDeliveryUnknownError());
  }

  async #interruptAndFail(active: ActiveManagedTurn, threadId: string): Promise<void> {
    if (active.turnId !== undefined && !this.#closed) {
      await this.#client
        .request("turn/interrupt", { threadId, turnId: active.turnId })
        .catch(() => undefined);
    }
    await this.#finishFailed(active);
  }

  async #deleteThread(threadId: string): Promise<void> {
    const value = await this.#request("thread/delete", { threadId });
    if (!isRecord(value) || Object.keys(value).length !== 0) {
      throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL);
    }
  }

  async #request(method: string, params: unknown): Promise<unknown> {
    this.#throwIfFatal();
    const value = await this.#client.request(method, params).catch((error: unknown) => {
      this.#throwIfFatal();
      throw error;
    });
    this.#throwIfFatal();
    return value;
  }

  #throwIfFatal(): void {
    if (this.#fatalError !== undefined) throw this.#fatalError;
  }

  #threadCleanupAvailable(): boolean {
    return !this.#closed;
  }

  #handleFatal(error: CodexAdapterError): void {
    this.#fatalError = error;
    this.#closed = true;
    if (this.#active !== undefined) void this.#finishUnknown(this.#active);
  }

  #cleanup(active: ActiveManagedTurn): void {
    if (active.timeout !== undefined) clearTimeout(active.timeout);
    if (this.#active === active) this.#active = undefined;
  }

  async #closeResources(): Promise<void> {
    this.#closed = true;
    if (this.#active !== undefined) await this.#finishUnknown(this.#active);
    this.#client.close();
    signalProcessTree(this.#child, "SIGTERM");
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.#child.removeListener("exit", finish);
        signalProcessTree(this.#child, "SIGKILL");
        resolve();
      };
      const timeout = setTimeout(finish, this.#processShutdownTimeoutMs);
      timeout.unref();
      this.#child.once("exit", finish);
      if (this.#child.exitCode !== null || this.#child.signalCode !== null) finish();
    });
  }
}

export async function connectManagedCodexAppServer(
  options: ConnectManagedCodexAppServerOptions,
): Promise<ManagedAdapterConnection> {
  return ManagedCodexAppServerAdapter.connect(options);
}
