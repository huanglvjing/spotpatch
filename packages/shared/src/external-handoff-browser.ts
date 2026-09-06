import type { ERROR_CODES as GLOBAL_ERROR_CODES } from "./errors/error-code.js";
import type {
  EXTERNAL_AGENT_ACTIONS as GLOBAL_EXTERNAL_AGENT_ACTIONS,
  EXTERNAL_AGENT_AUTH_READINESS as GLOBAL_EXTERNAL_AGENT_AUTH_READINESS,
  EXTERNAL_AGENT_CHECK_OUTCOMES as GLOBAL_EXTERNAL_AGENT_CHECK_OUTCOMES,
  EXTERNAL_AGENT_CONNECTION_STATES as GLOBAL_EXTERNAL_AGENT_CONNECTION_STATES,
  EXTERNAL_AGENT_CONTROL_LIMITS as GLOBAL_EXTERNAL_AGENT_CONTROL_LIMITS,
  EXTERNAL_AGENT_DELIVERY_STATUSES as GLOBAL_EXTERNAL_AGENT_DELIVERY_STATUSES,
  EXTERNAL_AGENT_ERROR_CODES as GLOBAL_EXTERNAL_AGENT_ERROR_CODES,
  EXTERNAL_AGENT_ERROR_RECOVERABILITY as GLOBAL_EXTERNAL_AGENT_ERROR_RECOVERABILITY,
  EXTERNAL_AGENT_ERROR_STAGES as GLOBAL_EXTERNAL_AGENT_ERROR_STAGES,
  EXTERNAL_AGENT_EXECUTION_STATUSES as GLOBAL_EXTERNAL_AGENT_EXECUTION_STATUSES,
  EXTERNAL_AGENT_GRANT_STATES as GLOBAL_EXTERNAL_AGENT_GRANT_STATES,
  EXTERNAL_AGENT_MANAGED_PROFILE as GLOBAL_EXTERNAL_AGENT_MANAGED_PROFILE,
  EXTERNAL_AGENT_MANAGED_PHASES as GLOBAL_EXTERNAL_AGENT_MANAGED_PHASES,
  EXTERNAL_AGENT_MODES as GLOBAL_EXTERNAL_AGENT_MODES,
  EXTERNAL_AGENT_VALIDATION_OUTCOMES as GLOBAL_EXTERNAL_AGENT_VALIDATION_OUTCOMES,
} from "./protocol/external-agent-control.js";
import type { EXTERNAL_HANDOFF_LIMITS as GLOBAL_EXTERNAL_HANDOFF_LIMITS } from "./protocol/external-handoff-constants.js";

/** Browser-reachable errors only; keeps unrelated Agent/worktree codes out of the lazy UI. */
export const ERROR_CODES = Object.freeze({
  INVALID_REQUEST: "INVALID_REQUEST",
  INVALID_TOKEN: "INVALID_TOKEN",
  ORIGIN_NOT_ALLOWED: "ORIGIN_NOT_ALLOWED",
  EXTERNAL_HANDOFF_DISABLED: "EXTERNAL_HANDOFF_DISABLED",
  EXTERNAL_HANDOFF_UNAVAILABLE: "EXTERNAL_HANDOFF_UNAVAILABLE",
  HANDOFF_VALIDATION_FAILED: "HANDOFF_VALIDATION_FAILED",
  HANDOFF_SOURCE_STALE: "HANDOFF_SOURCE_STALE",
  HANDOFF_NOT_FOUND: "HANDOFF_NOT_FOUND",
  HANDOFF_EXPIRED: "HANDOFF_EXPIRED",
  HANDOFF_CURSOR_INVALID: "HANDOFF_CURSOR_INVALID",
  HANDOFF_RESPONSE_TOO_LARGE: "HANDOFF_RESPONSE_TOO_LARGE",
  EXTERNAL_AGENT_BUSY: "EXTERNAL_AGENT_BUSY",
  ACTIVE_DISPATCH_INVALID: "ACTIVE_DISPATCH_INVALID",
  SESSION_CLOSED: "SESSION_CLOSED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const satisfies Pick<
  typeof GLOBAL_ERROR_CODES,
  | "ACTIVE_DISPATCH_INVALID"
  | "EXTERNAL_AGENT_BUSY"
  | "EXTERNAL_HANDOFF_DISABLED"
  | "EXTERNAL_HANDOFF_UNAVAILABLE"
  | "HANDOFF_CURSOR_INVALID"
  | "HANDOFF_EXPIRED"
  | "HANDOFF_NOT_FOUND"
  | "HANDOFF_RESPONSE_TOO_LARGE"
  | "HANDOFF_SOURCE_STALE"
  | "HANDOFF_VALIDATION_FAILED"
  | "INTERNAL_ERROR"
  | "INVALID_REQUEST"
  | "INVALID_TOKEN"
  | "ORIGIN_NOT_ALLOWED"
  | "SESSION_CLOSED"
>);
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
const ERROR_CODE_VALUES: readonly string[] = Object.values(ERROR_CODES);

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && ERROR_CODE_VALUES.includes(value);
}

