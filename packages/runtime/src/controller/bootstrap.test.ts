// @vitest-environment jsdom

import { SPOTPATCH_API_BASE, type ContextBudget } from "@spotpatch/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { bootstrapSpotPatch, RUNTIME_INSTANCE_KEY } from "./bootstrap.js";
import type { SpotPatchController } from "./runtime-controller.js";
import type { RuntimeConfig } from "./runtime-config.js";

const budget = Object.freeze({
  totalCharacters: 100,
  domCharacters: 20,
  cssCharacters: 20,
  codeCharacters: 40,
  maxCodeLines: 10,
  maxComponentDepth: 3,
}) satisfies ContextBudget;

const config = Object.freeze({
  apiBase: SPOTPATCH_API_BASE,
  budget,
  debug: false,
  redact: true,
  sessionToken: "session-token",
  shortcut: "Mod+Shift+S",
}) satisfies RuntimeConfig;

type RuntimeGlobal = typeof globalThis & {
  [RUNTIME_INSTANCE_KEY]?: SpotPatchController;
};

afterEach(() => {
  const target = globalThis as RuntimeGlobal;
  target[RUNTIME_INSTANCE_KEY]?.dispose();
  Reflect.deleteProperty(target, RUNTIME_INSTANCE_KEY);
  document.querySelectorAll("spotpatch-root").forEach((host) => {
    host.remove();
  });
  vi.restoreAllMocks();
});

describe("bootstrapSpotPatch", () => {
  it("disposes the previous controller before mounting an HMR replacement", () => {
    Object.defineProperty(window, "fetch", {
      configurable: true,
      value: vi.fn<typeof fetch>(),
    });

    bootstrapSpotPatch(config);
    const firstHost = document.querySelector("spotpatch-root");
    bootstrapSpotPatch(config);
    const secondHost = document.querySelector("spotpatch-root");

    expect(firstHost?.isConnected).toBe(false);
    expect(secondHost?.isConnected).toBe(true);
    expect(secondHost).not.toBe(firstHost);
    expect(document.querySelectorAll("spotpatch-root")).toHaveLength(1);
  });
});
