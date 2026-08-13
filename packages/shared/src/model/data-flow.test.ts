import { describe, expect, it } from "vitest";

import {
  DATA_FLOW_SCHEMA_VERSION,
  DEFAULT_DATA_FLOW_LIMITS,
  DEFAULT_RUNTIME_DATA_FLOW_LIMITS,
  dataDependencySchema,
  networkObservationSchema,
  pageDataFlowReportSchema,
  runtimeDataFlowConfigSchema,
  type DataDependency,
  type PageDataFlowReport,
} from "./data-flow.js";
import { limitDataFlowReportCollections } from "./data-flow-budget.js";

const emptyResponse = Object.freeze({
  consumedFields: Object.freeze([]),
});

describe("data-flow public contracts", () => {
  it("keeps execution, proof, and association as independent facts", () => {
    const parsed = dataDependencySchema.safeParse({
      id: "dependency_1",
      kind: "http",
      direction: "write",
      execution: "observed",
      proof: "unavailable",
      association: "unassigned",
      method: "POST",
      parameters: [],
      response: emptyResponse,
      suppliedBindings: [],
      locationIds: [],
      evidenceIds: [],
      observationIds: ["observation_1"],
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects raw parameter values and raw URLs", () => {
    const dependency = {
      id: "dependency_1",
      kind: "http",
      direction: "write",
      execution: "declared-not-observed",
      proof: "proven",
      association: "direct",
      method: "POST",
      parameters: [
        {
          path: "body.password",
          position: "body",
          sensitive: true,
          valueState: "not-collected",
          evidenceIds: [],
          value: "must-never-be-accepted",
        },
      ],
      response: emptyResponse,
      suppliedBindings: [],
      locationIds: [],
      evidenceIds: [],
      observationIds: [],
    };
    const observation = {
      schemaVersion: DATA_FLOW_SCHEMA_VERSION,
      id: "observation_1",
      pageEpoch: "page_1",
      routeEpoch: "route_1",
      transport: "fetch",
      method: "GET",
      url: {
        pathname: "/wechat/query",
        queryKeys: ["scene_id"],
        raw: "https://api.example.test/wechat/query?scene_id=secret",
      },
      outcome: "dispatched",
      freshness: "current",
      diagnosticIds: [],
    };

    expect(dataDependencySchema.safeParse(dependency).success).toBe(false);
    expect(networkObservationSchema.safeParse(observation).success).toBe(false);
  });

  it("uses one strict runtime limit object", () => {
    expect(
      runtimeDataFlowConfigSchema.safeParse({
        enabled: true,
        runtime: "dispatch",
        limits: DEFAULT_RUNTIME_DATA_FLOW_LIMITS,
      }).success,
    ).toBe(true);
    expect(
      runtimeDataFlowConfigSchema.safeParse({
        enabled: true,
        runtime: "dispatch",
        limits: { ...DEFAULT_RUNTIME_DATA_FLOW_LIMITS, undocumentedLimit: 1 },
      }).success,
    ).toBe(false);
  });

  it("limits aggregated reports to valid immutable collection budgets", () => {
    const dependencies = Array.from(
      { length: DEFAULT_DATA_FLOW_LIMITS.graphMaxCallsites + 1 },
      (_, index): DataDependency =>
        Object.freeze({
          id: `dependency_${String(index)}`,
          kind: "http",
          direction: "read",
          execution: "declared-not-observed",
          proof: "proven",
          association: "direct",
          method: "GET",
          parameters: Object.freeze([]),
          response: Object.freeze({ consumedFields: Object.freeze([]) }),
          suppliedBindings: Object.freeze([]),
          locationIds: Object.freeze([]),
          evidenceIds: Object.freeze([`evidence_${String(index)}`]),
          observationIds: Object.freeze([]),
        }),
    );
    const report = Object.freeze({
      schemaVersion: DATA_FLOW_SCHEMA_VERSION,
      reportId: "report_oversized",
      baseline: Object.freeze({
        registryEpoch: "registry_1",
        analyzerVersion: "1",
        adapterSetHash: "builtin",
        analyzedSourceVersions: Object.freeze(
          Array.from(
            { length: DEFAULT_DATA_FLOW_LIMITS.graphMaxModules + 1 },
            (_, index) => `source_${String(index)}`,
          ),
        ),
      }),
      capability: Object.freeze({
        enabled: true,
        staticAnalysis: "available",
        runtimeObservation: "dispatch-only",
        responseShape: "consumed-fields-only",
        aiAssistance: "disabled",
        reasons: Object.freeze([]),
      }),
      dependencies: Object.freeze(dependencies),
      evidence: Object.freeze(
        dependencies.map((_, index) =>
          Object.freeze({
            id: `evidence_${String(index)}`,
            kind: "source-anchor" as const,
            summaryKey: "dataFlow.evidence.requestCallsite",
          }),
        ),
      ),
      diagnostics: Object.freeze([]),
      completeness: Object.freeze({
        complete: true,
        visitedModules: DEFAULT_DATA_FLOW_LIMITS.graphMaxModules + 1,
        visitedCallsites: DEFAULT_DATA_FLOW_LIMITS.graphMaxCallsites + 1,
        frontierCount: 0,
      }),
    }) satisfies PageDataFlowReport;

    const limited = limitDataFlowReportCollections(report);

    expect(limited.dependencies).toHaveLength(
      DEFAULT_DATA_FLOW_LIMITS.graphMaxCallsites,
    );
    expect(limited.baseline.analyzedSourceVersions).toHaveLength(
      DEFAULT_DATA_FLOW_LIMITS.graphMaxModules,
    );
    expect(limited.completeness).toMatchObject({
      complete: false,
      truncatedBy: "callsites",
    });
    expect(limited.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "DATA_FLOW_ANALYSIS_TRUNCATED" }),
      ]),
    );
    expect(pageDataFlowReportSchema.safeParse(limited).success).toBe(true);
    expect(Object.isFrozen(limited.dependencies)).toBe(true);
  });
});