/** Browser-consumed limits only; literal types make drift from the canonical limits fail. */
export const EXTERNAL_HANDOFF_LIMITS = Object.freeze({
  maximumConnectorReceipts: 64,
  maximumWaiters: 8,
  activeStatusPollMs: 1_000,
} as const satisfies Pick<
  typeof GLOBAL_EXTERNAL_HANDOFF_LIMITS,
  "activeStatusPollMs" | "maximumConnectorReceipts" | "maximumWaiters"
>);

export const EXTERNAL_AGENT_CONTROL_LIMITS = Object.freeze({
  maximumModels: 128,
  maximumModelCharacters: 128,
  maximumEventSubscribers: 4,
  eventHeartbeatMs: 15_000,
  eventReconnectMinimumMs: 500,
  eventReconnectMaximumMs: 10_000,
  maximumChangedFiles: 20,
  maximumChecks: 64,
  maximumEventLineBytes: 64 * 1_024,
  maximumResultDiffBytes: 512_000,
} as const satisfies typeof GLOBAL_EXTERNAL_AGENT_CONTROL_LIMITS);
export const EXTERNAL_AGENT_MANAGED_PROFILE =
  "managed-apply-v1" as const satisfies typeof GLOBAL_EXTERNAL_AGENT_MANAGED_PROFILE;

/** Browser-safe literal projections; type-only checks prevent protocol drift without Zod. */
export const EXTERNAL_AGENT_MODES = Object.freeze([
  "inbox",
  "managed",
] as const satisfies typeof GLOBAL_EXTERNAL_AGENT_MODES);
export const EXTERNAL_AGENT_CONNECTION_STATES = Object.freeze([
  "disconnected",
  "diagnosing",
  "awaiting-consent",
  "connecting",
  "ready",
  "busy",
  "degraded",
  "error",
  "disconnecting",
] as const satisfies typeof GLOBAL_EXTERNAL_AGENT_CONNECTION_STATES);
export const EXTERNAL_AGENT_AUTH_READINESS = Object.freeze([
  "authenticated",
  "auth-not-required",
  "signed-out",
  "unknown",
] as const satisfies typeof GLOBAL_EXTERNAL_AGENT_AUTH_READINESS);
export const EXTERNAL_AGENT_GRANT_STATES = Object.freeze([
  "missing",
  "valid",
  "invalid",
] as const satisfies typeof GLOBAL_EXTERNAL_AGENT_GRANT_STATES);
export const EXTERNAL_AGENT_DELIVERY_STATUSES = Object.freeze([
  "queued",
  "dispatching",
  "accepted",
  "unknown",
] as const satisfies typeof GLOBAL_EXTERNAL_AGENT_DELIVERY_STATUSES);
export const EXTERNAL_AGENT_EXECUTION_STATUSES = Object.freeze([
  "not-observable",
  "started",
  "terminal-succeeded",
  "terminal-failed",
  "interrupted",
  "unknown",
] as const satisfies typeof GLOBAL_EXTERNAL_AGENT_EXECUTION_STATUSES);
export const EXTERNAL_AGENT_MANAGED_PHASES = Object.freeze([
  "preparing",
  "running",
  "auditing",
  "validating",
  "applying",
  "completed",
  "review-required",
  "failed",
  "cancelled",
  "cleanup-warning",
] as const satisfies typeof GLOBAL_EXTERNAL_AGENT_MANAGED_PHASES);
export const EXTERNAL_AGENT_VALIDATION_OUTCOMES = Object.freeze([
  "passed",
  "failed",
  "not-configured",
  "unavailable",
] as const satisfies typeof GLOBAL_EXTERNAL_AGENT_VALIDATION_OUTCOMES);
export const EXTERNAL_AGENT_CHECK_OUTCOMES = Object.freeze([
  "passed",
  "failed",
  "unavailable",
] as const satisfies typeof GLOBAL_EXTERNAL_AGENT_CHECK_OUTCOMES);
export const EXTERNAL_AGENT_ERROR_CODES = Object.freeze([
  "AGENT_BINARY_NOT_FOUND",
  "AGENT_BINARY_UNTRUSTED",
  "AGENT_VERSION_UNSUPPORTED",
  "APP_SERVER_HANDSHAKE_FAILED",
  "AGENT_AUTH_REQUIRED",
  "AGENT_MODEL_UNAVAILABLE",
  "AGENT_PROTOCOL_INCOMPATIBLE",
  "CODEX_CONFIG_ISOLATION_UNSUPPORTED",
  "MANAGED_GRANT_INVALID",
  "MANAGED_PLATFORM_UNSUPPORTED",
  "MANAGED_GIT_REQUIRED",
  "MANAGED_SNAPSHOT_FAILED",
  "MANAGED_SCOPE_VIOLATION",
  "MANAGED_CHANGE_LIMIT_EXCEEDED",
  "MANAGED_VALIDATION_FAILED",
  "MANAGED_WORKSPACE_CONFLICT",
  "MANAGED_APPLY_FAILED",
  "MANAGED_CLEANUP_INCOMPLETE",
] as const satisfies typeof GLOBAL_EXTERNAL_AGENT_ERROR_CODES);
export const EXTERNAL_AGENT_ERROR_STAGES = Object.freeze([
  "integration",
  "binary",
  "handshake",
  "auth",
  "model",
  "protocol",
  "snapshot",
  "audit",
  "validation",
  "apply",
  "cleanup",
] as const satisfies typeof GLOBAL_EXTERNAL_AGENT_ERROR_STAGES);
export const EXTERNAL_AGENT_ERROR_RECOVERABILITY = Object.freeze([
  "retry",
  "user-action",
  "reconfigure",
  "none",
] as const satisfies typeof GLOBAL_EXTERNAL_AGENT_ERROR_RECOVERABILITY);
export const EXTERNAL_AGENT_ACTIONS = Object.freeze([
  "install-agent",
  "use-supported-version",
  "sign-in",
  "choose-available-model",
  "use-inbox",
  "confirm-managed-access",
  "review-candidate-diff",
  "review-workspace-conflict",
  "retry",
  "inspect-cleanup-warning",
] as const satisfies typeof GLOBAL_EXTERNAL_AGENT_ACTIONS);

