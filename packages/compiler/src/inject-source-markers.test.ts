import path from "node:path";

import { describe, expect, it } from "vitest";

import { injectSourceMarkers, type TransformWarning } from "./inject-source-markers.js";

const root = path.resolve("/project");
const absolutePath = path.join(root, "src", "Example.tsx");

function transform(code: string, onWarning?: (warning: TransformWarning) => void) {
  return injectSourceMarkers({
    code,
    absolutePath,
    root,
    fileId: "Q7k3pA9vL2s",
    ...(onWarning === undefined ? {} : { onWarning }),
  });
}

describe("injectSourceMarkers", () => {
  it.each([
    ["div", "const view = <div />;"],
    ["button", "const view = <button>Save</button>;"],
    ["input", "const view = <input />;"],
    ["SVG", "const view = <svg><path /></svg>;"],
    ["Web Component", "const view = <my-element />;"],
  ])("injects an intrinsic %s", (_name, code) => {
    const result = transform(code);

    expect(result?.code).toContain('data-spotpatch-source="Q7k3pA9vL2s:1:14"');
  });

  it("places the explicit marker after spread properties", () => {
    const result = transform("const view = <button {...props} />;");

    expect(result?.code).toBe(
      'const view = <button {...props} data-spotpatch-source="Q7k3pA9vL2s:1:14" />;',
    );
  });

  it("keeps one source position for repeated list instances", () => {
    const result = transform(
      "const view = items.map((item) => <li key={item.id}>{item.name}</li>);",
    );

    expect(result?.markerCount).toBe(1);
    expect(result?.code).toContain('data-spotpatch-source="Q7k3pA9vL2s:1:34"');
  });

  it("injects intrinsic roots inside fragments and conditional expressions", () => {
    const result = transform(
      "const view = <>{ready ? <section /> : <aside />}<footer /></>;",
    );

    expect(result?.markerCount).toBe(3);
    expect(result?.code).not.toContain("<> data-spotpatch-source");
  });

  it.each([
    "const view = <UserCard />;",
    "const view = <motion.div />;",
    "const value = '<div />';",
    "// <div />\nexport const value = 1;",
  ])("does not inject unsupported or non-AST JSX: %s", (code) => {
    expect(transform(code)).toBeUndefined();
  });

  it("preserves an existing marker and emits a diagnostic", () => {
    const warnings: TransformWarning[] = [];
    const result = transform(
      '<div data-spotpatch-source="application-value" />;',
      (warning) => warnings.push(warning),
    );

    expect(result).toBeUndefined();
    expect(warnings).toEqual([{ code: "EXISTING_SOURCE_MARKER", line: 1, column: 1 }]);
  });

  it("uses 1-based line and UTF-16 column positions", () => {
    const result = transform('const label = "🙂";\n  const view = <div />;');

    expect(result?.code).toContain('data-spotpatch-source="Q7k3pA9vL2s:2:16"');
  });

  it("returns a high-resolution source map with source content", () => {
    const code = "export const view = <div />;";
    const result = transform(code);

    expect(result?.map.sources).toEqual(["src/Example.tsx"]);
    expect(result?.map.sourcesContent).toEqual([code]);
    expect(result?.map.toString()).toContain('"mappings"');
  });

  it("throws a parser error for the plugin boundary to handle fail-open", () => {
    expect(() => transform("const view = <div>;")).toThrow(SyntaxError);
  });
});
