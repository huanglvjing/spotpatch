import { z } from "zod";

import { DEFAULT_AGENT_LIMITS } from "../model/agent.js";

export const EXTERNAL_AGENT_CONTROL_SCHEMA_VERSION = 1 as const;
export const EXTERNAL_AGENT_MANAGED_ADAPTER_KINDS = Object.freeze(["codex"] as const);
export const EXTERNAL_AGENT_MODES = Object.freeze(["inbox", "managed"] as const);
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
] as const);
export const EXTERNAL_AGENT_AUTH_READINESS = Object.freeze([
  "authenticated",
  "auth-not-required",
  "signed-out",
  "unknown",
] as const);
export const EXTERNAL_AGENT_GRANT_STATES = Object.freeze([
  "missing",
  "valid",
  "invalid",
] as const);
export const EXTERNAL_AGENT_DELIVERY_STATUSES = Object.freeze([
  "queued",
  "dispatching",
  "accepted",
  "unknown",
] as const);
export const EXTERNAL_AGENT_EXECUTION_STATUSES = Object.freeze([
  "not-observable",
  "started",
  "terminal-succeeded",
  "terminal-failed",
  "interrupted",
  "unknown",
] as const);
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
] as const);
export const EXTERNAL_AGENT_VALIDATION_OUTCOMES = Object.freeze([
  "passed",
  "failed",
  "not-configured",
  "unavailable",
] as const);
export const EXTERNAL_AGENT_CHECK_OUTCOMES = Object.freeze([
  "passed",
  "failed",
  "unavailable",
] as const);
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
] as const);
export const EXTERNAL_AGENT_ERROR_RECOVERABILITY = Object.freeze([
  "retry",
  "user-action",
  "reconfigure",
  "none",
] as const);
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
] as const);
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
] as const);
export const EXTERNAL_AGENT_MANAGED_PROFILE = "managed-apply-v1" as const;
export const EXTERNAL_AGENT_CONTROL_LIMITS = Object.freeze({
  maximumEventSubscribers: 4,
  eventHeartbeatMs: 15_000,
  eventReconnectMinimumMs: 500,
  eventReconnectMaximumMs: 10_000,
  maximumChangedFiles: DEFAULT_AGENT_LIMITS.maxChangedFiles,
  maximumChecks: 64,
  maximumEventLineBytes: 64 * 1_024,
  maximumResultDiffBytes: DEFAULT_AGENT_LIMITS.maxDiffBytes,
} as const);

const isoTimestampSchema = z.iso.datetime();
const requestIdSchema = z
  .string()
  .min(22)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/u);
const safeRelativePathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .superRefine((value, context) => {
    const segments = value.split("/");
    if (
      value.startsWith("/") ||
      value.includes("\\") ||
      segments.some(
        (segment) => segment.length === 0 || segment === "." || segment === "..",
      )
    ) {
      context.addIssue({ code: "custom", message: "Expected a safe relative path." });
    }
  });

export const externalAgentErrorSchema = z.strictObject({
  code: z.enum(EXTERNAL_AGENT_ERROR_CODES),
  stage: z.enum(EXTERNAL_AGENT_ERROR_STAGES),
  recoverability: z.enum(EXTERNAL_AGENT_ERROR_RECOVERABILITY),
  action: z.enum(EXTERNAL_AGENT_ACTIONS),
});
export const managedFileSummarySchema = z.strictObject({
  path: safeRelativePathSchema,
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});
export const managedCheckSummarySchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9._-]+$/u),
  outcome: z.enum(EXTERNAL_AGENT_CHECK_OUTCOMES),
  durationMs: z.number().int().nonnegative(),
  exitCode: z.number().int().optional(),
});
export const managedTimingSummarySchema = z.strictObject({
  preparing: z.number().int().nonnegative().optional(),
  agent: z.number().int().nonnegative().optional(),
  auditing: z.number().int().nonnegative().optional(),
  validating: z.number().int().nonnegative().optional(),
  applying: z.number().int().nonnegative().optional(),
  total: z.number().int().nonnegative().optional(),
});
export const managedTaskStatusSchema = z.strictObject({
  revision: z.number().int().positive(),
  deliveryStatus: z.enum(EXTERNAL_AGENT_DELIVERY_STATUSES),
  executionStatus: z.enum(EXTERNAL_AGENT_EXECUTION_STATUSES),
  managedPhase: z.enum(EXTERNAL_AGENT_MANAGED_PHASES),
  validationOutcome: z.enum(EXTERNAL_AGENT_VALIDATION_OUTCOMES).optional(),
  files: z
    .array(managedFileSummarySchema)
    .max(EXTERNAL_AGENT_CONTROL_LIMITS.maximumChangedFiles),
  checks: z
    .array(managedCheckSummarySchema)
    .max(EXTERNAL_AGENT_CONTROL_LIMITS.maximumChecks),
  timings: managedTimingSummarySchema,
  resultExpiresAt: isoTimestampSchema.optional(),
});
export const externalAgentControlStatusSchema = z.strictObject({
  schemaVersion: z.literal(EXTERNAL_AGENT_CONTROL_SCHEMA_VERSION),
  sequence: z.number().int().nonnegative(),
  mode: z.enum(EXTERNAL_AGENT_MODES),
  adapter: z.strictObject({
    kind: z.enum(EXTERNAL_AGENT_MANAGED_ADAPTER_KINDS),
    maturity: z.literal("experimental"),
    availability: z.enum(["available", "unavailable"]),
  }),
  connectionState: z.enum(EXTERNAL_AGENT_CONNECTION_STATES),
  authReadiness: z.enum(EXTERNAL_AGENT_AUTH_READINESS),
  grantState: z.enum(EXTERNAL_AGENT_GRANT_STATES),
  requestedModel: z.string().min(1).max(128).optional(),
  effectiveModel: z.string().min(1).max(128).optional(),
  task: managedTaskStatusSchema.optional(),
  error: externalAgentErrorSchema.optional(),
  updatedAt: isoTimestampSchema,
});

