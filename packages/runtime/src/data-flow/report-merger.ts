import {
  isSensitiveName,
  limitDataFlowReportCollections,
  type ComponentDataFlowReport,
  type DataDependency,
  type EvidenceRef,
  type NetworkObservation,
  type PageDataFlowReport,
} from "@spotpatch/shared";

function observationMatchesDependency(
  observation: NetworkObservation,
  dependency: DataDependency,
): boolean {
  const origin = dependency.origin;
  const transportMatches =
    dependency.kind === "rpc"
      ? observation.transport === "trpc" &&
        dependency.operation !== undefined &&
        observation.operation === dependency.operation
      : dependency.kind === "http"
        ? observation.transport === "fetch" || observation.transport === "xhr"
        : false;
  if (
    dependency.environment === "server" ||
    !transportMatches ||
    observation.freshness !== "current" ||
    origin === undefined ||
    observation.requestCallsiteId !== origin.requestCallsiteId ||
    observation.sourceVersion !== origin.sourceVersion ||
    (dependency.method !== undefined &&
      observation.method.toUpperCase() !== dependency.method.toUpperCase()) ||
    (dependency.url !== undefined &&
      observation.url.pathname !== dependency.url.pathname) ||
    (dependency.url?.origin !== undefined &&
      observation.url.origin !== dependency.url.origin) ||
    (origin.componentSourceId !== undefined &&
      observation.componentSourceId !== undefined &&
      observation.componentSourceId !== origin.componentSourceId) ||
    (origin.triggerCallsiteId !== undefined &&
      observation.triggerCallsiteId !== undefined &&
      observation.triggerCallsiteId !== origin.triggerCallsiteId)
  ) {
    return false;
  }

  return (
    dependency.association !== "transitive" ||
    (observation.componentSourceId === origin.componentSourceId &&
      observation.triggerCallsiteId === origin.triggerCallsiteId)
  );
}

function runtimeEvidence(observation: NetworkObservation): EvidenceRef {
  return Object.freeze({
    id: observation.id,
    kind: "runtime-observation",
    summaryKey: "dataFlow.evidence.runtimeDispatch",
  });
}

function mergeDependencies(
  dependencies: readonly DataDependency[],
  observations: readonly NetworkObservation[],
): Readonly<{
  dependencies: readonly DataDependency[];
  matchedObservationIds: ReadonlySet<string>;
}> {
  const matchedObservationIds = new Set<string>();
  const merged = dependencies.map((dependency) => {
    const matches = observations.filter((observation) =>
      observationMatchesDependency(observation, dependency),
    );
    for (const observation of matches) matchedObservationIds.add(observation.id);
    if (matches.length === 0) return dependency;
    const observedOrigins = [
      ...new Set(
        matches.flatMap(({ url }) => (url.origin === undefined ? [] : [url.origin])),
      ),
    ];
    const observedOrigin =
      observedOrigins.length === 1 ? observedOrigins[0] : undefined;
    return Object.freeze({
      ...dependency,
      ...(dependency.url === undefined ||
      dependency.url.origin !== undefined ||
      observedOrigin === undefined
        ? {}
        : {
            url: Object.freeze({
              ...dependency.url,
              origin: observedOrigin,
            }),
          }),
      execution: "observed" as const,
      observationIds: Object.freeze([
        ...new Set([...dependency.observationIds, ...matches.map(({ id }) => id)]),
      ]),
      evidenceIds: Object.freeze([
        ...new Set([...dependency.evidenceIds, ...matches.map(({ id }) => id)]),
      ]),
    });
  });
  return Object.freeze({
    dependencies: Object.freeze(merged),
    matchedObservationIds,
  });
}

function appendRuntimeEvidence(
  evidence: readonly EvidenceRef[],
  observations: readonly NetworkObservation[],
  matchedIds: ReadonlySet<string>,
): readonly EvidenceRef[] {
  const existing = new Set(evidence.map(({ id }) => id));
  return Object.freeze([
    ...evidence,
    ...observations.flatMap((observation) =>
      matchedIds.has(observation.id) && !existing.has(observation.id)
        ? [runtimeEvidence(observation)]
        : [],
    ),
  ]);
}

export function mergeComponentDataFlowReport(
  report: ComponentDataFlowReport,
  observations: readonly NetworkObservation[],
): ComponentDataFlowReport {
  // A source-document report may contain several independently compiled browser
  // scopes. Accept only owners already proven by that authorized static report.
  const owners = new Set([
    report.component.componentSourceId,
    ...report.dependencies
      .filter((dependency) => dependency.environment !== "server")
      .map((dependency) => dependency.origin?.componentSourceId),
  ]);
  const componentObservations = observations.filter(
    (observation) =>
      observation.componentSourceId === undefined ||
      owners.has(observation.componentSourceId),
  );
  const merged = mergeDependencies(report.dependencies, componentObservations);
  return limitDataFlowReportCollections(
    Object.freeze({
      ...report,
      dependencies: merged.dependencies,
      evidence: appendRuntimeEvidence(
        report.evidence,
        componentObservations,
        merged.matchedObservationIds,
      ),
    }),
    { mode: "observation" },
  );
}

function unassignedDependency(observation: NetworkObservation): DataDependency {
  const isRpc = observation.transport === "trpc";
  return Object.freeze({
    id: observation.id,
    kind: isRpc ? "rpc" : "http",
    direction:
      observation.method === "GET" ||
      observation.method === "HEAD" ||
      observation.method === "QUERY" ||
      observation.method === "SUBSCRIPTION"
        ? "read"
        : "write",
    execution: "observed",
    proof: "unavailable",
    association: "unassigned",
    method: observation.method,
    ...(isRpc
      ? observation.operation === undefined
        ? {}
        : { operation: observation.operation }
      : { url: observation.url }),
    parameters: Object.freeze(
      (isRpc ? [] : observation.url.queryKeys).map((path) =>
        Object.freeze({
          path,
          position: "query" as const,
          sensitive: isSensitiveName(path),
          valueState: "not-collected" as const,
          evidenceIds: Object.freeze([observation.id]),
        }),
      ),
    ),
    response: Object.freeze({
      consumedFields: Object.freeze([]),
    }),
    suppliedBindings: Object.freeze([]),
    locationIds: Object.freeze([]),
    evidenceIds: Object.freeze([observation.id]),
    observationIds: Object.freeze([observation.id]),
  });
}

export function mergePageDataFlowReport(
  report: PageDataFlowReport,
  observations: readonly NetworkObservation[],
): PageDataFlowReport {
  const currentObservations = observations.filter(
    ({ freshness }) => freshness === "current",
  );
  const merged = mergeDependencies(report.dependencies, currentObservations);
  const unassigned = currentObservations
    .filter(({ id }) => !merged.matchedObservationIds.has(id))
    .map(unassignedDependency);
  const allObservationIds = new Set(currentObservations.map(({ id }) => id));
  return limitDataFlowReportCollections(
    Object.freeze({
      ...report,
      dependencies: Object.freeze([...merged.dependencies, ...unassigned]),
      evidence: appendRuntimeEvidence(
        report.evidence,
        currentObservations,
        allObservationIds,
      ),
    }),
    { mode: "observation" },
  );
}
