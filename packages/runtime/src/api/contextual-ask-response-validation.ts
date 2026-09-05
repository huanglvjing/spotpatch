import {
  ASK_ANSWER_WARNING_CODES,
  ASK_FILE_COUNT_BUCKETS,
  ASK_JOB_STATUSES,
  ASK_READ_ACTIVITY_STATES,
  ASK_SOURCE_CONFIDENCES,
  CONTEXTUAL_ASK_EXECUTOR_KINDS,
  CONTEXTUAL_ASK_EXECUTOR_STATES,
  CONTEXTUAL_ASK_LIMITS,
  CONTEXTUAL_ASK_SCHEMA_VERSION,
  isErrorCode,
  type AskAnswerBlock,
  type AskAnswerResult,
  type AskSourceReference,
  type AskJobEvent,
  type AskJobResultResponse,
  type AskJobSnapshot,
  type ContextualAskCapability,
  type ContextualAskExecutorCapability,
} from "@spotpatch/shared/contextual-ask-browser";

type UnknownRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: UnknownRecord,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => key in value) && keys.every((key) => allowed.has(key));
}

function isEnum<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOpaqueId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9_-]+$/u.test(value)
  );
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isAskDomainError(value: unknown): value is string {
  return isErrorCode(value) && value.startsWith("ASK_");
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => isOpaqueId(item));
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function isExecutorCapability(
  value: unknown,
): value is ContextualAskExecutorCapability {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(
      value,
      [
        "executorId",
        "kind",
        "label",
        "requestedModelLabel",
        "effectiveModelLabel",
        "state",
        "providerDataConsentRequired",
        "readOnlyProven",
      ],
      ["errorCode", "models"],
    ) ||
    !isOpaqueId(value.executorId) ||
    !isEnum(value.kind, CONTEXTUAL_ASK_EXECUTOR_KINDS) ||
    !isNonEmptyString(value.label) ||
    !isNonEmptyString(value.requestedModelLabel) ||
    !isNonEmptyString(value.effectiveModelLabel) ||
    (value.models !== undefined &&
      (!Array.isArray(value.models) ||
        value.models.length === 0 ||
        value.models.length > CONTEXTUAL_ASK_LIMITS.maximumModels ||
        !value.models.every(
          (model: unknown) =>
            isNonEmptyString(model) &&
            model.length <= CONTEXTUAL_ASK_LIMITS.maximumLabelCharacters,
        ) ||
        !unique(value.models))) ||
    !isEnum(value.state, CONTEXTUAL_ASK_EXECUTOR_STATES) ||
    typeof value.providerDataConsentRequired !== "boolean" ||
    typeof value.readOnlyProven !== "boolean" ||
    (value.errorCode !== undefined && !isAskDomainError(value.errorCode))
  ) {
    return false;
  }

  return value.state === "ready"
    ? value.readOnlyProven && value.errorCode === undefined
    : value.errorCode !== undefined;
}

export function isContextualAskCapability(
  value: unknown,
): value is ContextualAskCapability {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "schemaVersion",
      "enabled",
      "executors",
      "safety",
      "checkedAt",
    ]) ||
    value.schemaVersion !== CONTEXTUAL_ASK_SCHEMA_VERSION ||
    typeof value.enabled !== "boolean" ||
    !Array.isArray(value.executors) ||
    !value.executors.every(isExecutorCapability) ||
    !isRecord(value.safety) ||
    !hasOnlyKeys(value.safety, [
      "selectionRequired",
      "singleTurn",
      "writesAllowed",
      "historyStored",
    ]) ||
    value.safety.selectionRequired !== true ||
    value.safety.singleTurn !== true ||
    value.safety.writesAllowed !== false ||
    value.safety.historyStored !== false ||
    !isTimestamp(value.checkedAt)
  ) {
    return false;
  }

  const ids = value.executors.map((executor) => executor.executorId);
  return (value.enabled || value.executors.length === 0) && unique(ids);
}

function isExecutorSnapshot(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["executorId", "kind", "label", "modelLabel"]) &&
    isOpaqueId(value.executorId) &&
    isEnum(value.kind, CONTEXTUAL_ASK_EXECUTOR_KINDS) &&
    isNonEmptyString(value.label) &&
    isNonEmptyString(value.modelLabel)
  );
}

