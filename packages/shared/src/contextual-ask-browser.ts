import type { ERROR_CODES as GLOBAL_ERROR_CODES } from "./errors/error-code.js";
import type { ContextualAskErrorCode } from "./errors/error-code.js";

const CONTEXTUAL_ASK_ERRORS = {
  ASK_DISABLED: "ASK_DISABLED",
  ASK_SELECTION_REQUIRED: "ASK_SELECTION_REQUIRED",
  ASK_SELECTION_STALE: "ASK_SELECTION_STALE",
  ASK_QUESTION_INVALID: "ASK_QUESTION_INVALID",
  ASK_EXECUTOR_UNAVAILABLE: "ASK_EXECUTOR_UNAVAILABLE",
  ASK_TIMEOUT: "ASK_TIMEOUT",
  ASK_CONSENT_REQUIRED: "ASK_CONSENT_REQUIRED",
  ASK_BUSY: "ASK_BUSY",
  ASK_IDEMPOTENCY_CONFLICT: "ASK_IDEMPOTENCY_CONFLICT",
  ASK_SOURCE_SCOPE_DENIED: "ASK_SOURCE_SCOPE_DENIED",
  ASK_LIMIT_EXCEEDED: "ASK_LIMIT_EXCEEDED",
  ASK_ANSWER_INVALID: "ASK_ANSWER_INVALID",
  ASK_WRITE_ATTEMPTED: "ASK_WRITE_ATTEMPTED",
  ASK_CANCELLED: "ASK_CANCELLED",
  ASK_RESULT_EXPIRED: "ASK_RESULT_EXPIRED",
  ASK_PROTOCOL_INCOMPATIBLE: "ASK_PROTOCOL_INCOMPATIBLE",
} as const satisfies Record<ContextualAskErrorCode, ContextualAskErrorCode>;

/** Browser-reachable Ask errors only; no provider details or Node failures. */
export const ERROR_CODES = Object.freeze({
  INVALID_REQUEST: "INVALID_REQUEST",
  INVALID_TOKEN: "INVALID_TOKEN",
  ORIGIN_NOT_ALLOWED: "ORIGIN_NOT_ALLOWED",
  ...CONTEXTUAL_ASK_ERRORS,
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const satisfies Pick<
  typeof GLOBAL_ERROR_CODES,
  "INTERNAL_ERROR" | "INVALID_REQUEST" | "INVALID_TOKEN" | "ORIGIN_NOT_ALLOWED"
>);
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
const ERROR_CODE_VALUES: readonly string[] = Object.values(ERROR_CODES);

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && ERROR_CODE_VALUES.includes(value);
}

export {
  ASK_ANSWER_WARNING_CODES,
  ASK_EXECUTOR_ANSWER_WARNING_CODES,
  ASK_FILE_COUNT_BUCKETS,
  ASK_JOB_STATUSES,
  ASK_READ_ACTIVITY_STATES,
  ASK_SOURCE_CONFIDENCES,
  CONTEXTUAL_ASK_EXECUTOR_KINDS,
  CONTEXTUAL_ASK_EXECUTOR_STATES,
  CONTEXTUAL_ASK_LIMITS,
  CONTEXTUAL_ASK_SCHEMA_VERSION,
  type AskAnswerWarningCode,
  type AskExecutorAnswerWarningCode,
  type AskFileCountBucket,
  type AskJobStatus,
  type AskReadActivityState,
  type AskSourceConfidence,
  type ContextualAskExecutorKind,
  type ContextualAskExecutorState,
} from "./protocol/contextual-ask-constants.js";
export {
  getAskJobEndpoint,
  SPOTPATCH_ENDPOINTS,
  SPOTPATCH_TOKEN_HEADER,
  type AskJobAction,
} from "./protocol/endpoints.js";
export type {
  AskAnswerBlock,
  AskAnswerResult,
  AskAnswerWarning,
  AskDraftOrigin,
  AskSourceReference,
  ContextualAskCapability,
  ContextualAskExecutorCapability,
  SpotAskTaskEnvelope,
  SpotChangeTaskEnvelope,
  SpotSelectionContext,
  SpotSelectionTarget,
  SpotTaskEnvelope,
} from "./model/contextual-ask.js";
export type {
  AskJobActionRequest,
  AskJobCreateRequest,
  AskJobEvent,
  AskJobEventsRequest,
  AskJobResultResponse,
  AskJobSnapshot,
  ContextualAskCapabilityRequest,
} from "./protocol/contextual-ask.js";
