import { z } from "zod";

import {
  DEFAULT_DATA_FLOW_LIMITS,
  type RuntimeDataFlowLimits,
} from "./data-flow-limits.js";
import { DATA_FLOW_SCHEMA_VERSION } from "./data-flow-version.js";

export {
  DATA_FLOW_URL_QUERY_KEY_LIMIT,
  DEFAULT_DATA_FLOW_LIMITS,
  DEFAULT_RUNTIME_DATA_FLOW_LIMITS,
  type DataFlowLimits,
  type RuntimeDataFlowLimits,
} from "./data-flow-limits.js";
export { DATA_FLOW_SCHEMA_VERSION } from "./data-flow-version.js";

export const DATA_FLOW_EXECUTION_STATES = Object.freeze([
  "observed",
  "declared-not-observed",
  "not-applicable",
  "unknown",
] as const);
export const DATA_FLOW_PROOF_STATES = Object.freeze([
  "proven",
  "candidate",
  "unavailable",
  "conflict",
] as const);
export const DATA_FLOW_ASSOCIATION_KINDS = Object.freeze([
  "direct",
  "transitive",
  "upstream",
  "possible",
  "unassigned",
  "unknown",
] as const);
export const DATA_FLOW_FRESHNESS_STATES = Object.freeze([
  "current",
  "stale-source",
  "stale-route",
  "expired",
] as const);
export const DATA_FLOW_DIAGNOSTIC_CODES = Object.freeze([
  "DATA_FLOW_CAPABILITY_DISABLED",
  "DATA_FLOW_CAPABILITY_PRELUDE_UNAVAILABLE",
  "DATA_FLOW_CAPABILITY_UNSUPPORTED_FRAMEWORK",
  "DATA_FLOW_SOURCE_UNAVAILABLE",
  "DATA_FLOW_SOURCE_STALE",
  "DATA_FLOW_ANALYSIS_TIMEOUT",
  "DATA_FLOW_ANALYSIS_TRUNCATED",
  "DATA_FLOW_ANALYSIS_UNRESOLVED_CALL",
  "DATA_FLOW_OBSERVATION_UNASSIGNED",
  "DATA_FLOW_OBSERVATION_DROPPED",
  "DATA_FLOW_REDACTION_APPLIED",
  "DATA_FLOW_AI_DISABLED",
] as const);

export type ExecutionState = (typeof DATA_FLOW_EXECUTION_STATES)[number];
export type ProofState = (typeof DATA_FLOW_PROOF_STATES)[number];
export type AssociationKind = (typeof DATA_FLOW_ASSOCIATION_KINDS)[number];
export type FreshnessState = (typeof DATA_FLOW_FRESHNESS_STATES)[number];
export type DataFlowDiagnosticCode = (typeof DATA_FLOW_DIAGNOSTIC_CODES)[number];

export interface RuntimeDataFlowConfig {
  readonly enabled: boolean;
  readonly runtime: "dispatch";
  readonly limits: RuntimeDataFlowLimits;
}

export interface DataFlowCapabilityReason {
  readonly code: DataFlowDiagnosticCode;
  readonly retryable: boolean;
}

export interface DataFlowCapability {
  readonly enabled: boolean;
  readonly staticAnalysis: "available" | "partial" | "unavailable";
  readonly runtimeObservation: "dispatch-only";
  readonly responseShape: "consumed-fields-only";
  readonly aiAssistance: "disabled";
  readonly reasons: readonly DataFlowCapabilityReason[];
}

export interface EvidenceSourceRef {
  readonly fileId: string;
  readonly displayPath: string;
  readonly line: number;
  readonly column: number;
  readonly sourceVersion: string;
}

export interface EvidenceRef {
  readonly id: string;
  readonly kind:
    | "source-anchor"
    | "import-resolution"
    | "symbol-edge"
    | "trigger-edge"
    | "call-edge"
    | "data-binding"
    | "adapter-rule"
    | "runtime-observation"
    | "runtime-reference"
    | "diagnostic";
  readonly source?: EvidenceSourceRef;
  readonly adapter?: Readonly<{ id: string; version: string }>;
  readonly summaryKey: string;
}

