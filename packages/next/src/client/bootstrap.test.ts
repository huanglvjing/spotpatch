import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_RUNTIME_DATA_FLOW_LIMITS,
  SPOTPATCH_API_BASE,
  type SpotPatchRuntimeConfig,
} from "@spotpatch/shared";

const moduleMocks = vi.hoisted(() => ({
  bootstrapSpotPatch: vi.fn(),
  createExternalHandoffPanel: vi.fn(),
  createExternalHandoffWorkflow: vi.fn(),
  installDataFlowPanelExtension: vi.fn(),
  installContextualAskExtension: vi.fn(),
  installFloatingSurfaceMotionExtension: vi.fn(),
  registerExternalHandoffExtension: vi.fn(),
}));

vi.mock("@spotpatch/runtime", () => ({
  bootstrapSpotPatch: moduleMocks.bootstrapSpotPatch,
}));

vi.mock("@spotpatch/runtime/motion", () => ({
  installFloatingSurfaceMotionExtension:
    moduleMocks.installFloatingSurfaceMotionExtension,
}));

vi.mock("@spotpatch/runtime/data-flow-panel", () => ({
  installDataFlowPanelExtension: moduleMocks.installDataFlowPanelExtension,
}));

vi.mock("@spotpatch/runtime/contextual-ask-panel", () => ({
  installContextualAskExtension: moduleMocks.installContextualAskExtension,
}));

vi.mock("@spotpatch/runtime/external-handoff-panel", () => ({
  createExternalHandoffPanel: moduleMocks.createExternalHandoffPanel,
  createExternalHandoffWorkflow: moduleMocks.createExternalHandoffWorkflow,
  registerExternalHandoffExtension: moduleMocks.registerExternalHandoffExtension,
}));

import { bootstrapNextClient } from "./bootstrap.js";

interface RuntimeFeatureFlags {
  readonly contextualAsk?: boolean;
  readonly dataFlow?: boolean;
  readonly externalAgent?: boolean;
}

function createRuntimeConfig(flags: RuntimeFeatureFlags = {}): SpotPatchRuntimeConfig {
  return {
    apiBase: SPOTPATCH_API_BASE,
    ai: { enabled: false },
    budget: {
      totalCharacters: 16_000,
      domCharacters: 3_000,
      cssCharacters: 4_000,
      codeCharacters: 7_000,
      maxCodeLines: 80,
      maxComponentDepth: 8,
    },
    contextualAsk: { enabled: flags.contextualAsk ?? false },
    dataFlow: {
      enabled: flags.dataFlow ?? false,
      runtime: "dispatch",
      limits: DEFAULT_RUNTIME_DATA_FLOW_LIMITS,
    },
    bundler: "turbopack",
    debug: false,
    editor: "auto",
    externalAgent: { enabled: flags.externalAgent ?? false },
    framework: "next",
    frameworkVersion: "16.3.0",
    locale: "auto",
    maxTargets: 8,
    redact: true,
    routerKind: "app",
    sessionId: "0123456789abcdef012345",
    sessionToken: "0123456789abcdef012345",
    shortcut: "Mod+Shift+S",
    spotPatchVersion: "0.7.0",
  };
}

function bootstrapResponse(config: SpotPatchRuntimeConfig): Response {
  return new Response(JSON.stringify({ ok: true, data: config }), {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });
}

function mockBootstrapRequest(config: SpotPatchRuntimeConfig): void {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockResolvedValue(bootstrapResponse(config)),
  );
}

beforeEach(() => {
  for (const mock of Object.values(moduleMocks)) {
    mock.mockReset();
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Next client bootstrap", () => {
  it("installs the shared Motion extension before mounting the Runtime", async () => {
    const config = createRuntimeConfig();
    mockBootstrapRequest(config);

    await expect(bootstrapNextClient()).resolves.toEqual({ ok: true });

    expect(moduleMocks.installFloatingSurfaceMotionExtension).toHaveBeenCalledOnce();
    expect(moduleMocks.bootstrapSpotPatch).toHaveBeenCalledWith(config);
    const motionCallOrder =
      moduleMocks.installFloatingSurfaceMotionExtension.mock.invocationCallOrder.at(0);
    const mountCallOrder =
      moduleMocks.bootstrapSpotPatch.mock.invocationCallOrder.at(0);

    if (motionCallOrder === undefined || mountCallOrder === undefined) {
      throw new Error("Expected Motion setup and Runtime mount calls.");
    }

    expect(motionCallOrder).toBeLessThan(mountCallOrder);
    expect(moduleMocks.installDataFlowPanelExtension).not.toHaveBeenCalled();
    expect(moduleMocks.installContextualAskExtension).not.toHaveBeenCalled();
    expect(moduleMocks.registerExternalHandoffExtension).not.toHaveBeenCalled();
  });

  it("keeps optional panels feature-driven while sharing the same Motion setup", async () => {
    const config = createRuntimeConfig({
      contextualAsk: true,
      dataFlow: true,
      externalAgent: true,
    });
    mockBootstrapRequest(config);

    await expect(bootstrapNextClient()).resolves.toEqual({ ok: true });

    expect(moduleMocks.installFloatingSurfaceMotionExtension).toHaveBeenCalledOnce();
    expect(moduleMocks.installDataFlowPanelExtension).toHaveBeenCalledOnce();
    expect(moduleMocks.installContextualAskExtension).toHaveBeenCalledOnce();
    expect(moduleMocks.registerExternalHandoffExtension).toHaveBeenCalledWith({
      createPanel: moduleMocks.createExternalHandoffPanel,
      createWorkflow: moduleMocks.createExternalHandoffWorkflow,
    });
    expect(moduleMocks.bootstrapSpotPatch).toHaveBeenCalledWith(config);
  });

  it("does not mount a partial Runtime when Motion setup fails", async () => {
    mockBootstrapRequest(createRuntimeConfig());
    moduleMocks.installFloatingSurfaceMotionExtension.mockImplementation(() => {
      throw new Error("Motion unavailable");
    });

    await expect(bootstrapNextClient()).resolves.toEqual({
      code: "MOUNT_FAILED",
      ok: false,
    });

    expect(moduleMocks.bootstrapSpotPatch).not.toHaveBeenCalled();
  });
});
