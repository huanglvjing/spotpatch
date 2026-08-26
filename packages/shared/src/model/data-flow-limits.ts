export const DEFAULT_DATA_FLOW_LIMITS = Object.freeze({
  observationMaxEntries: 100,
  observationMaxBytes: 256 * 1_024,
  observationTtlMs: 300_000,
  protocolRequestMaxBytes: 32 * 1_024,
  reportMaxBytes: 128 * 1_024,
  reportMaxEvidence: 200,
  reportMaxDiagnostics: 256,
  capabilityMaxReasons: 64,
  graphMaxDepth: 5,
  graphMaxModules: 50,
  graphMaxCallsites: 100,
  analysisTimeoutMs: 2_000,
  reportMaxFields: 100,
  sourceMaxComponents: 256,
} as const);

export type DataFlowLimits = Readonly<{
  [Key in keyof typeof DEFAULT_DATA_FLOW_LIMITS]: number;
}>;

export const DATA_FLOW_URL_QUERY_KEY_LIMIT = DEFAULT_DATA_FLOW_LIMITS.reportMaxFields;

export const DEFAULT_RUNTIME_DATA_FLOW_LIMITS = Object.freeze({
  observationMaxEntries: DEFAULT_DATA_FLOW_LIMITS.observationMaxEntries,
  observationMaxBytes: DEFAULT_DATA_FLOW_LIMITS.observationMaxBytes,
  observationTtlMs: DEFAULT_DATA_FLOW_LIMITS.observationTtlMs,
  reportMaxBytes: DEFAULT_DATA_FLOW_LIMITS.reportMaxBytes,
});

export type RuntimeDataFlowLimits = Readonly<{
  [Key in keyof typeof DEFAULT_RUNTIME_DATA_FLOW_LIMITS]: number;
}>;
