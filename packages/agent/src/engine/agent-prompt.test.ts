import { describe, expect, it } from "vitest";

import type { SpotAnnotation } from "@spotpatch/shared";

import { composeAgentUserPrompt } from "./agent-prompt.js";

describe("Agent prompt", () => {
  it("redacts sensitive context and enforces the exact prompt budget", () => {
    const annotation = {
      schemaVersion: 1,
      id: "annotation",
      note: `Change the label. apiKey="synthetic-note-secret" ${"x".repeat(4_000)}`,
      page: {
        url: "http://localhost:5173/?token=synthetic-url-secret",
        pathname: "/",
        title: "Fixture",
        viewportWidth: 1_440,
        viewportHeight: 900,
        devicePixelRatio: 2,
      },
      source: { origin: "none", confidence: "unknown" },
      react: { supported: false, componentStack: [] },
      element: {
        tagName: "div",
        selector: "div",
        sanitizedHtml: '<div data-value="synthetic-dom-secret">Text</div>',
        rect: { x: 0, y: 0, width: 1, height: 1 },
      },
      styles: {
        classNames: [],
        matchedRules: [],
        computed: { content: "Bearer synthetic-style-secret" },
        warnings: [],
      },
      warnings: [],
      createdAt: "2026-08-07T00:00:00.000Z",
    } satisfies SpotAnnotation;
    const prompt = composeAgentUserPrompt(annotation, 4_096);

    expect(prompt.length).toBeLessThanOrEqual(4_096);
    expect(prompt).toContain("[redacted]");
    expect(prompt).not.toContain("synthetic-note-secret");
    expect(prompt).not.toContain("synthetic-url-secret");
    expect(prompt).not.toContain("synthetic-dom-secret");
    expect(prompt).not.toContain("synthetic-style-secret");
  });
});
