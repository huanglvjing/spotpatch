import { createInterface } from "node:readline/promises";

import {
  ERROR_CODES,
  EXTERNAL_AGENT_CONTROL_SCHEMA_VERSION,
  EXTERNAL_AGENT_MANAGED_PROFILE,
  SpotPatchError,
  externalAgentControlStatusSchema,
  externalAgentManagedResultSchema,
  type AgentLimits,
  type ExternalAgentAction,
  type ExternalAgentControlCancelRequest,
  type ExternalAgentControlConnectRequest,
  type ExternalAgentControlDisconnectRequest,
  type ExternalAgentControlStatus,
  type ExternalAgentErrorCode,
  type ExternalAgentManagedResult,
  type ResolvedAgentCheckDefinition,
} from "@spotpatch/shared";
import {
  createManagedExecutionRunner,
  type ManagedExecutionPort,
  type ManagedExecutionResult,
} from "@spotpatch/agent";

import { createActiveEventPump, type ActiveEventPump } from "../active/event-pump.js";
import { connectManagedCodexAppServer } from "../active/codex/managed-adapter.js";
import { removeManagedCodexRuntimeHome } from "../active/codex/managed-runtime.js";
import type { AgentAdapter } from "../active/types.js";
import { createSpotPatchBridgeClient } from "../client.js";
import type { BridgeCliAdapter } from "../setup.js";
import { createManagedGrantStore, type ManagedGrantStore } from "./grant-store.js";
import {
  createManagedThreadCleanupJournal,
  type ManagedThreadCleanupJournal,
} from "./thread-cleanup-journal.js";

const MAXIMUM_IDEMPOTENCY_RECORDS = 64;
const MAXIMUM_RESULT_RECORDS = 16;

export type ManagedAdapterEvent =
  | Readonly<{
      type: "phase";
      revision: number;
      phase: "preparing" | "running" | "auditing" | "validating" | "applying";
    }>
  | Readonly<{
      type: "result";
      result: ManagedExecutionResult;
    }>
  | Readonly<{
      type: "cleanup-warning";
      revision: number;
    }>
  | Readonly<{
      type: "failure";
      revision: number;
      reason:
        | "apply"
        | "change-limit"
        | "config-isolation"
        | "protocol"
        | "scope"
        | "snapshot"
        | "validation"
        | "workspace-conflict";
    }>;

export interface ManagedAdapterConnection {
  readonly adapter: AgentAdapter;
  readonly authReadiness:
    "authenticated" | "auth-not-required" | "signed-out" | "unknown";
  readonly requestedModel?: string;
  readonly effectiveModel?: string;
}

export interface ConnectManagedAdapterOptions {
  readonly bridgeAdapter: BridgeCliAdapter;
  readonly execution: ManagedExecutionPort;
  readonly cleanupJournal: ManagedThreadCleanupJournal;
  readonly onEvent: (event: ManagedAdapterEvent) => void;
  readonly privateRuntimeBase?: string;
  readonly projectRoot: string;
  readonly runtimeKey: string;
  readonly sessionId: string;
  readonly signal: AbortSignal;
}

export type ConnectManagedAdapter = (
  options: ConnectManagedAdapterOptions,
) => Promise<ManagedAdapterConnection>;

export interface ExternalAgentSupervisor {
  getStatus(): ExternalAgentControlStatus;
  connect(
    request: ExternalAgentControlConnectRequest,
    signal: AbortSignal,
  ): Promise<ExternalAgentControlStatus>;
  disconnect(
    request: ExternalAgentControlDisconnectRequest,
  ): Promise<ExternalAgentControlStatus>;
  cancel(
    request: ExternalAgentControlCancelRequest,
  ): Promise<ExternalAgentControlStatus>;
  getResult(revision: number): ExternalAgentManagedResult | undefined;
  subscribe(listener: (status: ExternalAgentControlStatus) => void): () => void;
  dispose(): Promise<void>;
}