export {
  EXTERNAL_HANDOFF_ACTIVE_ADAPTER_KINDS,
  EXTERNAL_HANDOFF_ACTIVE_ADAPTER_STATES,
  EXTERNAL_HANDOFF_BROKER_PROTOCOL_VERSION,
  EXTERNAL_HANDOFF_DISPATCH_PHASES,
  EXTERNAL_HANDOFF_FRAMEWORKS,
  EXTERNAL_HANDOFF_REPORTABLE_DISPATCH_PHASES,
  EXTERNAL_HANDOFF_SNAPSHOT_SCHEMA_VERSION,
  EXTERNAL_HANDOFF_STATES,
  type ExternalHandoffActiveAdapterKind,
  type ExternalHandoffActiveAdapterState,
  type ExternalHandoffDispatchPhase,
  type ExternalHandoffFramework,
  type ExternalHandoffReportableDispatchPhase,
  type ExternalHandoffState,
} from "./protocol/external-handoff-constants.js";
export { SPOTPATCH_ENDPOINTS, SPOTPATCH_TOKEN_HEADER } from "./protocol/endpoints.js";
export type {
  ExternalAgentAction,
  ExternalAgentConnectionState,
  ExternalAgentControlCancelRequest,
  ExternalAgentControlConnectRequest,
  ExternalAgentControlDisconnectRequest,
  ExternalAgentControlStatus,
  ExternalAgentErrorCode,
  ExternalAgentEvent,
  ExternalAgentEventsRequest,
  ExternalAgentManagedResult,
  ExternalAgentResultRequest,
} from "./protocol/external-agent-control.js";
export type {
  ActiveAdapterSummary,
  DispatchSummary,
  ExternalHandoffCapability,
  ExternalHandoffPublishDelivery,
  ExternalHandoffPublishRequest,
  ExternalHandoffPublishResult,
  ExternalHandoffResolveDeliveryRequest,
  ExternalHandoffSnapshot,
  ExternalHandoffStatusRequest,
  ExternalHandoffStatusResult,
  ExternalHandoffSummary,
} from "./protocol/external-handoff.js";
export type { SpotAnnotation, SpotPatchLocale } from "./model/annotation.js";
