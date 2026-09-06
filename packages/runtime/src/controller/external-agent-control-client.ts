import {
  EXTERNAL_AGENT_ACTIONS as ACTIONS,
  EXTERNAL_AGENT_AUTH_READINESS as AUTH_STATES,
  EXTERNAL_AGENT_CHECK_OUTCOMES as CHECK_OUTCOMES,
  EXTERNAL_AGENT_CONNECTION_STATES as CONNECTION_STATES,
  EXTERNAL_AGENT_CONTROL_LIMITS,
  EXTERNAL_AGENT_DELIVERY_STATUSES as DELIVERY_STATES,
  EXTERNAL_AGENT_ERROR_CODES as ERROR_CODES,
  EXTERNAL_AGENT_ERROR_RECOVERABILITY as RECOVERABILITY,
  EXTERNAL_AGENT_ERROR_STAGES as ERROR_STAGES,
  EXTERNAL_AGENT_EXECUTION_STATUSES as EXECUTION_STATES,
  EXTERNAL_AGENT_GRANT_STATES as GRANT_STATES,
  EXTERNAL_AGENT_MANAGED_PHASES as MANAGED_PHASES,
  EXTERNAL_AGENT_MODES as MODES,
  EXTERNAL_AGENT_VALIDATION_OUTCOMES as VALIDATION_OUTCOMES,
  SPOTPATCH_ENDPOINTS,
  SPOTPATCH_TOKEN_HEADER,
  type ExternalAgentControlCancelRequest,
  type ExternalAgentControlConnectRequest,
  type ExternalAgentControlDisconnectRequest,
  type ExternalAgentControlStatus,
  type ExternalAgentEvent,
  type ExternalAgentManagedResult,
} from "@spotpatch/shared/external-handoff-browser";

import {
  exactKeys,
  readBoundedJson,
  record,
  successData,
  validTimestamp,
} from "./browser-api.js";

const RESPONSE_OVERHEAD_BYTES = 64 * 1_024;

function member<const T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

function integer(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}

function optionalKeys(
  value: Readonly<Record<string, unknown>>,
  base: readonly string[],
  optional: readonly string[],
): boolean {
  return exactKeys(value, [
    ...base,
    ...optional.filter((key) => value[key] !== undefined),
  ]);
}

function safePath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 4_096 ||
    value.startsWith("/") ||
    value.includes("\\")
  ) {
    return false;
  }
  return value
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function parseFiles(
  value: unknown,
): NonNullable<ExternalAgentControlStatus["task"]>["files"] {
  if (
    !Array.isArray(value) ||
    value.length > EXTERNAL_AGENT_CONTROL_LIMITS.maximumChangedFiles
  ) {
    throw new TypeError("Invalid managed file summaries.");
  }
  return value.map((file) => {
    if (
      !record(file) ||
      !exactKeys(file, ["additions", "deletions", "path"]) ||
      !safePath(file.path) ||
      !integer(file.additions) ||
      !integer(file.deletions)
    ) {
      throw new TypeError("Invalid managed file summary.");
    }
    return Object.freeze({
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
    });
  });
}

function parseChecks(
  value: unknown,
): NonNullable<ExternalAgentControlStatus["task"]>["checks"] {
  if (
    !Array.isArray(value) ||
    value.length > EXTERNAL_AGENT_CONTROL_LIMITS.maximumChecks
  ) {
    throw new TypeError("Invalid managed check summaries.");
  }
  return value.map((check) => {
    if (
      !record(check) ||
      !optionalKeys(check, ["durationMs", "id", "outcome"], ["exitCode"]) ||
      typeof check.id !== "string" ||
      !/^[A-Za-z0-9._-]{1,128}$/u.test(check.id) ||
      !member(CHECK_OUTCOMES, check.outcome) ||
      !integer(check.durationMs) ||
      (check.exitCode !== undefined && !Number.isSafeInteger(check.exitCode))
    ) {
      throw new TypeError("Invalid managed check summary.");
    }
    return Object.freeze({
      id: check.id,
      outcome: check.outcome,
      durationMs: check.durationMs,
      ...(check.exitCode === undefined ? {} : { exitCode: check.exitCode as number }),
    });
  });
}