export interface CreateExternalAgentSupervisorOptions {
  readonly bridgeAdapter: BridgeCliAdapter;
  readonly checks?: Readonly<Record<string, ResolvedAgentCheckDefinition>>;
  readonly configBase?: string;
  readonly confirmManagedAccess?: (projectLabel: string) => Promise<boolean>;
  readonly connectManagedAdapter?: ConnectManagedAdapter;
  readonly limits?: Readonly<AgentLimits>;
  readonly now?: () => Date;
  readonly projectLabel?: string;
  readonly root: string;
  readonly sessionId: string;
}

interface ActiveConnection {
  readonly controller: AbortController;
  readonly execution: ManagedExecutionPort;
  readonly pump: ActiveEventPump;
  readonly run: Promise<void>;
}

interface IdempotencyRecord {
  readonly fingerprint: string;
  readonly result: Promise<ExternalAgentControlStatus>;
}

function managedError(
  code: ExternalAgentErrorCode,
  stage: NonNullable<ExternalAgentControlStatus["error"]>["stage"],
  recoverability: NonNullable<ExternalAgentControlStatus["error"]>["recoverability"],
  action: ExternalAgentAction,
): NonNullable<ExternalAgentControlStatus["error"]> {
  return Object.freeze({ code, stage, recoverability, action });
}

function classifyConnectionError(
  error: unknown,
): NonNullable<ExternalAgentControlStatus["error"]> {
  if (error instanceof SpotPatchError) {
    if (error.code === ERROR_CODES.WORKTREE_NOT_REPOSITORY) {
      return managedError(
        "MANAGED_GIT_REQUIRED",
        "snapshot",
        "reconfigure",
        "use-inbox",
      );
    }
    if (
      error.code === ERROR_CODES.WORKTREE_DIRTY ||
      error.code === ERROR_CODES.WORKTREE_CONFLICTED ||
      error.code === ERROR_CODES.WORKTREE_OPERATION_IN_PROGRESS
    ) {
      return managedError(
        "MANAGED_SNAPSHOT_FAILED",
        "snapshot",
        "user-action",
        "review-workspace-conflict",
      );
    }
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    if (error.code === "CODEX_EXECUTABLE_NOT_FOUND") {
      return managedError(
        "AGENT_BINARY_NOT_FOUND",
        "binary",
        "user-action",
        "install-agent",
      );
    }
    if (error.code === "CODEX_EXECUTABLE_UNTRUSTED") {
      return managedError(
        "AGENT_BINARY_UNTRUSTED",
        "binary",
        "reconfigure",
        "use-inbox",
      );
    }
    if (error.code === "CODEX_UNSUPPORTED_VERSION") {
      return managedError(
        "AGENT_VERSION_UNSUPPORTED",
        "protocol",
        "user-action",
        "use-supported-version",
      );
    }
    if (error.code === "CODEX_AUTH_REQUIRED") {
      return managedError("AGENT_AUTH_REQUIRED", "auth", "user-action", "sign-in");
    }
    if (error.code === "CODEX_MODEL_UNAVAILABLE") {
      return managedError(
        "AGENT_MODEL_UNAVAILABLE",
        "model",
        "user-action",
        "choose-available-model",
      );
    }
    if (error.code === "CODEX_CONFIG_ISOLATION_UNSUPPORTED") {
      return managedError(
        "CODEX_CONFIG_ISOLATION_UNSUPPORTED",
        "protocol",
        "reconfigure",
        "use-inbox",
      );
    }
    if (
      error.code === "CODEX_APP_SERVER_PROTOCOL_ERROR" ||
      error.code === "CODEX_APP_SERVER_SCHEMA_INCOMPATIBLE"
    ) {
      return managedError(
        "AGENT_PROTOCOL_INCOMPATIBLE",
        "protocol",
        "reconfigure",
        "use-supported-version",
      );
    }
    if (error.code === "CODEX_THREAD_CLEANUP_INCOMPLETE") {
      return managedError(
        "MANAGED_CLEANUP_INCOMPLETE",
        "cleanup",
        "user-action",
        "inspect-cleanup-warning",
      );
    }
  }

  return managedError("APP_SERVER_HANDSHAKE_FAILED", "handshake", "retry", "retry");
}

