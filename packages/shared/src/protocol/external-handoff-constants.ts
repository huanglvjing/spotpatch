export const EXTERNAL_HANDOFF_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const EXTERNAL_HANDOFF_BROKER_PROTOCOL_VERSION = 2 as const;
export const EXTERNAL_HANDOFF_STATES = Object.freeze([
  "available",
  "expired",
  "superseded",
] as const);
export const EXTERNAL_HANDOFF_FRAMEWORKS = Object.freeze(["vite", "next"] as const);
export const EXTERNAL_HANDOFF_ACTIVE_ADAPTER_KINDS = Object.freeze([
  "claude-channel",
  "codex-app-server",
] as const);
export const EXTERNAL_HANDOFF_ACTIVE_ADAPTER_STATES = Object.freeze([
  "ready",
  "busy",
  "blocked",
] as const);
export const EXTERNAL_HANDOFF_DISPATCH_PHASES = Object.freeze([
  "queued",
  "dispatching",
  "dispatched",
  "working",
  "completed",
  "failed",
  "delivery-unknown",
] as const);
export const EXTERNAL_HANDOFF_REPORTABLE_DISPATCH_PHASES = Object.freeze([
  "dispatching",
  "dispatched",
  "working",
  "completed",
  "failed",
  "delivery-unknown",
] as const);

export const EXTERNAL_HANDOFF_LIMITS = Object.freeze({
  maximumSnapshotBytes: 256 * 1024,
  maximumPublishBodyBytes: 256 * 1024,
  maximumBrokerRequestBytes: 8 * 1024,
  maximumDescriptorBytes: 8 * 1024,
  maximumHistorySummaries: 8,
  maximumConnectorReceipts: 64,
  handoffTtlMs: 15 * 60 * 1_000,
  defaultWaitMs: 20_000,
  maximumWaitMs: 25_000,
  maximumWaiters: 8,
  maximumDescriptorsPerScan: 32,
  maximumProjectAncestors: 64,
  maximumBrokerHeaderBytes: 8 * 1024,
  maximumBrokerSockets: 32,
  brokerDiscoveryTimeoutMs: 750,
  brokerRequestTimeoutMs: 2_000,
  brokerWaitGraceMs: 2_000,
  maximumSetupConfigBytes: 1_024 * 1_024,
  maximumRequestIdRecords: 16,
  requestIdTtlMs: 15 * 60 * 1_000,
  activeHeartbeatIntervalMs: 3_000,
  activeLeaseDurationMs: 10_000,
  activeTransportWriteTimeoutMs: 5_000,
  activeDispatchTimeoutMs: 30 * 60 * 1_000,
  activeStatusPollMs: 1_000,
} as const);

export type ExternalHandoffState = (typeof EXTERNAL_HANDOFF_STATES)[number];
export type ExternalHandoffFramework = (typeof EXTERNAL_HANDOFF_FRAMEWORKS)[number];
export type ExternalHandoffActiveAdapterKind =
  (typeof EXTERNAL_HANDOFF_ACTIVE_ADAPTER_KINDS)[number];
export type ExternalHandoffActiveAdapterState =
  (typeof EXTERNAL_HANDOFF_ACTIVE_ADAPTER_STATES)[number];
export type ExternalHandoffDispatchPhase =
  (typeof EXTERNAL_HANDOFF_DISPATCH_PHASES)[number];
export type ExternalHandoffReportableDispatchPhase =
  (typeof EXTERNAL_HANDOFF_REPORTABLE_DISPATCH_PHASES)[number];