export const externalAgentControlStatusRequestSchema = z.strictObject({});
export const externalAgentControlConnectRequestSchema = z.strictObject({
  requestId: requestIdSchema,
  adapterKind: z.literal("codex"),
  profile: z.literal(EXTERNAL_AGENT_MANAGED_PROFILE),
});
export const externalAgentControlDisconnectRequestSchema = z.strictObject({
  requestId: requestIdSchema,
  adapterKind: z.literal("codex"),
  revokeGrant: z.boolean(),
});
export const externalAgentControlCancelRequestSchema = z.strictObject({
  requestId: requestIdSchema,
  revision: z.number().int().positive(),
});
export const externalAgentEventsRequestSchema = z.strictObject({
  afterSequence: z.number().int().nonnegative().optional(),
});
export const externalAgentEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("status"),
    data: externalAgentControlStatusSchema,
  }),
  z.strictObject({
    type: z.literal("heartbeat"),
    sequence: z.number().int().nonnegative(),
    emittedAt: isoTimestampSchema,
  }),
]);
export const externalAgentResultRequestSchema = z.strictObject({
  revision: z.number().int().positive(),
});
export const externalAgentManagedResultSchema = z.strictObject({
  revision: z.number().int().positive(),
  diff: z.string().max(EXTERNAL_AGENT_CONTROL_LIMITS.maximumResultDiffBytes),
  files: z
    .array(managedFileSummarySchema)
    .max(EXTERNAL_AGENT_CONTROL_LIMITS.maximumChangedFiles),
  checks: z
    .array(managedCheckSummarySchema)
    .max(EXTERNAL_AGENT_CONTROL_LIMITS.maximumChecks),
  timings: managedTimingSummarySchema,
  validationOutcome: z.enum(EXTERNAL_AGENT_VALIDATION_OUTCOMES),
  expiresAt: isoTimestampSchema,
});

export type ExternalAgentErrorCode = (typeof EXTERNAL_AGENT_ERROR_CODES)[number];
export type ExternalAgentAction = (typeof EXTERNAL_AGENT_ACTIONS)[number];
export type ExternalAgentConnectionState =
  (typeof EXTERNAL_AGENT_CONNECTION_STATES)[number];
export type ExternalAgentControlStatus = Readonly<
  z.infer<typeof externalAgentControlStatusSchema>
>;
export type ExternalAgentControlConnectRequest = Readonly<
  z.infer<typeof externalAgentControlConnectRequestSchema>
>;
export type ExternalAgentControlDisconnectRequest = Readonly<
  z.infer<typeof externalAgentControlDisconnectRequestSchema>
>;
export type ExternalAgentControlCancelRequest = Readonly<
  z.infer<typeof externalAgentControlCancelRequestSchema>
>;
export type ExternalAgentEventsRequest = Readonly<
  z.infer<typeof externalAgentEventsRequestSchema>
>;
export type ExternalAgentEvent = Readonly<z.infer<typeof externalAgentEventSchema>>;
export type ExternalAgentResultRequest = Readonly<
  z.infer<typeof externalAgentResultRequestSchema>
>;
export type ExternalAgentManagedResult = Readonly<
  z.infer<typeof externalAgentManagedResultSchema>
>;
