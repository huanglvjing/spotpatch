import { describe, expect, it } from "vitest";

import { DEFAULT_OPTIONS, resolveOptions } from "./options.js";

describe("resolveOptions", () => {
  it("merges nested budget values once without mutating defaults", () => {
    const resolved = resolveOptions({ budget: { maxCodeLines: 42 } });

    expect(resolved.budget.maxCodeLines).toBe(42);
    expect(resolved.budget.totalCharacters).toBe(16_000);
    expect(DEFAULT_OPTIONS.budget.maxCodeLines).toBe(80);
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.budget)).toBe(true);
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects an invalid budget value: %s", (value) => {
    expect(() => resolveOptions({ budget: { maxCodeLines: value } })).toThrow(
      RangeError,
    );
  });

  it("rejects an empty shortcut", () => {
    expect(() => resolveOptions({ shortcut: "   " })).toThrow(RangeError);
  });
});
