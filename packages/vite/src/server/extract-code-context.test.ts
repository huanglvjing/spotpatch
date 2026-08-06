import { describe, expect, it } from "vitest";

import { extractCodeContext } from "./extract-code-context.js";

function positionOf(
  source: string,
  search: string,
): Readonly<{ line: number; column: number }> {
  const offset = source.indexOf(search);

  if (offset < 0) {
    throw new Error(`Test source does not contain ${search}.`);
  }

  const prefix = source.slice(0, offset);
  const lines = prefix.split("\n");
  return Object.freeze({
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  });
}

function extract(
  source: string,
  search = "<div",
  maxLines = 80,
  maxCharacters = 7_000,
) {
  const position = positionOf(source, search);
  return extractCodeContext({
    source,
    sourcePath: "/project/src/Fixture.tsx",
    relativePath: "src/Fixture.tsx",
    language: "tsx",
    line: position.line,
    column: position.column,
    maxLines,
    maxCharacters,
  });
}

describe("source code context extraction", () => {
  it.each([
    [
      "function declaration",
      "export default function UserProfile() {\n  return <div>User</div>;\n}",
      "export default function UserProfile",
    ],
    [
      "arrow component",
      "export const UserProfile = () => {\n  return <div>User</div>;\n};",
      "export const UserProfile",
    ],
    [
      "named function expression",
      "const UserProfile = function UserProfile() {\n  return <div>User</div>;\n};",
      "const UserProfile",
    ],
    [
      "class component",
      "class UserProfile extends React.Component {\n  render() { return <div>User</div>; }\n}",
      "class UserProfile",
    ],
    [
      "memo component",
      "export const UserProfile = memo(() => {\n  return <div>User</div>;\n});",
      "export const UserProfile",
    ],
    [
      "forwardRef component",
      "export const UserProfile = forwardRef(function UserProfile(props, ref) {\n  return <div ref={ref}>User</div>;\n});",
      "export const UserProfile",
    ],
  ])("returns the complete %s boundary", (_label, source, expectedStart) => {
    const context = extract(source);

    expect(context.boundary).toBe("component");
    expect(context.excerpt).toContain(expectedStart);
    expect(context.startLine).toBe(1);
    expect(context.endLine).toBe(source.split("\n").length);
  });

  it("chooses the smallest component containing the selected JSX", () => {
    const source = `
function App() {
  function UserProfile() {
    return <div>User</div>;
  }
  return <UserProfile />;
}`.trim();

    const context = extract(source);

    expect(context.boundary).toBe("component");
    expect(context.excerpt).toContain("function UserProfile");
    expect(context.excerpt).not.toContain("function App");
    expect(context.startLine).toBe(2);
  });

  it.each([
    "const result = items.map(() => <div>Item</div>);",
    "const UserProfile = withUnknown(() => <div>User</div>);",
    "const registry = { UserProfile: () => <div>User</div> };",
  ])("falls back for an unsupported component shape", (source) => {
    expect(extract(source).boundary).toBe("nearby-lines");
  });

  it("falls back when a component exceeds line or character budgets", () => {
    const source = [
      "export function LargeComponent() {",
      ...Array.from(
        { length: 10 },
        (_, index) => `  const value${String(index)} = ${String(index)};`,
      ),
      "  return <div>Large</div>;",
      "}",
    ].join("\n");
    const lineLimited = extract(source, "<div", 5, 7_000);
    const characterLimited = extract(source, "<div", 80, 30);

    expect(lineLimited.boundary).toBe("nearby-lines");
    expect(lineLimited.excerpt.split("\n").length).toBeLessThanOrEqual(5);
    expect(characterLimited.boundary).toBe("nearby-lines");
    expect(characterLimited.excerpt.length).toBeLessThanOrEqual(30);
    expect(characterLimited.startLine).toBe(characterLimited.endLine);
  });

  it("returns nearby lines on parser failure without exposing the full file", () => {
    const source = "const broken = ;\nconst view = <div>Target</div>;\nconst tail = 1;";
    const context = extract(source, "<div", 2, 100);

    expect(context.boundary).toBe("nearby-lines");
    expect(context.startLine).toBe(1);
    expect(context.endLine).toBe(2);
    expect(context.excerpt).not.toContain("const tail");
  });
});
