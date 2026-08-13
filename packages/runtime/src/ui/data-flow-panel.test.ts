// @vitest-environment jsdom

import {
  DATA_FLOW_SCHEMA_VERSION,
  type ComponentDataFlowReport,
} from "@spotpatch/shared";
import { describe, expect, it, vi } from "vitest";

import { createDataFlowPanel } from "./data-flow-panel.js";

const report = Object.freeze({
  schemaVersion: DATA_FLOW_SCHEMA_VERSION,
  reportId: "report_wechat",
  baseline: Object.freeze({
    registryEpoch: "registry_1",
    analyzerVersion: "1",
    adapterSetHash: "builtin",
    analyzedSourceVersions: Object.freeze(["source_1"]),
  }),
  capability: Object.freeze({
    enabled: true,
    staticAnalysis: "partial",
    runtimeObservation: "dispatch-only",
    responseShape: "consumed-fields-only",
    aiAssistance: "disabled",
    reasons: Object.freeze([
      Object.freeze({
        code: "DATA_FLOW_ANALYSIS_TRUNCATED",
        retryable: false,
      }),
    ]),
  }),
  component: Object.freeze({
    componentSourceId: "component_wechat",
    displayName: "WechatLogin",
    source: Object.freeze({
      fileId: "file_1",
      displayPath: "src/WechatLogin.tsx",
      line: 1,
      column: 1,
      sourceVersion: "source_1",
    }),
  }),
  dependencies: Object.freeze([
    Object.freeze({
      id: "dependency_wechat",
      kind: "http",
      direction: "write",
      execution: "observed",
      proof: "proven",
      association: "direct",
      method: "POST",
      url: Object.freeze({
        origin: "https://api.example.test",
        pathname: "/wechat/query",
        queryKeys: Object.freeze([]),
      }),
      parameters: Object.freeze([
        Object.freeze({
          path: "scene_id",
          position: "body",
          condition: "enabled",
          sensitive: false,
          valueState: "not-collected",
          evidenceIds: Object.freeze(["evidence_static"]),
        }),
      ]),
      response: Object.freeze({ consumedFields: Object.freeze(["data.token"]) }),
      suppliedBindings: Object.freeze(["zustand:user"]),
      locationIds: Object.freeze([]),
      evidenceIds: Object.freeze(["evidence_static", "observation_1"]),
      observationIds: Object.freeze(["observation_1"]),
    }),
  ]),
  evidence: Object.freeze([
    Object.freeze({
      id: "evidence_static",
      kind: "source-anchor",
      summaryKey: "dataFlow.evidence.requestCallsite",
    }),
    Object.freeze({
      id: "observation_1",
      kind: "runtime-observation",
      summaryKey: "dataFlow.evidence.runtimeDispatch",
    }),
  ]),
  diagnostics: Object.freeze([
    Object.freeze({
      id: "diagnostic_1",
      code: "DATA_FLOW_ANALYSIS_TRUNCATED",
      severity: "warning",
      retryable: false,
      evidenceIds: Object.freeze([]),
    }),
  ]),
  completeness: Object.freeze({
    complete: false,
    visitedModules: 1,
    visitedCallsites: 1,
    frontierCount: 1,
    truncatedBy: "callsites",
  }),
}) satisfies ComponentDataFlowReport;

describe("data-flow panel", () => {
  it("renders sanitized endpoint facts and separates static/runtime evidence", () => {
    const panel = createDataFlowPanel(
      document,
      true,
      () => "en-US",
      document.createElement("section"),
      document.createElement("section"),
      vi.fn(),
    );

    panel.render({
      component: Object.freeze({ status: "ready", report }),
      page: Object.freeze({ status: "idle" }),
      observationCount: 1,
    });

    const text = panel.root.textContent;
    expect(text).toContain("https://api.example.test/wechat/query");
    expect(text).toContain("body.scene_id [when enabled]");
    expect(text).toContain("1 static · 1 runtime");
    expect(text).toContain("DATA_FLOW_ANALYSIS_TRUNCATED");
    expect(panel.root.querySelector("script")).toBeNull();
  });

  it("labels a tRPC observation as logical dispatch rather than an HTTP request", () => {
    const sourceDependency = report.dependencies[0];
    if (sourceDependency === undefined) throw new Error("Expected report dependency.");
    const { url: discardedUrl, ...base } = sourceDependency;
    void discardedUrl;
    const rpcReport: ComponentDataFlowReport = Object.freeze({
      ...report,
      dependencies: Object.freeze([
        Object.freeze({
          ...base,
          kind: "rpc" as const,
          method: "QUERY",
          operation: "user.byId",
        }),
      ]),
    });
    const panel = createDataFlowPanel(
      document,
      true,
      () => "zh-CN",
      document.createElement("section"),
      document.createElement("section"),
      vi.fn(),
    );

    panel.render({
      component: Object.freeze({ status: "ready", report: rpcReport }),
      page: Object.freeze({ status: "idle" }),
      observationCount: 1,
    });

    expect(panel.root.textContent).toContain("QUERYuser.byId");
    expect(panel.root.textContent).toContain("本次会话已进入 tRPC 调用链");
    expect(panel.root.textContent).not.toContain("本次会话已实际请求");
  });
});
