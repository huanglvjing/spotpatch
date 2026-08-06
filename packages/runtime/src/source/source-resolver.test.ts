// @vitest-environment jsdom

import type { ReactAdapter } from "@spotpatch/react-adapter";
import { SOURCE_MARKER_ATTRIBUTE, type ReactContext } from "@spotpatch/shared";
import { describe, expect, it, vi } from "vitest";

import { createSourceResolver, sourceRefToMarker } from "./source-resolver.js";

const unsupported = Object.freeze({
  supported: false,
  componentStack: [],
}) satisfies ReactContext;

function createAdapter(context: ReactContext = unsupported): ReactAdapter {
  return {
    name: "test-react-adapter",
    supports: () => context.supported,
    inspect: () => context,
    dispose: vi.fn(),
  };
}

describe("element source resolver", () => {
  it("prefers an exact marker on the selected host element", () => {
    const element = document.createElement("button");
    element.setAttribute(SOURCE_MARKER_ATTRIBUTE, "exact-file:10:4");
    const adapter = createAdapter({
      supported: true,
      componentStack: ["App"],
      source: {
        relativePath: "src/App.tsx",
        line: 2,
        origin: "react-fiber",
        confidence: "probable",
      },
    });

    const resolution = createSourceResolver({ adapter }).resolve(element);

    expect(resolution.react.componentStack).toEqual(["App"]);
    expect(resolution.source).toEqual({
      fileId: "exact-file",
      line: 10,
      column: 4,
      origin: "jsx-host",
      confidence: "exact",
    });
  });

  it("prefers a probable business composite over a DOM ancestor", () => {
    const ancestor = document.createElement("section");
    ancestor.setAttribute(SOURCE_MARKER_ATTRIBUTE, "ancestor-file:4:2");
    const element = document.createElement("button");
    ancestor.append(element);
    const probable = Object.freeze({
      relativePath: "src/UserActions.tsx",
      line: 20,
      column: 7,
      origin: "react-fiber",
      confidence: "probable",
    } as const);
    const adapter = createAdapter({
      supported: true,
      version: "18.3.1",
      componentName: "UserActions",
      componentStack: ["Button", "UserActions"],
      source: probable,
    });

    expect(createSourceResolver({ adapter }).resolve(element).source).toEqual(probable);
  });

  it("labels a nearest DOM ancestor as approximate, never exact", () => {
    const ancestor = document.createElement("section");
    ancestor.setAttribute(SOURCE_MARKER_ATTRIBUTE, "ancestor-file:4:2");
    const element = document.createElement("span");
    ancestor.append(element);

    expect(
      createSourceResolver({ adapter: createAdapter() }).resolve(element).source,
    ).toEqual({
      fileId: "ancestor-file",
      line: 4,
      column: 2,
      origin: "dom-ancestor",
      confidence: "approximate",
    });
  });

  it("returns an explicit unknown result without reliable source evidence", () => {
    const resolution = createSourceResolver({
      adapter: createAdapter(),
    }).resolve(document.createElement("div"));

    expect(resolution.source).toEqual({
      origin: "none",
      confidence: "unknown",
    });
  });

  it("disables a throwing adapter once and continues in DOM mode", () => {
    const inspect = vi.fn((): ReactContext => {
      throw new Error("private Fiber changed");
    });
    const onAdapterError = vi.fn();
    const adapter: ReactAdapter = {
      name: "throwing-adapter",
      supports: () => true,
      inspect,
      dispose: vi.fn(),
    };
    const resolver = createSourceResolver({ adapter, onAdapterError });
    const element = document.createElement("div");

    expect(resolver.resolve(element).source.confidence).toBe("unknown");
    expect(resolver.resolve(element).source.confidence).toBe("unknown");
    expect(inspect).toHaveBeenCalledOnce();
    expect(onAdapterError).toHaveBeenCalledOnce();
  });

  it("converts only complete opaque source coordinates to an API marker", () => {
    expect(
      sourceRefToMarker({
        fileId: "file-id",
        line: 3,
        column: 8,
        origin: "jsx-host",
        confidence: "exact",
      }),
    ).toEqual({ fileId: "file-id", line: 3, column: 8 });
    expect(
      sourceRefToMarker({
        relativePath: "src/App.tsx",
        line: 3,
        origin: "react-fiber",
        confidence: "probable",
      }),
    ).toBeUndefined();
  });
});
