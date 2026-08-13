import {
  type ComponentDataFlowReport,
  type DataDependency,
  type DataFlowDiagnostic,
  type DataFlowDiagnosticCode,
  type EvidenceRef,
  type PageDataFlowReport,
  type ReportCompleteness,
} from "./data-flow.js";
import { DEFAULT_DATA_FLOW_LIMITS } from "./data-flow-limits.js";

type DataFlowReport = ComponentDataFlowReport | PageDataFlowReport;

export interface DataFlowCollectionLimitOptions {
  readonly forceTruncation?: boolean;
  readonly maximumDependencies?: number;
  readonly mode?: "analysis" | "observation";
  readonly truncatedBy?: ReportCompleteness["truncatedBy"];
}

interface LimitedDependency {
  readonly dependency: DataDependency;
  readonly trimmed: boolean;
}

function prefix<T>(values: readonly T[], maximum: number): readonly T[] {
  return Object.freeze(values.slice(0, Math.max(0, maximum)));
}

function limitDependency(dependency: DataDependency): LimitedDependency {
  const queryKeys =
    dependency.url === undefined
      ? undefined
      : prefix(dependency.url.queryKeys, DEFAULT_DATA_FLOW_LIMITS.reportMaxFields);
  const parameters = prefix(
    dependency.parameters,
    DEFAULT_DATA_FLOW_LIMITS.reportMaxFields,
  ).map((parameter) =>
    Object.freeze({
      ...parameter,
      evidenceIds: prefix(
        parameter.evidenceIds,
        DEFAULT_DATA_FLOW_LIMITS.reportMaxEvidence,
      ),
    }),
  );
  const consumedFields = prefix(
    dependency.response.consumedFields,
    DEFAULT_DATA_FLOW_LIMITS.reportMaxFields,
  );
  const suppliedBindings = prefix(
    dependency.suppliedBindings,
    DEFAULT_DATA_FLOW_LIMITS.graphMaxCallsites,
  );
  const locationIds = prefix(
    dependency.locationIds,
    DEFAULT_DATA_FLOW_LIMITS.graphMaxCallsites,
  );
  const evidenceIds = prefix(
    dependency.evidenceIds,
    DEFAULT_DATA_FLOW_LIMITS.reportMaxEvidence,
  );
  const observationIds = prefix(
    dependency.observationIds,
    DEFAULT_DATA_FLOW_LIMITS.observationMaxEntries,
  );
  const trimmed =
    queryKeys?.length !== dependency.url?.queryKeys.length ||
    parameters.length !== dependency.parameters.length ||
    parameters.some(
      (parameter, index) =>
        parameter.evidenceIds.length !==
        dependency.parameters[index]?.evidenceIds.length,
    ) ||
    consumedFields.length !== dependency.response.consumedFields.length ||
    suppliedBindings.length !== dependency.suppliedBindings.length ||
    locationIds.length !== dependency.locationIds.length ||
    evidenceIds.length !== dependency.evidenceIds.length ||
    observationIds.length !== dependency.observationIds.length;

  if (!trimmed) return Object.freeze({ dependency, trimmed: false });

  return Object.freeze({
    dependency: Object.freeze({
      ...dependency,
      ...(dependency.url === undefined
        ? {}
        : {
            url: Object.freeze({
              ...dependency.url,
              queryKeys: queryKeys ?? Object.freeze([]),
            }),
          }),
      parameters: Object.freeze(parameters),
      response: Object.freeze({ consumedFields }),
      suppliedBindings,
      locationIds,
      evidenceIds,
      observationIds,
    }),
    trimmed: true,
  });
}

function referencedEvidenceIds(
  dependencies: readonly DataDependency[],
  diagnostics: readonly DataFlowDiagnostic[],
): readonly string[] {
  return Object.freeze([
    ...new Set([
      ...dependencies.flatMap((dependency) => [
        ...dependency.evidenceIds,
        ...dependency.parameters.flatMap((parameter) => parameter.evidenceIds),
      ]),
      ...diagnostics.flatMap((diagnostic) => diagnostic.evidenceIds),
    ]),
  ]);
}

function prioritizeEvidence(
  evidence: readonly EvidenceRef[],
  referencedIds: readonly string[],
  retainUnreferenced: boolean,
): readonly EvidenceRef[] {
  const byId = new Map(evidence.map((entry) => [entry.id, entry] as const));
  const ordered: EvidenceRef[] = [];
  const retained = new Set<string>();

  for (const id of referencedIds) {
    const entry = byId.get(id);
    if (entry !== undefined && !retained.has(id)) {
      ordered.push(entry);
      retained.add(id);
    }
  }
  if (retainUnreferenced) {
    for (const entry of evidence) {
      if (!retained.has(entry.id)) ordered.push(entry);
    }
  }

  return prefix(ordered, DEFAULT_DATA_FLOW_LIMITS.reportMaxEvidence);
}

function pruneEvidenceReferences(
  dependency: DataDependency,
  retainedIds: ReadonlySet<string>,
): DataDependency {
  return Object.freeze({
    ...dependency,
    parameters: Object.freeze(
      dependency.parameters.map((parameter) =>
        Object.freeze({
          ...parameter,
          evidenceIds: Object.freeze(
            parameter.evidenceIds.filter((id) => retainedIds.has(id)),
          ),
        }),
      ),
    ),
    evidenceIds: Object.freeze(
      dependency.evidenceIds.filter((id) => retainedIds.has(id)),
    ),
  });
}

