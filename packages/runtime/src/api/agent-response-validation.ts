import {
  AGENT_CAPABILITY_STATES,
  AGENT_CHECK_STATUSES,
  AGENT_FILE_CHANGE_KINDS,
  AGENT_JOB_STATUSES,
  ERROR_CODES,
  type AgentCapabilitySnapshot,
  type AgentJobEvent,
  type AgentJobResultResponse,
  type AgentJobSnapshot,
  type ErrorCode,
} from "@spotpatch/shared";

// Keep this browser-safe mirror aligned with the shared Zod schemas. Importing Zod
// here would violate the runtime bundle boundary; the parity test covers both paths.

const ERROR_CODE_VALUES = new Set<string>(Object.values(ERROR_CODES));
const CAPABILITY_STATE_VALUES = new Set<string>(AGENT_CAPABILITY_STATES);
const CHECK_STATUS_VALUES = new Set<string>(AGENT_CHECK_STATUSES);
const FILE_CHANGE_KIND_VALUES = new Set<string>(AGENT_FILE_CHANGE_KINDS);
const JOB_STATUS_VALUES = new Set<string>(AGENT_JOB_STATUSES);
const PROFILE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const JOB_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isBoundedString(value: unknown, maximum: number, minimum = 0): boolean {
  return (
    typeof value === "string" && value.length >= minimum && value.length <= maximum
  );
}

function isProfileId(value: unknown): boolean {
  return (
    isBoundedString(value, 64, 1) &&
    typeof value === "string" &&
    PROFILE_ID_PATTERN.test(value)
  );
}

function isJobId(value: unknown): value is string {
  return (
    isBoundedString(value, 128, 22) &&
    typeof value === "string" &&
    JOB_ID_PATTERN.test(value)
  );
}

function isIsoTimestamp(value: unknown): boolean {
  return (
    typeof value === "string" &&
    ISO_TIMESTAMP_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isNonnegativeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isOptionalBoundedString(value: unknown, maximum: number): boolean {
  return value === undefined || isBoundedString(value, maximum);
}

export function isAgentErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && ERROR_CODE_VALUES.has(value);
}

export function isAgentCapabilitySnapshot(
  value: unknown,
): value is AgentCapabilitySnapshot {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "providerProfileId",
      "providerLabel",
      "modelProfileId",
      "modelLabel",
      "protocol",
      "state",
      "authenticated",
      "modelAvailable",
      "toolCalling",
      "toolResultContinuation",
      "streaming",
      "checkedAt",
      "errorCode",
    ])
  ) {
    return false;
  }

  return (
    isProfileId(value.providerProfileId) &&
    isBoundedString(value.providerLabel, 100) &&
    isProfileId(value.modelProfileId) &&
    isBoundedString(value.modelLabel, 100) &&
    (value.protocol === "responses" || value.protocol === "chat-completions") &&
    typeof value.state === "string" &&
    CAPABILITY_STATE_VALUES.has(value.state) &&
    typeof value.authenticated === "boolean" &&
    typeof value.modelAvailable === "boolean" &&
    typeof value.toolCalling === "boolean" &&
    typeof value.toolResultContinuation === "boolean" &&
    typeof value.streaming === "boolean" &&
    (value.checkedAt === undefined || isIsoTimestamp(value.checkedAt)) &&
    (value.errorCode === undefined || isAgentErrorCode(value.errorCode))
  );
}

export function isAgentJobSnapshot(value: unknown): value is AgentJobSnapshot {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "jobId",
      "status",
      "providerProfileId",
      "providerLabel",
      "modelProfileId",
      "modelLabel",
      "phaseMessage",
      "createdAt",
      "updatedAt",
      "canCancel",
      "canApply",
      "canRevert",
      "errorCode",
    ])
  ) {
    return false;
  }

  return (
    isJobId(value.jobId) &&
    typeof value.status === "string" &&
    JOB_STATUS_VALUES.has(value.status) &&
    isProfileId(value.providerProfileId) &&
    isBoundedString(value.providerLabel, 100) &&
    isProfileId(value.modelProfileId) &&
    isBoundedString(value.modelLabel, 100) &&
    isBoundedString(value.phaseMessage, 1_024) &&
    isIsoTimestamp(value.createdAt) &&
    isIsoTimestamp(value.updatedAt) &&
    typeof value.canCancel === "boolean" &&
    typeof value.canApply === "boolean" &&
    typeof value.canRevert === "boolean" &&
    (value.errorCode === undefined || isAgentErrorCode(value.errorCode))
  );
}