export interface DataFlowDiagnostic {
  readonly id: string;
  readonly code: DataFlowDiagnosticCode;
  readonly severity: "info" | "warning" | "error";
  readonly retryable: boolean;
  readonly evidenceIds: readonly string[];
}

export interface SanitizedObservedUrl {
  readonly origin?: string;
  readonly pathname: string;
  readonly queryKeys: readonly string[];
}

export interface DataParameter {
  readonly path: string;
  readonly position:
    "path" | "query" | "body" | "header" | "cookie" | "variable" | "form" | "unknown";
  readonly type?: string;
  readonly source?: string;
  readonly condition?: string;
  readonly sensitive: boolean;
  readonly valueState: "not-collected";
  readonly evidenceIds: readonly string[];
}

export interface DataResponseDescriptor {
  readonly consumedFields: readonly string[];
}

export interface RequestOrigin {
  readonly componentSourceId?: string;
  readonly triggerCallsiteId?: string;
  readonly requestCallsiteId: string;
  readonly sourceVersion: string;
}

export interface DataDependency {
  readonly id: string;
  readonly kind: "http" | "graphql" | "rpc" | "server-action" | "unknown";
  readonly direction: "read" | "write" | "read-write" | "unknown";
  readonly execution: ExecutionState;
  readonly environment?: "server" | "client";
  readonly proof: ProofState;
  readonly association: AssociationKind;
  readonly method?: string;
  readonly operation?: string;
  readonly url?: SanitizedObservedUrl;
  readonly parameters: readonly DataParameter[];
  readonly response: DataResponseDescriptor;
  readonly origin?: RequestOrigin;
  readonly suppliedBindings: readonly string[];
  readonly locationIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly observationIds: readonly string[];
}

export interface NetworkObservation {
  readonly schemaVersion: typeof DATA_FLOW_SCHEMA_VERSION;
  readonly id: string;
  readonly pageEpoch: string;
  readonly routeEpoch: string;
  readonly requestCallsiteId?: string;
  readonly invocationId?: string;
  readonly componentSourceId?: string;
  readonly triggerCallsiteId?: string;
  readonly sourceVersion?: string;
  readonly transport: "fetch" | "trpc" | "xhr";
  readonly method: string;
  readonly operation?: string;
  readonly url: SanitizedObservedUrl;
  readonly outcome: "dispatched";
  readonly freshness: FreshnessState;
  readonly diagnosticIds: readonly string[];
}

export interface AnalysisBaseline {
  readonly registryEpoch: string;
  readonly analyzerVersion: string;
  readonly adapterSetHash: string;
  readonly analyzedSourceVersions: readonly string[];
}

export interface ReportCompleteness {
  readonly complete: boolean;
  readonly visitedModules: number;
  readonly visitedCallsites: number;
  readonly frontierCount: number;
  readonly truncatedBy?: "depth" | "modules" | "callsites" | "bytes" | "timeout";
}

export interface ComponentIdentity {
  readonly componentSourceId?: string;
  readonly displayName?: string;
  readonly source: EvidenceSourceRef;
}

export interface ComponentDataFlowReport {
  readonly schemaVersion: typeof DATA_FLOW_SCHEMA_VERSION;
  readonly reportId: string;
  readonly baseline: AnalysisBaseline;
  readonly capability: DataFlowCapability;
  readonly component: ComponentIdentity;
  readonly dependencies: readonly DataDependency[];
  readonly evidence: readonly EvidenceRef[];
  readonly diagnostics: readonly DataFlowDiagnostic[];
  readonly completeness: ReportCompleteness;
}

export interface PageDataFlowReport {
  readonly schemaVersion: typeof DATA_FLOW_SCHEMA_VERSION;
  readonly reportId: string;
  readonly baseline: AnalysisBaseline;
  readonly capability: DataFlowCapability;
  readonly dependencies: readonly DataDependency[];
  readonly evidence: readonly EvidenceRef[];
  readonly diagnostics: readonly DataFlowDiagnostic[];
  readonly completeness: ReportCompleteness;
}

const boundedText = (maximum: number): z.ZodString =>
  z.string().trim().min(1).max(maximum);
