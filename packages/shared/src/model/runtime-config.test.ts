import { describe, expect, it } from "vitest";

import { SPOTPATCH_API_BASE } from "../protocol/endpoints.js";
import { runtimeConfigSchema } from "./runtime-config.js";

const base = Object.freeze({
  apiBase: SPOTPATCH_API_BASE,
  ai: Object.freeze({ enabled: false }),
  budget: Object.freeze({
    totalCharacters: 16_000,
    domCharacters: 3_000,
    cssCharacters: 4_000,
    codeCharacters: 7_000,
    maxCodeLines: 80,
    maxComponentDepth: 8,
  }),
  debug: false,
  editor: "auto",
  frameworkVersion: "16.3.0",
  locale: "auto",
  maxTargets: 8,
  redact: true,
  sessionToken: "0123456789abcdef012345",
  shortcut: "Mod+Shift+S",
  spotPatchVersion: "0.1.0",
} as const);

describe("runtime config schema", () => {
  it("accepts strict Vite and Next framework variants", () => {
    expect(runtimeConfigSchema.safeParse({ ...base, framework: "vite" }).success).toBe(
      true,
    );
    expect(
      runtimeConfigSchema.safeParse({
        ...base,
        bundler: "turbopack",
        framework: "next",
        routerKind: "app",
      }).success,
    ).toBe(true);
  });

  it("rejects missing Next diagnostics, short tokens, and private fields", () => {
    expect(runtimeConfigSchema.safeParse({ ...base, framework: "next" }).success).toBe(
      false,
    );
    expect(
      runtimeConfigSchema.safeParse({
        ...base,
        framework: "vite",
        sessionToken: "short",
      }).success,
    ).toBe(false);
    expect(
      runtimeConfigSchema.safeParse({
        ...base,
        framework: "vite",
        root: "/private/project",
      }).success,
    ).toBe(false);
  });
});
