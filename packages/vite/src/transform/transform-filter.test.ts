import path from "node:path";

import { resolveOptions } from "@spotpatch/dev-server";
import { describe, expect, it } from "vitest";

import {
  createTransformFilter,
  isInsideRoot,
  stripViteQuery,
} from "./transform-filter.js";

describe("transform filtering", () => {
  const root = path.resolve("/project");
  const filter = createTransformFilter(root, resolveOptions());

  it("strips a Vite query only for extension and path checks", () => {
    expect(stripViteQuery("/project/src/icon.tsx?import&t=1")).toBe(
      "/project/src/icon.tsx",
    );
    expect(filter.shouldTransform("/project/src/icon.tsx?import&t=1", "<svg />")).toBe(
      true,
    );
  });

  it.each([
    ["/project/src/file.ts", "const value = 1;"],
    ["/project/src/file.js", "const view = <div />;"],
    ["/project/src/file.test.tsx", "const view = <div />;"],
    ["/project/node_modules/pkg/index.tsx", "const view = <div />;"],
    ["/outside/src/file.tsx", "const view = <div />;"],
    ["\0virtual:spotpatch/client", "const view = <div />;"],
    ["/project/src/no-jsx.tsx", "export const value = 1;"],
  ])("skips unsupported input %s", (id, code) => {
    expect(filter.shouldTransform(id, code)).toBe(false);
  });

  it("supports Windows root checks without relying on the host OS", () => {
    expect(isInsideRoot("C:\\project", "C:\\project\\src\\App.tsx", path.win32)).toBe(
      true,
    );
    expect(isInsideRoot("C:\\project", "C:\\other\\App.tsx", path.win32)).toBe(false);
  });
});
