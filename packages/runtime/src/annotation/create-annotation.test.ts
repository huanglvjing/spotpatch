import type {
  ElementContext,
  PageContext,
  ReactContext,
  SourceRef,
  StyleContext,
} from "@spotpatch/shared";
import { describe, expect, it } from "vitest";

import { createAnnotation } from "./create-annotation.js";

describe("annotation factory", () => {
  it("enriches an opaque source with the authorized relative path and freezes data", () => {
    const annotation = createAnnotation({
      id: "id",
      note: "note",
      createdAt: "2026-08-06T00:00:00.000Z",
      page: {
        url: "http://localhost/",
        pathname: "/",
        title: "Page",
        viewportWidth: 100,
        viewportHeight: 100,
        devicePixelRatio: 1,
      } satisfies PageContext,
      source: {
        fileId: "file-id",
        line: 2,
        column: 3,
        origin: "jsx-host",
        confidence: "exact",
      } satisfies SourceRef,
      react: {
        supported: true,
        componentStack: ["App"],
      } satisfies ReactContext,
      element: {
        tagName: "div",
        selector: "div",
        sanitizedHtml: "<div>",
        rect: { x: 0, y: 0, width: 10, height: 10 },
      } satisfies ElementContext,
      styles: {
        classNames: [],
        matchedRules: [],
        computed: {},
        warnings: [],
      } satisfies StyleContext,
      code: {
        relativePath: "src/App.tsx",
        language: "tsx",
        startLine: 1,
        endLine: 4,
        excerpt: "function App() {}",
        boundary: "component",
      },
      warnings: [],
    });

    expect(annotation.source.relativePath).toBe("src/App.tsx");
    expect(Object.isFrozen(annotation)).toBe(true);
    expect(Object.isFrozen(annotation.page)).toBe(true);
    expect(Object.isFrozen(annotation.react.componentStack)).toBe(true);
    expect(Object.isFrozen(annotation.element.rect)).toBe(true);
    expect(Object.isFrozen(annotation.styles.computed)).toBe(true);
  });
});