function parseTimings(
  value: unknown,
): NonNullable<ExternalAgentControlStatus["task"]>["timings"] {
  const keys = [
    "preparing",
    "agent",
    "auditing",
    "validating",
    "applying",
    "total",
  ] as const;
  if (!record(value) || !optionalKeys(value, [], keys)) {
    throw new TypeError("Invalid managed timings.");
  }
  for (const key of keys) {
    if (value[key] !== undefined && !integer(value[key])) {
      throw new TypeError("Invalid managed timing.");
    }
  }
  return Object.freeze(
    Object.fromEntries(
      keys.flatMap((key) => (value[key] === undefined ? [] : [[key, value[key]]])),
    ) as NonNullable<ExternalAgentControlStatus["task"]>["timings"],
  );
}

function parseTask(value: unknown): NonNullable<ExternalAgentControlStatus["task"]> {
  if (
    !record(value) ||
    !optionalKeys(
      value,
      [
        "checks",
        "deliveryStatus",
        "executionStatus",
        "files",
        "managedPhase",
        "revision",
        "timings",
      ],
      ["resultExpiresAt", "validationOutcome"],
    ) ||
    !integer(value.revision, 1) ||
    !member(DELIVERY_STATES, value.deliveryStatus) ||
    !member(EXECUTION_STATES, value.executionStatus) ||
    !member(MANAGED_PHASES, value.managedPhase) ||
    (value.validationOutcome !== undefined &&
      !member(VALIDATION_OUTCOMES, value.validationOutcome)) ||
    (value.resultExpiresAt !== undefined && !validTimestamp(value.resultExpiresAt))
  ) {
    throw new TypeError("Invalid managed task status.");
  }
  return Object.freeze({
    revision: value.revision,
    deliveryStatus: value.deliveryStatus,
    executionStatus: value.executionStatus,
    managedPhase: value.managedPhase,
    ...(value.validationOutcome === undefined
      ? {}
      : { validationOutcome: value.validationOutcome }),
    files: parseFiles(value.files),
    checks: parseChecks(value.checks),
    timings: parseTimings(value.timings),
    ...(value.resultExpiresAt === undefined
      ? {}
      : { resultExpiresAt: value.resultExpiresAt }),
  });
}

function validModel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= EXTERNAL_AGENT_CONTROL_LIMITS.maximumModelCharacters &&
    value.trim() === value
  );
}