export function isAskJobSnapshot(value: unknown): value is AskJobSnapshot {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(
      value,
      [
        "schemaVersion",
        "jobId",
        "selectionId",
        "status",
        "executor",
        "createdAt",
        "updatedAt",
        "canCancel",
      ],
      ["phaseMessage", "errorCode"],
    ) ||
    value.schemaVersion !== CONTEXTUAL_ASK_SCHEMA_VERSION ||
    !isOpaqueId(value.jobId) ||
    !isOpaqueId(value.selectionId) ||
    !isEnum(value.status, ASK_JOB_STATUSES) ||
    !isExecutorSnapshot(value.executor) ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.updatedAt) ||
    Date.parse(value.updatedAt) < Date.parse(value.createdAt) ||
    typeof value.canCancel !== "boolean" ||
    (value.phaseMessage !== undefined && !isNonEmptyString(value.phaseMessage)) ||
    (value.errorCode !== undefined && !isAskDomainError(value.errorCode))
  ) {
    return false;
  }

  const cancellable = ["queued", "authorizing", "running"].includes(value.status);
  if (value.canCancel !== cancellable) return false;
  if (value.status === "cancelled") return value.errorCode === "ASK_CANCELLED";
  if (value.status === "failed") {
    return value.errorCode !== undefined && value.errorCode !== "ASK_CANCELLED";
  }
  return value.errorCode === undefined;
}

function isSourceReference(value: unknown): value is AskSourceReference {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(
      value,
      [
        "sourceId",
        "label",
        "relativePath",
        "fileId",
        "startLine",
        "endLine",
        "confidence",
        "targetIds",
        "contentHash",
      ],
      ["sourceVersion"],
    ) ||
    !isOpaqueId(value.sourceId) ||
    !isNonEmptyString(value.label) ||
    !isNonEmptyString(value.relativePath) ||
    value.relativePath.startsWith("/") ||
    value.relativePath.includes("\\") ||
    value.relativePath
      .split("/")
      .some((part) => part === "" || part === "." || part === "..") ||
    !isOpaqueId(value.fileId) ||
    !isPositiveInteger(value.startLine) ||
    !isPositiveInteger(value.endLine) ||
    value.endLine < value.startLine ||
    !isEnum(value.confidence, ASK_SOURCE_CONFIDENCES) ||
    !isStringArray(value.targetIds) ||
    value.targetIds.length === 0 ||
    !unique(value.targetIds) ||
    (value.sourceVersion !== undefined && !isNonEmptyString(value.sourceVersion)) ||
    typeof value.contentHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.contentHash)
  ) {
    return false;
  }
  return true;
}

function isAnswerWarning(value: unknown): value is AskAnswerResult["warnings"][number] {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["code"]) &&
    isEnum(value.code, ASK_ANSWER_WARNING_CODES)
  );
}

function isAnswerBlock(value: unknown): value is AskAnswerBlock {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "paragraph") {
    return (
      hasOnlyKeys(value, ["kind", "text", "sourceIds"]) &&
      isNonEmptyString(value.text) &&
      isStringArray(value.sourceIds)
    );
  }
  if (value.kind === "code") {
    return (
      hasOnlyKeys(value, ["kind", "code", "sourceIds"], ["language"]) &&
      typeof value.code === "string" &&
      value.code.length > 0 &&
      isStringArray(value.sourceIds) &&
      (value.language === undefined || isNonEmptyString(value.language))
    );
  }
  if (value.kind !== "list" || !hasOnlyKeys(value, ["kind", "items"])) return false;
  return (
    Array.isArray(value.items) &&
    value.items.length > 0 &&
    value.items.every(
      (item) =>
        isRecord(item) &&
        hasOnlyKeys(item, ["text", "sourceIds"]) &&
        isNonEmptyString(item.text) &&
        isStringArray(item.sourceIds),
    )
  );
}