const opaqueIdSchema = boundedText(128).regex(/^[A-Za-z0-9_-]+$/u);
const diagnosticCodeSchema = z.enum(DATA_FLOW_DIAGNOSTIC_CODES);
const evidenceSourceSchema = z.strictObject({
  fileId: opaqueIdSchema,
  displayPath: boundedText(1_024),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  sourceVersion: opaqueIdSchema,
});

const sanitizedObservedUrlSchema = z.strictObject({
  origin: boundedText(512).optional(),
  pathname: boundedText(2_048),
  queryKeys: z.array(boundedText(256)).max(DEFAULT_DATA_FLOW_LIMITS.reportMaxFields),
});
const dataParameterSchema = z.strictObject({
  path: boundedText(1_024),
  position: z.enum([
    "path",
    "query",
    "body",
    "header",
    "cookie",
    "variable",
    "form",
    "unknown",
  ]),
  type: boundedText(512).optional(),
  source: boundedText(1_024).optional(),
  condition: boundedText(1_024).optional(),
  sensitive: z.boolean(),
  valueState: z.literal("not-collected"),
  evidenceIds: z.array(opaqueIdSchema).max(DEFAULT_DATA_FLOW_LIMITS.reportMaxEvidence),
});
const dataResponseSchema = z.strictObject({
  consumedFields: z
    .array(boundedText(1_024))
    .max(DEFAULT_DATA_FLOW_LIMITS.reportMaxFields),
});
const requestOriginSchema = z.strictObject({
  componentSourceId: opaqueIdSchema.optional(),
  triggerCallsiteId: opaqueIdSchema.optional(),
  requestCallsiteId: opaqueIdSchema,
  sourceVersion: opaqueIdSchema,
});
const capabilityReasonSchema = z.strictObject({
  code: diagnosticCodeSchema,
  retryable: z.boolean(),
});
const capabilitySchema = z.strictObject({
  enabled: z.boolean(),
  staticAnalysis: z.enum(["available", "partial", "unavailable"]),
  runtimeObservation: z.literal("dispatch-only"),
  responseShape: z.literal("consumed-fields-only"),
  aiAssistance: z.literal("disabled"),
  reasons: z
    .array(capabilityReasonSchema)
    .max(DEFAULT_DATA_FLOW_LIMITS.capabilityMaxReasons),
});
const evidenceSchema = z.strictObject({
  id: opaqueIdSchema,
  kind: z.enum([
    "source-anchor",
    "import-resolution",
    "symbol-edge",
    "trigger-edge",
    "call-edge",
    "data-binding",
    "adapter-rule",
    "runtime-observation",
    "runtime-reference",
    "diagnostic",
  ]),
  source: evidenceSourceSchema.optional(),
  adapter: z
    .strictObject({ id: boundedText(128), version: boundedText(64) })
    .optional(),
  summaryKey: boundedText(256),
});
const diagnosticSchema = z.strictObject({
  id: opaqueIdSchema,
  code: diagnosticCodeSchema,
  severity: z.enum(["info", "warning", "error"]),
  retryable: z.boolean(),
  evidenceIds: z.array(opaqueIdSchema).max(DEFAULT_DATA_FLOW_LIMITS.reportMaxEvidence),
});
const baselineSchema = z.strictObject({
  registryEpoch: opaqueIdSchema,
  analyzerVersion: boundedText(64),
  adapterSetHash: boundedText(128),
  analyzedSourceVersions: z
    .array(opaqueIdSchema)
    .max(DEFAULT_DATA_FLOW_LIMITS.graphMaxModules),
});
const completenessSchema = z.strictObject({
  complete: z.boolean(),
  visitedModules: z.number().int().nonnegative(),
  visitedCallsites: z.number().int().nonnegative(),
  frontierCount: z.number().int().nonnegative(),
  truncatedBy: z.enum(["depth", "modules", "callsites", "bytes", "timeout"]).optional(),
});

