import { describe, expect, it, vi } from "vitest";
import { transform } from "@astrojs/compiler-rs";

import { injectAstroSourceMarkers } from "./astro-source-markers.js";

function inject(code: string, onExistingMarker = vi.fn()) {
  return injectAstroSourceMarkers({
    code,
    absolutePath: "/project/src/Test.astro",
    root: "/project",
    fileId: "opaque-id",
    onExistingMarker,
  });
}

describe("Astro source markers", () => {
  it("preserves frontmatter, scripts, styles, component calls and slots", () => {
    const code =
      '---\nconst value = 1;\n---\n<Card><div><slot><span>fallback</span></slot></div></Card><script>console.log("<div>")</script><style>div{color:red}</style>';
    const result = inject(code);
    expect(result?.markerCount).toBe(2);
    expect(result?.code).toContain(
      '<Card><div data-spotpatch-source="opaque-id:4:7:astro"><slot>',
    );
    expect(result?.code).toContain(
      '<script>console.log("<div>")</script><style>div{color:red}</style>',
    );
    expect(result?.code).toContain("---\nconst value = 1;\n---");
    expect(result?.map.sources).toEqual(["src/Test.astro"]);
    expect(result?.map.sourcesContent).toEqual([code]);
    expect(result?.map.mappings.length).toBeGreaterThan(0);
  });

  it.each([
    "<div {... props } title = { a > b } foo = '&amp;' />",
    '<div title={`hello ${x > 0 ? `a ${x}` : "b"}`} />',
    '<div title={/}/.test(value) ? ">" : "<"} />',
    "<div title={a /* > */} {...(a ? b : c)} />",
    "<div { foo } disabled a=x />",
    '<my-element class:list={["x"]} />',
    '<svg><path d="M0 0" /></svg>',
    '<input aria-label="x > y"/>',
    "<div title=`hello ${x}` />",
  ])("instruments complex opening tags without rewriting attributes: %s", (code) => {
    const result = inject(code);
    expect(result?.markerCount).toBeGreaterThan(0);
    expect(result?.code.replace(/ data-spotpatch-source="[^"]+"/gu, "")).toBe(code);
    expect(transform(result?.code ?? "", { filename: "Test.astro" })).toHaveProperty(
      "code",
    );
  });

  it("places the explicit marker before HTML spreads", () => {
    expect(inject("<button {...props}>Go</button>")?.code).toBe(
      '<button data-spotpatch-source="opaque-id:1:1:astro" {...props}>Go</button>',
    );
  });

  it("uses original UTF-16 coordinates after Unicode and CRLF", () => {
    const result = inject("<p>中文😀</p><button>好</button>\r\n  <input/>");
    expect(result?.code).toContain('data-spotpatch-source="opaque-id:1:12:astro"');
    expect(result?.code).toContain('data-spotpatch-source="opaque-id:2:3:astro"');
  });

  it("does not replace existing markers", () => {
    const warn = vi.fn();
    expect(inject('<div data-spotpatch-source="owned"/>', warn)).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("marks elements inside template expressions", () => {
    expect(inject("{items.map(x => <li>{x}</li>)}")?.markerCount).toBe(1);
  });

  it("rejects invalid syntax instead of emitting partial markers", () => {
    expect(() => inject("<div title={")).toThrow(SyntaxError);
  });
});
