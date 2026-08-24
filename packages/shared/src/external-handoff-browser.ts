import type { ERROR_CODES as GLOBAL_ERROR_CODES } from "./errors/error-code.js";
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