function isAnswerResult(value: unknown): value is AskAnswerResult {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "schemaVersion",
      "jobId",
      "selectionId",
      "contextHash",
      "executor",
      "blocks",
      "sources",
      "warnings",
      "createdAt",
      "expiresAt",
    ]) ||
    value.schemaVersion !== CONTEXTUAL_ASK_SCHEMA_VERSION ||
    !isOpaqueId(value.jobId) ||
    !isOpaqueId(value.selectionId) ||
    typeof value.contextHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.contextHash) ||
    !isExecutorSnapshot(value.executor) ||
    !Array.isArray(value.blocks) ||
    value.blocks.length === 0 ||
    !value.blocks.every(isAnswerBlock) ||
    !Array.isArray(value.sources) ||
    !value.sources.every(isSourceReference) ||
    !Array.isArray(value.warnings) ||
    !value.warnings.every(isAnswerWarning) ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.expiresAt) ||
    Date.parse(value.expiresAt) <= Date.parse(value.createdAt)
  ) {
    return false;
  }
  const sources = value.sources.filter(isSourceReference);
  const blocks = value.blocks.filter(isAnswerBlock);
  const answerWarnings = value.warnings.filter(isAnswerWarning);
  const sourceIds = sources.map((source) => source.sourceId);
  if (!unique(sourceIds)) return false;
  const available = new Set(sourceIds);
  const references = blocks.flatMap((block) =>
    block.kind === "list"
      ? block.items.flatMap((item) => item.sourceIds)
      : block.sourceIds,
  );
  return (
    references.every((sourceId) => available.has(sourceId)) &&
    sourceIds.every((sourceId) => references.includes(sourceId)) &&
    (references.length > 0 ||
      answerWarnings.some((warning) => warning.code === "insufficient-evidence"))
  );
}

export function isAskJobResultResponse(value: unknown): value is AskJobResultResponse {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["snapshot"], ["result"]) ||
    !isAskJobSnapshot(value.snapshot) ||
    (value.result !== undefined && !isAnswerResult(value.result))
  ) {
    return false;
  }
  const answered = value.snapshot.status === "answered";
  return (
    answered === (value.result !== undefined) &&
    (value.result === undefined ||
      (value.result.jobId === value.snapshot.jobId &&
        value.result.selectionId === value.snapshot.selectionId &&
        value.result.executor.executorId === value.snapshot.executor.executorId))
  );
}

export function isAskJobEvent(value: unknown): value is AskJobEvent {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(
      value,
      ["schemaVersion", "sequence", "jobId", "status", "timestamp", "type"],
      ["snapshot", "message", "activity", "state", "errorCode"],
    ) ||
    value.schemaVersion !== CONTEXTUAL_ASK_SCHEMA_VERSION ||
    !isPositiveInteger(value.sequence) ||
    !isOpaqueId(value.jobId) ||
    !isEnum(value.status, ASK_JOB_STATUSES) ||
    !isTimestamp(value.timestamp)
  ) {
    return false;
  }
  if (value.type === "snapshot") {
    return (
      hasOnlyKeys(value, [
        "schemaVersion",
        "sequence",
        "jobId",
        "status",
        "timestamp",
        "type",
        "snapshot",
      ]) &&
      isAskJobSnapshot(value.snapshot) &&
      value.snapshot.jobId === value.jobId &&
      value.snapshot.status === value.status
    );
  }
  if (value.type === "phase") {
    return (
      hasOnlyKeys(value, [
        "schemaVersion",
        "sequence",
        "jobId",
        "status",
        "timestamp",
        "type",
        "message",
      ]) &&
      isNonEmptyString(value.message) &&
      !["answered", "cancelled", "failed"].includes(value.status)
    );
  }
  if (value.type === "answer-ready")
    return (
      hasOnlyKeys(value, [
        "schemaVersion",
        "sequence",
        "jobId",
        "status",
        "timestamp",
        "type",
      ]) && value.status === "answered"
    );
  if (value.type === "error") {
    return (
      hasOnlyKeys(value, [
        "schemaVersion",
        "sequence",
        "jobId",
        "status",
        "timestamp",
        "type",
        "errorCode",
      ]) &&
      isAskDomainError(value.errorCode) &&
      ((value.status === "cancelled" && value.errorCode === "ASK_CANCELLED") ||
        (value.status === "failed" && value.errorCode !== "ASK_CANCELLED"))
    );
  }
  if (
    value.type !== "read-activity" ||
    !hasOnlyKeys(value, [
      "schemaVersion",
      "sequence",
      "jobId",
      "status",
      "timestamp",
      "type",
      "activity",
      "state",
    ]) ||
    value.status !== "running" ||
    !isRecord(value.activity) ||
    !isEnum(value.state, ASK_READ_ACTIVITY_STATES)
  )
    return false;
  return value.activity.kind === "source"
    ? hasOnlyKeys(value.activity, ["kind", "sourceId", "relativePath"]) &&
        isOpaqueId(value.activity.sourceId) &&
        isNonEmptyString(value.activity.relativePath)
    : value.activity.kind === "file-count" &&
        hasOnlyKeys(value.activity, ["kind", "bucket"]) &&
        isEnum(value.activity.bucket, ASK_FILE_COUNT_BUCKETS);
}
