// @vitest-environment jsdom

import {
  DEFAULT_RUNTIME_DATA_FLOW_LIMITS,
  SPOTPATCH_API_BASE,
  type ContextBudget,
} from "@spotpatch/shared";
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
  ai: Object.freeze({ enabled: false }),
  budget,
  debug: false,
  dataFlow: Object.freeze({
    enabled: false,
    runtime: "dispatch",
    limits: DEFAULT_RUNTIME_DATA_FLOW_LIMITS,
  }),
  editor: "auto",
  framework: "vite",
  frameworkVersion: "7.3.6",
  locale: "en-US",
  maxTargets: 8,
  redact: true,
  sessionId: "runtime-session-id-0000",
  sessionToken: "session-token",
  shortcut: "Mod+Shift+S",
  spotPatchVersion: "0.0.0",
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
