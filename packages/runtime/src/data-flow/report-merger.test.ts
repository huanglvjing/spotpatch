import {
  DATA_FLOW_SCHEMA_VERSION,
  DEFAULT_DATA_FLOW_LIMITS,
  pageDataFlowReportSchema,
  type ComponentDataFlowReport,
  type DataDependency,
  type NetworkObservation,
  type PageDataFlowReport,
} from "@spotpatch/shared";
import { describe, expect, it } from "vitest";

import {
  mergeComponentDataFlowReport,
  mergePageDataFlowReport,
} from "./report-merger.js";

function dependency(association: "direct" | "transitive"): DataDependency {
  return Object.freeze({
    id: `dependency_${association}`,
    kind: "http",
    direction: "read",
    execution: "declared-not-observed",
    proof: "proven",
    association,
    method: "GET",
    url: Object.freeze({ pathname: "/users", queryKeys: Object.freeze([]) }),
    parameters: Object.freeze([]),
    response: Object.freeze({ consumedFields: Object.freeze([]) }),
    origin: Object.freeze({
      componentSourceId: "component_selected",
      triggerCallsiteId: "trigger_load",
      requestCallsiteId: "request_users",
      sourceVersion: "source_current",
    }),
    suppliedBindings: Object.freeze([]),
    locationIds: Object.freeze([]),
    evidenceIds: Object.freeze([]),
    observationIds: Object.freeze([]),
  });
}

function observation(overrides: Partial<NetworkObservation> = {}): NetworkObservation {
  return Object.freeze({
    schemaVersion: DATA_FLOW_SCHEMA_VERSION,
    id: "observation_users",
    pageEpoch: "page_1",
    routeEpoch: "route_1",
    requestCallsiteId: "request_users",
    componentSourceId: "component_selected",
    triggerCallsiteId: "trigger_load",
    sourceVersion: "source_current",
    transport: "fetch",
    method: "GET",
    url: Object.freeze({
      origin: "https://api.example.test",
      pathname: "/users",
      queryKeys: Object.freeze([]),
    }),
    outcome: "dispatched",
    freshness: "current",
    diagnosticIds: Object.freeze([]),
    ...overrides,
  });
}

const baseline = Object.freeze({
  registryEpoch: "registry_1",
  analyzerVersion: "1",
  adapterSetHash: "builtin",
  analyzedSourceVersions: Object.freeze(["source_current"]),
});
const capability = Object.freeze({
  enabled: true,
  staticAnalysis: "available" as const,
  runtimeObservation: "dispatch-only" as const,
  responseShape: "consumed-fields-only" as const,
  aiAssistance: "disabled" as const,
  reasons: Object.freeze([]),
});
const completeness = Object.freeze({
  complete: true,
  visitedModules: 1,
  visitedCallsites: 1,
  frontierCount: 0,
});

function componentReport(value: DataDependency): ComponentDataFlowReport {
  return Object.freeze({
    schemaVersion: DATA_FLOW_SCHEMA_VERSION,
    reportId: "report_component",
    baseline,
    capability,
    component: Object.freeze({
      componentSourceId: "component_selected",
      source: Object.freeze({
        fileId: "file_1",
        displayPath: "src/App.tsx",
        line: 1,
        column: 1,
        sourceVersion: "source_current",
      }),
    }),
    dependencies: Object.freeze([value]),
    evidence: Object.freeze([]),
    diagnostics: Object.freeze([]),
    completeness,
  });
}

