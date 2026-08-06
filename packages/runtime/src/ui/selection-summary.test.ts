import { describe, expect, it } from "vitest";

import { createSelectionSummary } from "./selection-summary.js";

describe("selection diagnostics summary", () => {
  it("shows versions, confidence semantics, adapter, API, and CSS warnings", () => {
    const summary = createSelectionSummary({
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
    });

    expect(summary).toContain("SpotPatch: 1.0.0");
    expect(summary).toContain("Vite: 7.3.6");
    expect(summary).toContain("src/App.tsx:20:4");
    expect(summary).toContain("Confidence: exact (精确元素源码)");
    expect(summary).toContain("React adapter: available");
    expect(summary).toContain("API: connected");
    expect(summary).toContain("Boundary: component");
    expect(summary).toContain("Warning: A stylesheet was inaccessible.");
  });
});