function managedExecutionError(
  reason: Extract<ManagedAdapterEvent, { type: "failure" }>["reason"],
): NonNullable<ExternalAgentControlStatus["error"]> {
  switch (reason) {
    case "config-isolation":
      return managedError(
        "CODEX_CONFIG_ISOLATION_UNSUPPORTED",
        "protocol",
        "reconfigure",
        "use-inbox",
      );
    case "protocol":
      return managedError(
        "AGENT_PROTOCOL_INCOMPATIBLE",
        "protocol",
        "reconfigure",
        "use-supported-version",
      );
    case "snapshot":
      return managedError(
        "MANAGED_SNAPSHOT_FAILED",
        "snapshot",
        "user-action",
        "review-workspace-conflict",
      );
    case "scope":
      return managedError(
        "MANAGED_SCOPE_VIOLATION",
        "audit",
        "reconfigure",
        "use-inbox",
      );
    case "change-limit":
      return managedError(
        "MANAGED_CHANGE_LIMIT_EXCEEDED",
        "audit",
        "reconfigure",
        "use-inbox",
      );
    case "validation":
      return managedError(
        "MANAGED_VALIDATION_FAILED",
        "validation",
        "user-action",
        "review-candidate-diff",
      );
    case "workspace-conflict":
      return managedError(
        "MANAGED_WORKSPACE_CONFLICT",
        "apply",
        "user-action",
        "review-workspace-conflict",
      );
    case "apply":
      return managedError(
        "MANAGED_APPLY_FAILED",
        "apply",
        "user-action",
        "review-candidate-diff",
      );
  }
}

async function defaultTerminalConfirmation(projectLabel: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const reader = createInterface({ input: process.stdin, output: process.stdout });

  try {
    process.stdout.write(
      [
        "\nSpotPatch managed Agent access request",
        `Project: ${projectLabel}`,
        "Adapter: Codex",
        `Profile: ${EXTERNAL_AGENT_MANAGED_PROFILE}`,
        "Codex may write only an independent temporary snapshot. SpotPatch audits, validates, and applies eligible changes.",
        "You can revoke this grant from the SpotPatch panel.",
      ].join("\n") + "\n",
    );
    const answer = (await reader.question('Type "yes" to grant access: '))
      .trim()
      .toLowerCase();
    return answer === "yes";
  } finally {
    reader.close();
  }
}

function requestFingerprint(value: unknown): string {
  return JSON.stringify(value);
}

function taskStatus(
  revision: number,
  phase: NonNullable<ExternalAgentControlStatus["task"]>["managedPhase"],
  current?: ExternalAgentControlStatus["task"],
): NonNullable<ExternalAgentControlStatus["task"]> {
  return Object.freeze({
    revision,
    deliveryStatus: current?.deliveryStatus ?? "queued",
    executionStatus: current?.executionStatus ?? "not-observable",
    managedPhase: phase,
    ...(current?.validationOutcome === undefined
      ? {}
      : { validationOutcome: current.validationOutcome }),
    files: [...(current?.files ?? [])],
    checks: [...(current?.checks ?? [])],
    timings: current?.timings ?? Object.freeze({}),
    ...(current?.resultExpiresAt === undefined
      ? {}
      : { resultExpiresAt: current.resultExpiresAt }),
  });
}

