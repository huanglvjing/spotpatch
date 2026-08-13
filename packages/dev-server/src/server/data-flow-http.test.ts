import {
  DATA_FLOW_SCHEMA_VERSION,
  pageDataFlowReportSchema,
  type DataDependency,
  type PageDataFlowReport,
} from "@spotpatch/shared";
import { describe, expect, it } from "vitest";

import { limitDataFlowReportToBytes } from "./data-flow-http.js";

function dependency(index: number): DataDependency {
  return Object.freeze({
    id: `dependency_${String(index)}`,
    kind: "http",
    direction: "read",
    execution: "declared-not-observed",
    proof: "proven",
    association: "direct",
    method: "GET",
    operation: `${String(index)}_${"x".repeat(500)}`,
    parameters: Object.freeze([]),
    response: Object.freeze({
      consumedFields: Object.freeze([]),
    }),
    suppliedBindings: Object.freeze([]),
    locationIds: Object.freeze([]),
    evidenceIds: Object.freeze([]),
    observationIds: Object.freeze([]),
  });
}

describe("data-flow HTTP report budget", () => {
  it("returns a valid deterministic partial prefix within the response limit", () => {
    const report = Object.freeze({
      schemaVersion: DATA_FLOW_SCHEMA_VERSION,
      reportId: "report_page",
      baseline: Object.freeze({
        registryEpoch: "registry_1",
        analyzerVersion: "1",
        adapterSetHash: "builtin",
        analyzedSourceVersions: Object.freeze(["source_1"]),
      }),
      capability: Object.freeze({
        enabled: true,
        staticAnalysis: "available",
        runtimeObservation: "dispatch-only",
        responseShape: "consumed-fields-only",
        aiAssistance: "disabled",
        reasons: Object.freeze([]),
      }),
      dependencies: Object.freeze(
        Array.from({ length: 10 }, (_, index) => dependency(index)),
      ),
      evidence: Object.freeze([]),
      diagnostics: Object.freeze([]),
      completeness: Object.freeze({
        complete: true,
        visitedModules: 1,
        visitedCallsites: 10,
        frontierCount: 0,
      }),
    }) satisfies PageDataFlowReport;
    const maximumBytes = 3_000;

    const limited = limitDataFlowReportToBytes(report, maximumBytes);

    expect(
      Buffer.byteLength(JSON.stringify({ ok: true, data: limited }), "utf8"),
    ).toBeLessThanOrEqual(maximumBytes);
    expect(limited.dependencies.length).toBeLessThan(report.dependencies.length);
    expect(limited.dependencies.map(({ id }) => id)).toEqual(
      report.dependencies.slice(0, limited.dependencies.length).map(({ id }) => id),
    );
    expect(limited.completeness).toMatchObject({
      complete: false,
      truncatedBy: "bytes",
    });
    expect(limited.capability.staticAnalysis).toBe("partial");
    expect(pageDataFlowReportSchema.safeParse(limited).success).toBe(true);
    expect(Object.isFrozen(limited)).toBe(true);
    expect(report.dependencies).toHaveLength(10);
  });
});
