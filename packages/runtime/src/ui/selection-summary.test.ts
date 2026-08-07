import { describe, expect, it } from "vitest";

import { UI_MESSAGES } from "./localization.js";
import { createSelectionSummary } from "./selection-summary.js";

describe("selection diagnostics summary", () => {
  it("shows versions, confidence semantics, adapter, API, and CSS warnings", () => {
    const summary = createSelectionSummary(
      {
        spotPatchVersion: "1.0.0",
        viteVersion: "7.3.6",
        apiStatus: "connected",
        collectionStatus: "ready",
        resolution: {
          source: {
            fileId: "file-id",
            line: 20,
            column: 4,
            origin: "jsx-host",
            confidence: "exact",
          },
          react: {
            supported: true,
            version: "18.3.1",
            componentName: "App",
            componentStack: ["App"],
          },
        },
        code: {
          relativePath: "src/App.tsx",
          language: "tsx",
          startLine: 1,
          endLine: 30,
          excerpt: "function App() {}",
          boundary: "component",
        },
        styles: {
          classNames: [],
          matchedRules: [],
          computed: {},
          warnings: ["A stylesheet was inaccessible."],
        },
      },
      UI_MESSAGES["en-US"].summary,
    );

    expect(summary).toContain("SpotPatch: 1.0.0");
    expect(summary).toContain("Vite: 7.3.6");
    expect(summary).toContain("src/App.tsx:20:4");
    expect(summary).toContain("Confidence: exact (exact element source)");
    expect(summary).toContain("React adapter: available");
    expect(summary).toContain("API: connected");
    expect(summary).toContain("Boundary: component");
    expect(summary).toContain("Warning: A stylesheet was inaccessible.");
  });

  it("localizes diagnostic labels without changing source facts", () => {
    const summary = createSelectionSummary(
      {
        spotPatchVersion: "1.0.0",
        viteVersion: "7.3.6",
        apiStatus: "not-required",
        collectionStatus: "ready",
        resolution: {
          source: {
            line: 20,
            column: 4,
            origin: "jsx-host",
            confidence: "exact",
          },
          react: {
            supported: true,
            componentStack: [],
          },
        },
      },
      UI_MESSAGES["zh-CN"].summary,
    );

    expect(summary).toContain("源码: 第 20 行，第 4 列");
    expect(summary).toContain("置信度: exact (精确元素源码)");
    expect(summary).toContain("浏览器上下文: 已就绪");
  });
});