export function parseExternalAgentControlStatus(
  value: unknown,
): ExternalAgentControlStatus {
  if (
    !record(value) ||
    !optionalKeys(
      value,
      [
        "adapter",
        "authReadiness",
        "connectionState",
        "grantState",
        "mode",
        "schemaVersion",
        "sequence",
        "updatedAt",
      ],
      ["effectiveModel", "error", "requestedModel", "task", "models"],
    ) ||
    value.schemaVersion !== 1 ||
    !integer(value.sequence) ||
    !member(MODES, value.mode) ||
    !member(CONNECTION_STATES, value.connectionState) ||
    !member(AUTH_STATES, value.authReadiness) ||
    !member(GRANT_STATES, value.grantState) ||
    !validTimestamp(value.updatedAt) ||
    (value.requestedModel !== undefined && !validModel(value.requestedModel)) ||
    (value.effectiveModel !== undefined && !validModel(value.effectiveModel)) ||
    (value.models !== undefined &&
      (!Array.isArray(value.models) ||
        value.models.length === 0 ||
        value.models.length > EXTERNAL_AGENT_CONTROL_LIMITS.maximumModels ||
        !value.models.every(validModel) ||
        new Set(value.models).size !== value.models.length)) ||
    !record(value.adapter) ||
    !exactKeys(value.adapter, ["availability", "kind", "maturity"]) ||
    value.adapter.kind !== "codex" ||
    value.adapter.maturity !== "experimental" ||
    (value.adapter.availability !== "available" &&
      value.adapter.availability !== "unavailable")
  ) {
    throw new TypeError("Invalid external Agent control status.");
  }
  let error: ExternalAgentControlStatus["error"];
  if (value.error !== undefined) {
    if (
      !record(value.error) ||
      !exactKeys(value.error, ["action", "code", "recoverability", "stage"]) ||
      !member(ERROR_CODES, value.error.code) ||
      !member(ERROR_STAGES, value.error.stage) ||
      !member(RECOVERABILITY, value.error.recoverability) ||
      !member(ACTIONS, value.error.action)
    ) {
      throw new TypeError("Invalid external Agent error.");
    }
    error = Object.freeze({
      code: value.error.code,
      stage: value.error.stage,
      recoverability: value.error.recoverability,
      action: value.error.action,
    });
  }
  return Object.freeze({
    schemaVersion: 1,
    sequence: value.sequence,
    mode: value.mode,
    adapter: Object.freeze({
      kind: "codex",
      maturity: "experimental",
      availability: value.adapter.availability,
    }),
    connectionState: value.connectionState,
    authReadiness: value.authReadiness,
    grantState: value.grantState,
    ...(value.models === undefined
      ? {}
      : { models: Object.freeze([...value.models] as string[]) }),
    ...(value.requestedModel === undefined
      ? {}
      : { requestedModel: value.requestedModel }),
    ...(value.effectiveModel === undefined
      ? {}
      : { effectiveModel: value.effectiveModel }),
    ...(value.task === undefined ? {} : { task: parseTask(value.task) }),
    ...(error === undefined ? {} : { error }),
    updatedAt: value.updatedAt,
  });
}

export function parseExternalAgentManagedResult(
  value: unknown,
): ExternalAgentManagedResult {
  if (
    !record(value) ||
    !exactKeys(value, [
      "checks",
      "diff",
      "expiresAt",
      "files",
      "revision",
      "timings",
      "validationOutcome",
    ]) ||
    !integer(value.revision, 1) ||
    typeof value.diff !== "string" ||
    value.diff.length > EXTERNAL_AGENT_CONTROL_LIMITS.maximumResultDiffBytes ||
    !validTimestamp(value.expiresAt) ||
    !member(VALIDATION_OUTCOMES, value.validationOutcome)
  ) {
    throw new TypeError("Invalid managed Agent result.");
  }
  return Object.freeze({
    revision: value.revision,
    diff: value.diff,
    files: parseFiles(value.files),
    checks: parseChecks(value.checks),
    timings: parseTimings(value.timings),
    validationOutcome: value.validationOutcome,
    expiresAt: value.expiresAt,
  });
}

function parseEvent(value: unknown): ExternalAgentEvent {
  if (!record(value) || typeof value.type !== "string") {
    throw new TypeError("Invalid external Agent event.");
  }
  if (value.type === "status" && exactKeys(value, ["data", "type"])) {
    return Object.freeze({
      type: "status",
      data: parseExternalAgentControlStatus(value.data),
    });
  }
  if (
    value.type === "heartbeat" &&
    exactKeys(value, ["emittedAt", "sequence", "type"]) &&
    integer(value.sequence) &&
    validTimestamp(value.emittedAt)
  ) {
    return Object.freeze({
      type: "heartbeat",
      sequence: value.sequence,
      emittedAt: value.emittedAt,
    });
  }
  throw new TypeError("Invalid external Agent event.");
}

