import { describe, expect, it } from "vitest";

import { isThirdPartySource, toSafeRelativeSourcePath } from "./safe-source-path.js";

describe("safe React source paths", () => {
  it.each([
    ["/Users/person/project/src/App.tsx", "src/App.tsx"],
    ["C:\\work\\project\\src\\Button.tsx", "src/Button.tsx"],
    ["http://localhost:5173/src/Page.tsx?t=123", "src/Page.tsx"],
    ["src/components/Card.tsx", "src/components/Card.tsx"],
  ])("reduces %s to a project-relative src path", (input, expected) => {
    expect(toSafeRelativeSourcePath(input)).toBe(expected);
  });

  it.each([
    "/project/node_modules/antd/Button.js",
    "node_modules/react/index.js",
    "C:\\project\\node_modules\\antd\\index.js",
  ])("identifies a third-party source: %s", (input) => {
    expect(isThirdPartySource(input)).toBe(true);
    expect(toSafeRelativeSourcePath(input)).toBeUndefined();
  });

  it.each([
    "/Users/person/private/Secret.tsx",
    "../outside/src/../Secret.tsx",
    "webpack://vendor.js",
    "",
  ])("does not expose an unsafe or unrecognized path: %s", (input) => {
    expect(toSafeRelativeSourcePath(input)).toBeUndefined();
  });
});
