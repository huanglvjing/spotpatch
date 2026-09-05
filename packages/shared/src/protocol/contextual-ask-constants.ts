export const CONTEXTUAL_ASK_SCHEMA_VERSION = 1 as const;

export const CONTEXTUAL_ASK_LIMITS = Object.freeze({
  maximumTargets: 20,
  maximumQuestionCharacters: 4_000,
  maximumAnswerCharacters: 40_000,
  maximumAnswerBlocks: 40,
  maximumSources: 64,
  maximumReadFiles: 32,
  maximumReadBytesPerFile: 64 * 1_024,
  maximumReadBytesTotal: 512 * 1_024,
  maximumToolCalls: 48,
  maximumModelTurns: 12,
  jobTimeoutMs: 300_000,
  resultTtlMs: 900_000,
  maximumActiveJobsPerSession: 1,
  maximumRetainedResultsPerSession: 1,
  maximumRetainedEvents: 256,
  maximumEventSubscribers: 4,
  eventHeartbeatMs: 15_000,
  maximumRequestBodyBytes: 256 * 1_024,
  maximumSearchQueryCharacters: 256,
  maximumSearchResults: 64,
  maximumSearchPreviewCharacters: 500,
  capabilityTimeoutMs: 30_000,
  maximumIdCharacters: 128,
  maximumProfileIdCharacters: 64,
  maximumLabelCharacters: 256,
  maximumRelativePathCharacters: 1_024,
  maximumLanguageCharacters: 64,
  maximumPhaseMessageCharacters: 1_024,
  maximumExecutors: 32,
  maximumModels: 800,
  contentHashHexCharacters: 64,
} as const);

export const CONTEXTUAL_ASK_EXECUTOR_KINDS = Object.freeze([
  "configured-key",
  "managed-codex",
] as const);
export type ContextualAskExecutorKind = (typeof CONTEXTUAL_ASK_EXECUTOR_KINDS)[number];

export const CONTEXTUAL_ASK_EXECUTOR_STATES = Object.freeze([
  "ready",
  "degraded",
  "unavailable",
] as const);
export type ContextualAskExecutorState =
  (typeof CONTEXTUAL_ASK_EXECUTOR_STATES)[number];

export const ASK_JOB_STATUSES = Object.freeze([
  "queued",
  "authorizing",
  "running",
  "cancelling",
  "answered",
  "cancelled",
  "failed",
] as const);
export type AskJobStatus = (typeof ASK_JOB_STATUSES)[number];

export const ASK_ANSWER_WARNING_CODES = Object.freeze([
  "insufficient-evidence",
  "partial-context",
  "source-truncated",
  "source-stale",
] as const);
export type AskAnswerWarningCode = (typeof ASK_ANSWER_WARNING_CODES)[number];

/** Warnings an executor may declare from its own evidence assessment. */
export const ASK_EXECUTOR_ANSWER_WARNING_CODES = Object.freeze([
  "insufficient-evidence",
  "partial-context",
] as const satisfies readonly AskAnswerWarningCode[]);
export type AskExecutorAnswerWarningCode =
  (typeof ASK_EXECUTOR_ANSWER_WARNING_CODES)[number];

export const ASK_READ_ACTIVITY_STATES = Object.freeze([
  "started",
  "succeeded",
  "failed",
] as const);
export type AskReadActivityState = (typeof ASK_READ_ACTIVITY_STATES)[number];

export const ASK_FILE_COUNT_BUCKETS = Object.freeze(["one", "few", "many"] as const);
export type AskFileCountBucket = (typeof ASK_FILE_COUNT_BUCKETS)[number];

export const ASK_SOURCE_CONFIDENCES = Object.freeze([
  "exact",
  "probable",
  "approximate",
] as const);
export type AskSourceConfidence = (typeof ASK_SOURCE_CONFIDENCES)[number];

export const CONTEXTUAL_ASK_PERMISSION_PROFILE = "spotpatch-ask-readonly" as const;