export async function createExternalAgentSupervisor(
  options: CreateExternalAgentSupervisorOptions,
): Promise<ExternalAgentSupervisor> {
  const now = options.now ?? (() => new Date());
  const grantStore: ManagedGrantStore = await createManagedGrantStore({
    root: options.root,
    ...(options.configBase === undefined ? {} : { configBase: options.configBase }),
    now,
  });
  const cleanupJournal = await createManagedThreadCleanupJournal({
    root: options.root,
    ...(options.configBase === undefined ? {} : { configBase: options.configBase }),
    now,
  });
  const listeners = new Set<(status: ExternalAgentControlStatus) => void>();
  const idempotency = new Map<string, IdempotencyRecord>();
  const results = new Map<number, ExternalAgentManagedResult>();
  let connection: ActiveConnection | undefined;
  let disposed = false;
  let operationTail: Promise<void> = Promise.resolve();
  let status = externalAgentControlStatusSchema.parse({
    schemaVersion: EXTERNAL_AGENT_CONTROL_SCHEMA_VERSION,
    sequence: 0,
    mode: "inbox",
    adapter: {
      kind: "codex",
      maturity: "experimental",
      availability: "unavailable",
    },
    connectionState: "disconnected",
    authReadiness: "unknown",
    grantState: await grantStore.read(),
    updatedAt: now().toISOString(),
  });

  const publish = (
    update: Omit<
      Partial<ExternalAgentControlStatus>,
      "schemaVersion" | "sequence" | "updatedAt"
    >,
  ): ExternalAgentControlStatus => {
    status = externalAgentControlStatusSchema.parse({
      ...status,
      ...update,
      schemaVersion: EXTERNAL_AGENT_CONTROL_SCHEMA_VERSION,
      sequence: status.sequence + 1,
      updatedAt: now().toISOString(),
    });
    for (const listener of listeners) {
      try {
        listener(status);
      } catch {
        // Observers cannot affect the Supervisor lifecycle.
      }
    }
    return status;
  };

  const rememberResult = (result: ManagedExecutionResult): void => {
    const managedResult = externalAgentManagedResultSchema.parse({
      revision: result.revision,
      diff: result.diff,
      files: result.files,
      checks: result.checks,
      timings: result.timings,
      validationOutcome: result.validationOutcome,
      expiresAt: result.expiresAt,
    });
    results.set(result.revision, managedResult);
    while (results.size > MAXIMUM_RESULT_RECORDS) {
      const oldest = results.keys().next().value;
      if (oldest === undefined) break;
      results.delete(oldest);
    }
    publish({
      task: Object.freeze({
        revision: result.revision,
        deliveryStatus: "accepted",
        executionStatus: "terminal-succeeded",
        managedPhase: result.applied ? "completed" : "review-required",
        validationOutcome: result.validationOutcome,
        files: [...result.files],
        checks: [...result.checks],
        timings: result.timings,
        resultExpiresAt: result.expiresAt,
      }),
    });
  };

  const stopConnection = async (): Promise<void> => {
    const active = connection;
    connection = undefined;
    if (active === undefined) return;
    active.controller.abort("supervisor-disconnect");
    await active.pump.close().catch(() => undefined);
    await active.run.catch(() => undefined);
    await active.execution.dispose().catch(() => undefined);
  };

  const connectInternal = async (
    allowPrompt: boolean,
  ): Promise<ExternalAgentControlStatus> => {
    if (disposed) throw new SpotPatchError(ERROR_CODES.SESSION_CLOSED);
    if (connection !== undefined) return status;
    if (process.platform === "win32") {
      return publish({
        mode: "inbox",
        connectionState: "degraded",
        error: managedError(
          "MANAGED_PLATFORM_UNSUPPORTED",
          "integration",
          "none",
          "use-inbox",
        ),
      });
    }

    publish({ connectionState: "diagnosing", error: undefined });
    let grantState = await grantStore.read();
    if (grantState === "invalid") {
      return publish({
        grantState,
        connectionState: "error",
        error: managedError(
          "MANAGED_GRANT_INVALID",
          "integration",
          "user-action",
          "confirm-managed-access",
        ),
      });
    }
    if (grantState === "missing") {
      publish({ grantState, connectionState: "awaiting-consent", mode: "inbox" });
      if (!allowPrompt) return status;
      const confirmed = await (
        options.confirmManagedAccess ?? defaultTerminalConfirmation
      )(options.projectLabel ?? grantStore.projectKey.slice(0, 12));
      if (!confirmed) return status;
      await grantStore.grant();
      grantState = "valid";
      publish({ grantState });
    }

    publish({ connectionState: "connecting", mode: "inbox", error: undefined });
    const controller = new AbortController();
    const execution = createManagedExecutionRunner({
      root: options.root,
      ...(options.checks === undefined ? {} : { checks: options.checks }),
      ...(options.limits === undefined ? {} : { limits: options.limits }),
    });

    try {
      const adapterConnection = await (
        options.connectManagedAdapter ?? connectManagedCodexAppServer
      )({
        bridgeAdapter: options.bridgeAdapter,
        execution,
        cleanupJournal,
        onEvent(event) {
          if (event.type === "cleanup-warning") {
            const current =
              status.task?.revision === event.revision ? status.task : undefined;
            publish({
              mode: "inbox",
              connectionState: "degraded",
              task: taskStatus(event.revision, "cleanup-warning", current),
              error: managedError(
                "MANAGED_CLEANUP_INCOMPLETE",
                "cleanup",
                "user-action",
                "inspect-cleanup-warning",
              ),
            });
            controller.abort("managed-cleanup-incomplete");
            return;
          }
          if (event.type === "failure") {
            const current =
              status.task?.revision === event.revision ? status.task : undefined;
            const fatal =
              event.reason === "config-isolation" || event.reason === "protocol";
            publish({
              ...(fatal ? { mode: "inbox", connectionState: "degraded" as const } : {}),
              task: taskStatus(event.revision, "failed", current),
              error: managedExecutionError(event.reason),
            });
            if (fatal) controller.abort("managed-config-isolation-unsupported");
            return;
          }
          if (event.type === "result") {
            rememberResult(event.result);
            return;
          }
          const current =
            status.task?.revision === event.revision ? status.task : undefined;
          publish({
            task: taskStatus(event.revision, event.phase, current),
          });
        },
        projectRoot: options.root,
        ...(options.configBase === undefined
          ? {}
          : { privateRuntimeBase: options.configBase }),
        runtimeKey: grantStore.projectKey,
        sessionId: options.sessionId,
        signal: controller.signal,
      });
      await grantStore.touch();
      const pump = createActiveEventPump({
        adapter: adapterConnection.adapter,
        client: createSpotPatchBridgeClient(options.root),
        sessionId: options.sessionId,
        onEvent(event) {
          if (event.type === "ready") {
            publish({ connectionState: "ready", mode: "managed", error: undefined });
            return;
          }
          const current =
            status.task?.revision === event.revision ? status.task : undefined;
          const task = taskStatus(
            event.revision,
            event.phase === "working"
              ? "running"
              : event.phase === "completed"
                ? (current?.managedPhase ?? "completed")
                : event.phase === "failed" || event.phase === "delivery-unknown"
                  ? "failed"
                  : (current?.managedPhase ?? "preparing"),
            current,
          );
          publish({
            connectionState:
              event.phase === "completed" || event.phase === "failed"
                ? "ready"
                : "busy",
            task: Object.freeze({
              ...task,
              deliveryStatus:
                event.phase === "dispatching"
                  ? "dispatching"
                  : event.phase === "delivery-unknown"
                    ? "unknown"
                    : "accepted",
              executionStatus:
                event.phase === "working"
                  ? "started"
                  : event.phase === "completed"
                    ? "terminal-succeeded"
                    : event.phase === "failed"
                      ? "terminal-failed"
                      : event.phase === "delivery-unknown"
                        ? "unknown"
                        : task.executionStatus,
            }),
          });
        },
      });
      const run = pump
        .run(controller.signal)
        .catch((error: unknown) => {
          if (!controller.signal.aborted && !disposed) {
            publish({
              mode: "inbox",
              connectionState: "degraded",
              error: classifyConnectionError(error),
            });
          }
        })
        .finally(async () => {
          if (connection?.controller === controller) connection = undefined;
          await execution.dispose().catch(() => undefined);
        });
      const activeConnection: ActiveConnection = {
        controller,
        execution,
        pump,
        run,
      };
      connection = activeConnection;
      publish({
        adapter: {
          kind: "codex",
          maturity: "experimental",
          availability: "available",
        },
        authReadiness: adapterConnection.authReadiness,
        ...(adapterConnection.requestedModel === undefined
          ? {}
          : { requestedModel: adapterConnection.requestedModel }),
        ...(adapterConnection.effectiveModel === undefined
          ? {}
          : { effectiveModel: adapterConnection.effectiveModel }),
      });
      return status;
    } catch (error: unknown) {
      controller.abort("supervisor-connect-failed");
      await execution.dispose().catch(() => undefined);
      const classified = classifyConnectionError(error);
      return publish({
        mode: "inbox",
        connectionState: "degraded",
        ...(classified.code === "AGENT_AUTH_REQUIRED"
          ? { authReadiness: "signed-out" as const }
          : {}),
        error: classified,
      });
    }
  };

  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operationTail.then(operation, operation);
    operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const idempotent = (
    requestId: string,
    fingerprint: string,
    operation: () => Promise<ExternalAgentControlStatus>,
  ): Promise<ExternalAgentControlStatus> => {
    const prior = idempotency.get(requestId);
    if (prior !== undefined) {
      if (prior.fingerprint !== fingerprint) {
        return Promise.reject(new SpotPatchError(ERROR_CODES.INVALID_REQUEST));
      }
      return prior.result;
    }
    const result = serialize(operation);
    idempotency.set(requestId, { fingerprint, result });
    while (idempotency.size > MAXIMUM_IDEMPOTENCY_RECORDS) {
      const oldest = idempotency.keys().next().value;
      if (oldest === undefined) break;
      idempotency.delete(oldest);
    }
    return result;
  };

  const supervisor: ExternalAgentSupervisor = Object.freeze({
    getStatus: () => status,
    connect(request: ExternalAgentControlConnectRequest, signal: AbortSignal) {
      return idempotent(request.requestId, requestFingerprint(request), async () => {
        if (signal.aborted) throw new SpotPatchError(ERROR_CODES.AGENT_CANCELLED);
        return connectInternal(true);
      });
    },
    disconnect(request: ExternalAgentControlDisconnectRequest) {
      return idempotent(request.requestId, requestFingerprint(request), async () => {
        publish({ connectionState: "disconnecting" });
        await stopConnection();
        if (request.revokeGrant) {
          await removeManagedCodexRuntimeHome({
            ...(options.configBase === undefined
              ? {}
              : { runtimeBase: options.configBase }),
            runtimeKey: grantStore.projectKey,
          });
          await grantStore.revoke();
        }
        return publish({
          mode: "inbox",
          connectionState: "disconnected",
          grantState: await grantStore.read(),
          authReadiness: "unknown",
          requestedModel: undefined,
          effectiveModel: undefined,
          error: undefined,
        });
      });
    },
    cancel(request: ExternalAgentControlCancelRequest) {
      return idempotent(request.requestId, requestFingerprint(request), async () => {
        if (status.task?.revision !== request.revision) {
          throw new SpotPatchError(ERROR_CODES.HANDOFF_NOT_FOUND);
        }
        await stopConnection();
        return publish({
          mode: "inbox",
          connectionState: "disconnected",
          task: Object.freeze({
            ...taskStatus(request.revision, "cancelled", status.task),
            executionStatus: "interrupted",
          }),
        });
      });
    },
    getResult(revision: number) {
      const result = results.get(revision);
      if (result === undefined) return undefined;
      if (Date.parse(result.expiresAt) <= now().getTime()) {
        results.delete(revision);
        return undefined;
      }
      return result;
    },
    subscribe(listener: (status: ExternalAgentControlStatus) => void) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      await serialize(stopConnection);
      idempotency.clear();
      results.clear();
    },
  });

  if (status.grantState === "valid") {
    void serialize(async () => {
      await connectInternal(false);
    });
  }
  return supervisor;
}