export interface ExternalAgentControlClient {
  status(): Promise<ExternalAgentControlStatus>;
  connect(
    request: ExternalAgentControlConnectRequest,
  ): Promise<ExternalAgentControlStatus>;
  disconnect(
    request: ExternalAgentControlDisconnectRequest,
  ): Promise<ExternalAgentControlStatus>;
  cancel(
    request: ExternalAgentControlCancelRequest,
  ): Promise<ExternalAgentControlStatus>;
  result(revision: number): Promise<ExternalAgentManagedResult>;
  events(
    afterSequence: number | undefined,
    signal: AbortSignal,
    onEvent: (event: ExternalAgentEvent) => void,
  ): Promise<void>;
}

export function createExternalAgentControlClient(
  fetch: typeof globalThis.fetch,
  sessionToken: string,
): ExternalAgentControlClient {
  const request = async (
    endpoint: string,
    body: unknown,
    maximumBytes = RESPONSE_OVERHEAD_BYTES,
  ): Promise<unknown> => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [SPOTPATCH_TOKEN_HEADER]: sessionToken,
      },
      body: JSON.stringify(body),
    });
    const envelope = await readBoundedJson(response, maximumBytes);
    if (!response.ok) throw new TypeError("External Agent control request failed.");
    return successData(envelope);
  };

  return Object.freeze({
    async status() {
      return parseExternalAgentControlStatus(
        await request(SPOTPATCH_ENDPOINTS.externalAgentControlStatus, {}),
      );
    },
    async connect(value: ExternalAgentControlConnectRequest) {
      return parseExternalAgentControlStatus(
        await request(SPOTPATCH_ENDPOINTS.externalAgentControlConnect, value),
      );
    },
    async disconnect(value: ExternalAgentControlDisconnectRequest) {
      return parseExternalAgentControlStatus(
        await request(SPOTPATCH_ENDPOINTS.externalAgentControlDisconnect, value),
      );
    },
    async cancel(value: ExternalAgentControlCancelRequest) {
      return parseExternalAgentControlStatus(
        await request(SPOTPATCH_ENDPOINTS.externalAgentControlCancel, value),
      );
    },
    async result(revision: number) {
      return parseExternalAgentManagedResult(
        await request(
          SPOTPATCH_ENDPOINTS.externalAgentResult,
          { revision },
          EXTERNAL_AGENT_CONTROL_LIMITS.maximumResultDiffBytes +
            RESPONSE_OVERHEAD_BYTES,
        ),
      );
    },
    async events(
      afterSequence: number | undefined,
      signal: AbortSignal,
      onEvent: (event: ExternalAgentEvent) => void,
    ): Promise<void> {
      const response = await fetch(SPOTPATCH_ENDPOINTS.externalAgentEvents, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [SPOTPATCH_TOKEN_HEADER]: sessionToken,
        },
        body: JSON.stringify(afterSequence === undefined ? {} : { afterSequence }),
        signal,
      });
      if (!response.ok || response.body === null) {
        await response.body?.cancel();
        throw new TypeError("External Agent event stream is unavailable.");
      }
      const reader = response.body.getReader();
      let pending = new Uint8Array(0);

      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          const combined = new Uint8Array(pending.byteLength + chunk.value.byteLength);
          combined.set(pending);
          combined.set(chunk.value, pending.byteLength);
          pending = combined;

          for (;;) {
            const newline = pending.indexOf(0x0a);
            if (newline === -1) break;
            if (
              newline === 0 ||
              newline > EXTERNAL_AGENT_CONTROL_LIMITS.maximumEventLineBytes
            ) {
              throw new TypeError("External Agent event line is invalid.");
            }
            const line = pending.slice(0, newline);
            pending = pending.slice(newline + 1);
            const value = JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(line),
            ) as unknown;
            onEvent(parseEvent(value));
          }
          if (
            pending.byteLength > EXTERNAL_AGENT_CONTROL_LIMITS.maximumEventLineBytes
          ) {
            throw new TypeError("External Agent event line exceeds its limit.");
          }
        }
        if (pending.byteLength !== 0) {
          throw new TypeError("External Agent event stream ended mid-record.");
        }
      } finally {
        reader.releaseLock();
      }
    },
  });
}