describe("data-flow report merger", () => {
  it("marks an exact matching dispatch as observed", () => {
    const report = mergeComponentDataFlowReport(componentReport(dependency("direct")), [
      observation(),
    ]);
    expect(report.dependencies[0]).toMatchObject({
      execution: "observed",
      observationIds: ["observation_users"],
      url: { origin: "https://api.example.test", pathname: "/users" },
    });
    expect(report.evidence).toContainEqual(
      expect.objectContaining({ id: "observation_users", kind: "runtime-observation" }),
    );
  });

  it("requires an existing static origin to match the observed origin", () => {
    const value = dependency("direct");
    const report = mergeComponentDataFlowReport(
      componentReport(
        Object.freeze({
          ...value,
          url: Object.freeze({
            origin: "https://expected.example.test",
            pathname: "/users",
            queryKeys: Object.freeze([]),
          }),
        }),
      ),
      [observation()],
    );

    expect(report.dependencies[0]?.execution).toBe("declared-not-observed");
  });

  it("does not choose an origin when exact observations disagree", () => {
    const report = mergeComponentDataFlowReport(componentReport(dependency("direct")), [
      observation(),
      observation({
        id: "observation_other_origin",
        url: Object.freeze({
          origin: "https://other.example.test",
          pathname: "/users",
          queryKeys: Object.freeze([]),
        }),
      }),
    ]);

    expect(report.dependencies[0]).toMatchObject({ execution: "observed" });
    expect(report.dependencies[0]?.url?.origin).toBeUndefined();
  });

  it("does not assign a shared callsite to the wrong component", () => {
    const report = mergeComponentDataFlowReport(
      componentReport(dependency("transitive")),
      [observation({ componentSourceId: "component_other" })],
    );
    expect(report.dependencies[0]?.execution).toBe("declared-not-observed");
  });

  it("merges independently compiled browser scopes without claiming server execution", () => {
    const original = componentReport(dependency("direct"));
    const browser = Object.freeze({
      ...dependency("direct"),
      environment: "client" as const,
    });
    const server = Object.freeze({
      ...dependency("direct"),
      id: "server_dependency",
      environment: "server" as const,
    });
    const report = mergeComponentDataFlowReport(
      {
        ...original,
        component: { ...original.component, componentSourceId: "document_owner" },
        dependencies: [browser, server],
      },
      [observation()],
    );
    expect(report.dependencies.map((entry) => entry.execution)).toEqual([
      "observed",
      "declared-not-observed",
    ]);
  });

  it("assigns a shared callsite only with exact component and trigger provenance", () => {
    const report = mergeComponentDataFlowReport(
      componentReport(dependency("transitive")),
      [observation()],
    );
    expect(report.dependencies[0]?.execution).toBe("observed");
  });

  it("does not assign a shared callsite to the wrong trigger", () => {
    const report = mergeComponentDataFlowReport(
      componentReport(dependency("transitive")),
      [observation({ triggerCallsiteId: "trigger_other" })],
    );
    expect(report.dependencies[0]?.execution).toBe("declared-not-observed");
  });

  it("matches a tRPC logical dispatch by operation and exact callsite evidence", () => {
    const { url: discardedUrl, ...base } = dependency("direct");
    void discardedUrl;
    const rpc = Object.freeze({
      ...base,
      kind: "rpc" as const,
      method: "QUERY",
      operation: "user.byId",
    }) satisfies DataDependency;
    const report = mergeComponentDataFlowReport(componentReport(rpc), [
      observation({
        transport: "trpc",
        method: "QUERY",
        operation: "user.byId",
        url: Object.freeze({
          pathname: "user.byId",
          queryKeys: Object.freeze([]),
        }),
      }),
    ]);

    expect(report.dependencies[0]).toMatchObject({
      execution: "observed",
      kind: "rpc",
      operation: "user.byId",
    });
  });

  it("does not match a different tRPC procedure at the same source callsite", () => {
    const { url: discardedUrl, ...base } = dependency("direct");
    void discardedUrl;
    const rpc = Object.freeze({
      ...base,
      kind: "rpc" as const,
      method: "QUERY",
      operation: "user.byId",
    }) satisfies DataDependency;
    const report = mergeComponentDataFlowReport(componentReport(rpc), [
      observation({
        transport: "trpc",
        method: "QUERY",
        operation: "user.list",
        url: Object.freeze({
          pathname: "user.list",
          queryKeys: Object.freeze([]),
        }),
      }),
    ]);

    expect(report.dependencies[0]?.execution).toBe("declared-not-observed");
  });

  it("keeps unmatched page traffic explicit and value-free", () => {
    const page: PageDataFlowReport = Object.freeze({
      schemaVersion: DATA_FLOW_SCHEMA_VERSION,
      reportId: "report_page",
      baseline,
      capability,
      dependencies: Object.freeze([]),
      evidence: Object.freeze([]),
      diagnostics: Object.freeze([]),
      completeness,
    });
    const report = mergePageDataFlowReport(page, [
      observation({
        id: "observation_query",
        url: Object.freeze({
          pathname: "/search",
          queryKeys: Object.freeze(["token", "page"]),
        }),
      }),
    ]);
    expect(report.dependencies[0]).toMatchObject({
      association: "unassigned",
      url: { pathname: "/search", queryKeys: ["token", "page"] },
      parameters: [
        { path: "token", sensitive: true, valueState: "not-collected" },
        { path: "page", sensitive: false, valueState: "not-collected" },
      ],
    });
    expect(JSON.stringify(report)).not.toContain("secret");
  });

  it("drops overflow observations explicitly while preserving a valid report", () => {
    const dependencies = Object.freeze(
      Array.from({ length: DEFAULT_DATA_FLOW_LIMITS.graphMaxCallsites }, (_, index) => {
        const value = dependency("direct");
        return Object.freeze({
          ...value,
          id: `dependency_${String(index)}`,
          origin: Object.freeze({
            componentSourceId: "component_selected",
            triggerCallsiteId: "trigger_load",
            requestCallsiteId: `request_${String(index)}`,
            sourceVersion: "source_current",
          }),
        });
      }),
    );
    const page: PageDataFlowReport = Object.freeze({
      schemaVersion: DATA_FLOW_SCHEMA_VERSION,
      reportId: "report_bounded_page",
      baseline,
      capability,
      dependencies,
      evidence: Object.freeze([]),
      diagnostics: Object.freeze([]),
      completeness,
    });

    const report = mergePageDataFlowReport(page, [
      observation({
        id: "observation_overflow",
        requestCallsiteId: "request_unmatched",
        url: Object.freeze({ pathname: "/overflow", queryKeys: Object.freeze([]) }),
      }),
    ]);

    expect(report.dependencies).toHaveLength(
      DEFAULT_DATA_FLOW_LIMITS.graphMaxCallsites,
    );
    expect(report.dependencies.some(({ url }) => url?.pathname === "/overflow")).toBe(
      false,
    );
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "DATA_FLOW_OBSERVATION_DROPPED" }),
      ]),
    );
    expect(pageDataFlowReportSchema.safeParse(report).success).toBe(true);
  });
});
