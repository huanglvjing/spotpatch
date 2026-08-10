import { describe, expect, it } from "vitest";

import type { SpotAnnotation } from "@spotpatch/shared";

import { composeAgentUserPrompt } from "./agent-prompt.js";

describe("Agent prompt", () => {
  it("redacts sensitive context and enforces the exact prompt budget", () => {
    const annotation = {
      schemaVersion: 3,
      id: "annotation",
      locale: "en-US",
      page: {
        url: "http://localhost:5173/?token=synthetic-url-secret",
        pathname: "/",
        title: "Fixture",
        viewportWidth: 1_440,
        viewportHeight: 900,
        devicePixelRatio: 2,
      },
      targets: [
        {
          instruction: `Change the label. apiKey="synthetic-note-secret" ${"x".repeat(1_000)}`,
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
        },
      ],
      createdAt: "2026-08-07T00:00:00.000Z",
    } satisfies SpotAnnotation;
    const prompt = composeAgentUserPrompt(annotation, 4_096);

    expect(prompt.length).toBeLessThanOrEqual(4_096);
    expect(prompt).toContain("[redacted]");
    expect(prompt).not.toContain("synthetic-note-secret");
    expect(prompt).not.toContain("synthetic-url-secret");
    expect(prompt).not.toContain("synthetic-dom-secret");
    expect(prompt).not.toContain("synthetic-style-secret");

    const first = annotation.targets[0];

    if (first === undefined) {
      throw new Error("Expected a target fixture.");
    }

    const multi = {
      ...annotation,
      targets: [
        {
          ...first,
          instruction: "Align the first action.",
          page: { ...annotation.page, pathname: "/page-a" },
          source: { ...first.source, relativePath: "src/First.tsx" },
        },
        {
          ...first,
          instruction: "Rename the second action.",
          page: { ...annotation.page, pathname: "/page-b" },
          source: { ...first.source, relativePath: "src/Second.tsx", line: 20 },
          element: { ...first.element, selector: "button.second" },
        },
      ],
    } satisfies SpotAnnotation;
    const multiPrompt = composeAgentUserPrompt(multi, 4_096);
    const serializedContext = multiPrompt
      .split("<spotpatch_context>\n", 2)[1]
      ?.split("\n</spotpatch_context>", 1)[0];

    expect(serializedContext).toBeTypeOf("string");
    const parsed = JSON.parse(serializedContext ?? "null") as {
      readonly targetCount?: number;
      readonly targets?: readonly { readonly page?: { readonly pathname?: string } }[];
    };
    expect(parsed.targetCount).toBe(2);
    expect(parsed.targets).toHaveLength(2);
    expect(parsed.targets?.map((target) => target.page?.pathname)).toEqual([
      "/page-a",
      "/page-b",
    ]);
    expect(multiPrompt).toContain("src/First.tsx");
    expect(multiPrompt).toContain("src/Second.tsx");
    expect(multiPrompt).toContain("Align the first action.");
    expect(multiPrompt).toContain("Rename the second action.");
  });
});
