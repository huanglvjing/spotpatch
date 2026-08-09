import path from "node:path";

import { describe, expect, it } from "vitest";

import { createSourceFilter, isInsideRoot } from "./source-filter.js";

describe("source filtering", () => {
  const root = path.resolve("/project");
  const filter = createSourceFilter(root, {
    include: [/(?:^|[/\\])src[/\\].+\.(?:jsx|tsx)$/],
    exclude: [/\.test\.[jt]sx$/],
  });

  it("accepts configured JSX/TSX source inside the authorized root", () => {
    expect(filter.shouldTransform("/project/src/App.tsx", "<main />")).toBe(true);
  });

  it.each([
    ["/project/src/file.ts", "const value = 1;"],
    ["/project/src/file.js", "const view = <div />;"],
    ["/project/src/file.test.tsx", "const view = <div />;"],
    ["/project/node_modules/pkg/index.tsx", "const view = <div />;"],
    ["/outside/src/file.tsx", "const view = <div />;"],
    ["/project/src/no-jsx.tsx", "export const value = 1;"],
  ])("rejects unsupported input %s", (absolutePath, code) => {
    expect(filter.shouldTransform(absolutePath, code)).toBe(false);
  });

  it("supports Windows root checks without relying on the host OS", () => {
    expect(isInsideRoot("C:\\project", "C:\\project\\src\\App.tsx", path.win32)).toBe(
      true,
    );
    expect(isInsideRoot("C:\\project", "C:\\other\\App.tsx", path.win32)).toBe(false);
  });
});
