import { describe, expect, it } from "vitest";

import { spotPatch } from "./plugin.js";

describe("spotPatch", () => {
  it("returns no plugins when explicitly disabled", () => {
    expect(spotPatch({ enabled: false })).toEqual([]);
  });

  it("registers isolated development-only plugins", () => {
    const plugins = spotPatch();

    expect(plugins.map(({ name }) => name)).toEqual([
      "spotpatch:transform",
      "spotpatch:server",
    ]);
    expect(plugins.every(({ apply }) => apply === "serve")).toBe(true);
    expect(plugins.every(({ enforce }) => enforce === "pre")).toBe(true);
  });
});