function isAgentChangedFile(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["relativePath", "kind", "additions", "deletions"]) &&
    isBoundedString(value.relativePath, 1_024) &&
    typeof value.kind === "string" &&
    FILE_CHANGE_KIND_VALUES.has(value.kind) &&
    isNonnegativeInteger(value.additions) &&
    isNonnegativeInteger(value.deletions)
  );
}

function isAgentCheckResult(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["checkId", "label", "status", "durationMs", "output"]) &&
    isProfileId(value.checkId) &&
    isBoundedString(value.label, 100) &&
    typeof value.status === "string" &&
    CHECK_STATUS_VALUES.has(value.status) &&
    isNonnegativeInteger(value.durationMs) &&
    isBoundedString(value.output, 80_000)
  );
}

function isAgentJobResult(
  value: unknown,
): value is NonNullable<AgentJobResultResponse["result"]> {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["jobId", "summary", "diff", "files", "checks"]) &&
    isJobId(value.jobId) &&
    isBoundedString(value.summary, 80_000) &&
    isBoundedString(value.diff, 1_000_000) &&
    Array.isArray(value.files) &&
    value.files.length <= 100 &&
    value.files.every(isAgentChangedFile) &&
    Array.isArray(value.checks) &&
    value.checks.length <= 100 &&
    value.checks.every(isAgentCheckResult)
  );
}

export function isAgentJobResultResponse(
  value: unknown,
): value is AgentJobResultResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["snapshot", "result"]) &&
    isAgentJobSnapshot(value.snapshot) &&
    (value.result === undefined ||
      (isAgentJobResult(value.result) && value.result.jobId === value.snapshot.jobId))
  );
}

function isAgentEventBase(value: unknown): value is Readonly<{
  data: Readonly<Record<string, unknown>>;
  jobId: string;
  schemaVersion: 1;
  sequence: number;
  status: AgentJobSnapshot["status"];
  timestamp: string;
  type: string;
}> {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "schemaVersion",
      "sequence",
      "jobId",
      "status",
      "timestamp",
      "type",
      "data",
    ]) &&
    value.schemaVersion === 1 &&
    isPositiveInteger(value.sequence) &&
    isJobId(value.jobId) &&
    typeof value.status === "string" &&
    JOB_STATUS_VALUES.has(value.status) &&
    isIsoTimestamp(value.timestamp) &&
    typeof value.type === "string" &&
    isRecord(value.data)
  );
}

export function isAgentJobEvent(value: unknown): value is AgentJobEvent {
  if (!isAgentEventBase(value)) {
    return false;
  }

  const data = value.data;

  switch (value.type) {
    case "snapshot":
      return (
        hasOnlyKeys(data, ["snapshot"]) &&
        isAgentJobSnapshot(data.snapshot) &&
        data.snapshot.jobId === value.jobId &&
        data.snapshot.status === value.status
      );
    case "phase":
      return hasOnlyKeys(data, ["message"]) && isBoundedString(data.message, 1_024);
    case "tool":
      return (
        hasOnlyKeys(data, [
          "toolCallId",
          "toolName",
          "state",
          "relativePath",
          "checkLabel",
        ]) &&
        isBoundedString(data.toolCallId, 256) &&
        isBoundedString(data.toolName, 100) &&
        (data.state === "started" ||
          data.state === "succeeded" ||
          data.state === "failed") &&
        isOptionalBoundedString(data.relativePath, 1_024) &&
        isOptionalBoundedString(data.checkLabel, 100)
      );
    case "check":
      return hasOnlyKeys(data, ["result"]) && isAgentCheckResult(data.result);
    case "result-ready":
      return hasOnlyKeys(data, ["hasResult"]) && data.hasResult === true;
    case "error":
      return (
        hasOnlyKeys(data, ["code", "message"]) &&
        isAgentErrorCode(data.code) &&
        isBoundedString(data.message, 1_024)
      );
    default:
      return false;
  }
}