function truncationCode(mode: "analysis" | "observation"): DataFlowDiagnosticCode {
  return mode === "analysis"
    ? "DATA_FLOW_ANALYSIS_TRUNCATED"
    : "DATA_FLOW_OBSERVATION_DROPPED";
}

export function limitDataFlowReportCollections(
  report: ComponentDataFlowReport,
  options?: DataFlowCollectionLimitOptions,
): ComponentDataFlowReport;
export function limitDataFlowReportCollections(
  report: PageDataFlowReport,
  options?: DataFlowCollectionLimitOptions,
): PageDataFlowReport;
export function limitDataFlowReportCollections(
  report: DataFlowReport,
  options: DataFlowCollectionLimitOptions = {},
): DataFlowReport {
  const maximumDependencies = Math.min(
    Math.max(
      0,
      options.maximumDependencies ?? DEFAULT_DATA_FLOW_LIMITS.graphMaxCallsites,
    ),
    DEFAULT_DATA_FLOW_LIMITS.graphMaxCallsites,
  );
  const dependencyResults = prefix(report.dependencies, maximumDependencies).map(
    limitDependency,
  );
  const dependencies = dependencyResults.map(({ dependency }) => dependency);
  const analyzedSourceVersions = prefix(
    report.baseline.analyzedSourceVersions,
    DEFAULT_DATA_FLOW_LIMITS.graphMaxModules,
  );
  const collectionTrimmed =
    report.dependencies.length > dependencies.length ||
    dependencyResults.some(({ trimmed }) => trimmed) ||
    report.baseline.analyzedSourceVersions.length > analyzedSourceVersions.length ||
    report.capability.reasons.length > DEFAULT_DATA_FLOW_LIMITS.capabilityMaxReasons ||
    report.evidence.length > DEFAULT_DATA_FLOW_LIMITS.reportMaxEvidence ||
    report.diagnostics.length > DEFAULT_DATA_FLOW_LIMITS.reportMaxDiagnostics;
  const truncated = options.forceTruncation === true || collectionTrimmed;
  if (!truncated) return report;

  const mode = options.mode ?? "analysis";
  const code = truncationCode(mode);
  const diagnosticId = `${report.reportId}_collection_${mode}`;
  const reasons = Object.freeze([
    ...report.capability.reasons
      .filter((reason) => reason.code !== code)
      .slice(0, DEFAULT_DATA_FLOW_LIMITS.capabilityMaxReasons - 1),
    Object.freeze({ code, retryable: false }),
  ]);
  const diagnostics = Object.freeze([
    ...report.diagnostics
      .filter((diagnostic) => diagnostic.id !== diagnosticId)
      .slice(0, DEFAULT_DATA_FLOW_LIMITS.reportMaxDiagnostics - 1),
    Object.freeze({
      id: diagnosticId,
      code,
      severity: "warning" as const,
      retryable: false,
      evidenceIds: Object.freeze([]),
    }),
  ]);
  const referencedIds = referencedEvidenceIds(dependencies, diagnostics);
  const evidence = prioritizeEvidence(
    report.evidence,
    referencedIds,
    report.dependencies.length === dependencies.length,
  );
  const retainedEvidenceIds = new Set(evidence.map(({ id }) => id));
  const prunedDependencies = Object.freeze(
    dependencies.map((dependency) =>
      pruneEvidenceReferences(dependency, retainedEvidenceIds),
    ),
  );
  const prunedDiagnostics = Object.freeze(
    diagnostics.map((diagnostic) =>
      Object.freeze({
        ...diagnostic,
        evidenceIds: Object.freeze(
          diagnostic.evidenceIds.filter((id) => retainedEvidenceIds.has(id)),
        ),
      }),
    ),
  );
  const removedDependencies = report.dependencies.length - dependencies.length;
  const removedModules =
    report.baseline.analyzedSourceVersions.length - analyzedSourceVersions.length;
  const derivedTruncation: ReportCompleteness["truncatedBy"] =
    removedModules > 0 && removedDependencies === 0 ? "modules" : "callsites";

  return Object.freeze({
    ...report,
    baseline: Object.freeze({
      ...report.baseline,
      analyzedSourceVersions,
    }),
    capability: Object.freeze({
      ...report.capability,
      ...(mode === "analysis" && report.capability.staticAnalysis === "available"
        ? { staticAnalysis: "partial" as const }
        : {}),
      reasons,
    }),
    dependencies: prunedDependencies,
    evidence,
    diagnostics: prunedDiagnostics,
    ...(mode === "analysis"
      ? {
          completeness: Object.freeze({
            ...report.completeness,
            complete: false,
            frontierCount:
              report.completeness.frontierCount +
              removedDependencies +
              removedModules +
              (collectionTrimmed && removedDependencies === 0 && removedModules === 0
                ? 1
                : 0),
            truncatedBy:
              options.truncatedBy ??
              report.completeness.truncatedBy ??
              derivedTruncation,
          }),
        }
      : {}),
  });
}