export const dataDependencySchema = z.strictObject({
  id: opaqueIdSchema,
  kind: z.enum(["http", "graphql", "rpc", "server-action", "unknown"]),
  direction: z.enum(["read", "write", "read-write", "unknown"]),
  execution: z.enum(DATA_FLOW_EXECUTION_STATES),
  environment: z.enum(["server", "client"]).optional(),
  proof: z.enum(DATA_FLOW_PROOF_STATES),
  association: z.enum(DATA_FLOW_ASSOCIATION_KINDS),
  method: boundedText(32).optional(),
  operation: boundedText(512).optional(),
  url: sanitizedObservedUrlSchema.optional(),
  parameters: z
    .array(dataParameterSchema)
    .max(DEFAULT_DATA_FLOW_LIMITS.reportMaxFields),
  response: dataResponseSchema,
  origin: requestOriginSchema.optional(),
  suppliedBindings: z
    .array(boundedText(1_024))
    .max(DEFAULT_DATA_FLOW_LIMITS.graphMaxCallsites),
  locationIds: z.array(opaqueIdSchema).max(DEFAULT_DATA_FLOW_LIMITS.graphMaxCallsites),
  evidenceIds: z.array(opaqueIdSchema).max(DEFAULT_DATA_FLOW_LIMITS.reportMaxEvidence),
  observationIds: z
    .array(opaqueIdSchema)
    .max(DEFAULT_DATA_FLOW_LIMITS.observationMaxEntries),
});

export const networkObservationSchema = z.strictObject({
  schemaVersion: z.literal(DATA_FLOW_SCHEMA_VERSION),
  id: opaqueIdSchema,
  pageEpoch: opaqueIdSchema,
  routeEpoch: opaqueIdSchema,
  requestCallsiteId: opaqueIdSchema.optional(),
  invocationId: opaqueIdSchema.optional(),
  componentSourceId: opaqueIdSchema.optional(),
  triggerCallsiteId: opaqueIdSchema.optional(),
  sourceVersion: opaqueIdSchema.optional(),
  transport: z.enum(["fetch", "trpc", "xhr"]),
  method: boundedText(32),
  operation: boundedText(512).optional(),
  url: sanitizedObservedUrlSchema,
  outcome: z.literal("dispatched"),
  freshness: z.enum(DATA_FLOW_FRESHNESS_STATES),
  diagnosticIds: z
    .array(opaqueIdSchema)
    .max(DEFAULT_DATA_FLOW_LIMITS.reportMaxEvidence),
});

const componentIdentitySchema = z.strictObject({
  componentSourceId: opaqueIdSchema.optional(),
  displayName: boundedText(256).optional(),
  source: evidenceSourceSchema,
});

export const componentDataFlowReportSchema = z.strictObject({
  schemaVersion: z.literal(DATA_FLOW_SCHEMA_VERSION),
  reportId: opaqueIdSchema,
  baseline: baselineSchema,
  capability: capabilitySchema,
  component: componentIdentitySchema,
  dependencies: z
    .array(dataDependencySchema)
    .max(DEFAULT_DATA_FLOW_LIMITS.graphMaxCallsites),
  evidence: z.array(evidenceSchema).max(DEFAULT_DATA_FLOW_LIMITS.reportMaxEvidence),
  diagnostics: z
    .array(diagnosticSchema)
    .max(DEFAULT_DATA_FLOW_LIMITS.reportMaxDiagnostics),
  completeness: completenessSchema,
});

export const pageDataFlowReportSchema = z.strictObject({
  schemaVersion: z.literal(DATA_FLOW_SCHEMA_VERSION),
  reportId: opaqueIdSchema,
  baseline: baselineSchema,
  capability: capabilitySchema,
  dependencies: z
    .array(dataDependencySchema)
    .max(DEFAULT_DATA_FLOW_LIMITS.graphMaxCallsites),
  evidence: z.array(evidenceSchema).max(DEFAULT_DATA_FLOW_LIMITS.reportMaxEvidence),
  diagnostics: z
    .array(diagnosticSchema)
    .max(DEFAULT_DATA_FLOW_LIMITS.reportMaxDiagnostics),
  completeness: completenessSchema,
});

export const runtimeDataFlowConfigSchema: z.ZodType<RuntimeDataFlowConfig> =
  z.strictObject({
    enabled: z.boolean(),
    runtime: z.literal("dispatch"),
    limits: z.strictObject({
      observationMaxEntries: z.number().int().positive(),
      observationMaxBytes: z.number().int().positive(),
      observationTtlMs: z.number().int().positive(),
      reportMaxBytes: z.number().int().positive(),
    }),
  });
