import { describe, expect, it } from "vitest";

import type { AiOptions } from "@spotpatch/shared";

import {
  createRuntimeAiConfig,
  createRuntimeDataFlowConfig,
  DEFAULT_OPTIONS,
  resolveOptions,
} from "./options.js";

const aiOptions = Object.freeze({
  providers: Object.freeze({
    relay: Object.freeze({
      type: "openai-compatible",
      label: "Team relay",
      protocol: "responses",
      baseURL: "https://relay.example.com/v1/",
      apiKeyEnv: "SPOTPATCH_AI_API_KEY",
      models: Object.freeze({
        coding: Object.freeze({
          label: "Coding model",
          model: "provider-model-name",
        }),
      }),
      defaultModel: "coding",
    }),
  }),
  defaultProvider: "relay",
  execution: Object.freeze({
    checks: Object.freeze({
      lint: Object.freeze({
        label: "Lint",
        command: "pnpm",
        args: Object.freeze(["lint"]),
      }),
    }),
  }),
}) satisfies AiOptions;

function relayProvider(source: AiOptions): AiOptions["providers"][string] {
  const provider = source.providers.relay;

  if (provider === undefined) {
    throw new Error("Expected relay fixture provider.");
  }

  return provider;
}

describe("resolveOptions", () => {
  it("rejects a non-boolean trusted fast mode flag", () => {
    expect(() =>
      resolveOptions({ trustedFastMode: "yes" as unknown as boolean }),
    ).toThrow(RangeError);
  });

  it("keeps external Agent handoff opt-in and frozen", () => {
    expect(resolveOptions().externalAgent).toEqual({ enabled: false });
    const enabled = resolveOptions({ externalAgent: true }).externalAgent;
    expect(enabled).toEqual({ enabled: true });
    expect(Object.isFrozen(enabled)).toBe(true);
    expect(() =>
      resolveOptions({ externalAgent: "yes" as unknown as boolean }),
    ).toThrow(RangeError);
  });

  it("keeps Contextual Ask disabled by default and validates its Key default", () => {
    expect(resolveOptions().contextualAsk).toEqual({ enabled: false });
    expect(resolveOptions({ contextualAsk: true }).contextualAsk).toEqual({
      enabled: true,
    });
    expect(
      resolveOptions({
        ai: aiOptions,
        contextualAsk: {
          defaultExecutor: {
            kind: "configured-key",
            providerProfileId: "relay",
            modelProfileId: "coding",
          },
        },
      }).contextualAsk,
    ).toMatchObject({
      enabled: true,
      defaultExecutor: { kind: "configured-key" },
    });
    expect(() =>
      resolveOptions({
        contextualAsk: {
          defaultExecutor: {
            kind: "configured-key",
            providerProfileId: "missing",
            modelProfileId: "missing",
          },
        },
      }),
    ).toThrow(RangeError);
  });

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

  it("resolves only the supported UI locale preferences", () => {
    expect(resolveOptions().locale).toBe("auto");
    expect(resolveOptions({ locale: "en-US" }).locale).toBe("en-US");
    expect(resolveOptions({ locale: "zh-CN" }).locale).toBe("zh-CN");
    expect(() => resolveOptions({ locale: "fr-FR" as "en-US" })).toThrow(RangeError);
  });

  it("defaults to editor auto-detection and accepts only supported editors", () => {
    expect(resolveOptions().editor).toBe("auto");
    expect(resolveOptions({ editor: "vscode" }).editor).toBe("vscode");
    expect(resolveOptions({ editor: "cursor" }).editor).toBe("cursor");
    expect(() => resolveOptions({ editor: "shell-command" as "cursor" })).toThrow(
      RangeError,
    );
  });

  it("resolves a bounded multi-target limit", () => {
    expect(resolveOptions().maxTargets).toBe(8);
    expect(resolveOptions({ maxTargets: 12 }).maxTargets).toBe(12);

    for (const maxTargets of [0, 21, 1.5, Number.NaN]) {
      expect(() => resolveOptions({ maxTargets })).toThrow(RangeError);
    }
  });

  it("keeps data-flow disabled by default and resolves one frozen option", () => {
    expect(resolveOptions().dataFlow).toMatchObject({
      enabled: false,
      runtime: "dispatch",
    });

    const resolved = resolveOptions({
      dataFlow: { runtime: "dispatch" },
    });

    expect(resolved.dataFlow).toMatchObject({
      enabled: true,
      runtime: "dispatch",
    });
    expect(Object.isFrozen(resolved.dataFlow)).toBe(true);
    expect(Object.isFrozen(resolved.dataFlow.limits)).toBe(true);
    const runtime = createRuntimeDataFlowConfig(resolved.dataFlow);
    expect(Object.keys(runtime.limits).sort()).toEqual([
      "observationMaxBytes",
      "observationMaxEntries",
      "observationTtlMs",
      "reportMaxBytes",
    ]);
    expect(Object.isFrozen(runtime.limits)).toBe(true);
  });

  it("rejects invalid data-flow modes at the runtime boundary", () => {
    expect(() =>
      resolveOptions({
        dataFlow: { runtime: "raw-values" as "dispatch" },
      }),
    ).toThrow(RangeError);
  });

  it("resolves and deeply freezes provider, model, check, and limit data", () => {
    const resolved = resolveOptions({ ai: aiOptions });

    expect(resolved.ai).not.toBe(false);

    if (resolved.ai === false) {
      throw new Error("Expected resolved AI configuration.");
    }

    expect(resolved.ai.providers.relay).toMatchObject({
      id: "relay",
      label: "Team relay",
      authentication: "bearer",
      baseURL: "https://relay.example.com/v1",
      apiKeyEnv: "SPOTPATCH_AI_API_KEY",
      defaultModel: "coding",
    });
    expect(resolved.ai.providers.relay?.models.coding).toMatchObject({
      id: "coding",
      model: "provider-model-name",
    });
    expect(resolved.ai.execution.checks.lint).toMatchObject({
      id: "lint",
      required: true,
      timeoutMs: 120_000,
    });
    expect(resolved.ai.execution.limits.maxTurns).toBe(20);
    expect(Object.isFrozen(resolved.ai.providers)).toBe(true);
    expect(Object.isFrozen(resolved.ai.providers.relay?.models)).toBe(true);
    expect(Object.isFrozen(resolved.ai.execution.checks.lint?.args)).toBe(true);
  });

  it("expands a minimal single-provider AI configuration with safe defaults", () => {
    const resolved = resolveOptions({
      ai: {
        baseURL: "https://relay.example.test/v1",
        model: "provider/model",
      },
    });

    if (resolved.ai === false) {
      throw new Error("Expected resolved AI configuration.");
    }

    expect(resolved.ai).toMatchObject({
      defaultProvider: "default",
      providers: {
        default: {
          authentication: "bearer",
          protocol: "chat-completions",
          apiKeyEnv: "SPOTPATCH_AI_API_KEY",
          defaultModel: "default",
          models: {
            default: {
              label: "AI model",
              model: "provider/model",
            },
          },
        },
      },
      execution: {
        isolation: "git-worktree",
        applyMode: "review",
        checks: {},
      },
    });
  });

  it("lets explicit AI disablement override environment discovery", () => {
    expect(
      resolveOptions(
        { ai: false },
        {
          baseURL: "https://relay.example.test/v1",
          model: "provider/model",
        },
      ).ai,
    ).toBe(false);
  });

  it("creates a browser configuration without provider secrets or commands", () => {
    const resolved = resolveOptions({ ai: aiOptions });
    const runtime = createRuntimeAiConfig(resolved.ai);
    const serialized = JSON.stringify(runtime);

    expect(runtime).toMatchObject({
      enabled: true,
      defaultProvider: "relay",
      providers: [
        {
          id: "relay",
          label: "Team relay",
          models: [{ id: "coding", label: "Coding model" }],
        },
      ],
    });
    expect(serialized).not.toContain("relay.example.com");
    expect(serialized).not.toContain("SPOTPATCH_AI_API_KEY");
    expect(serialized).not.toContain("provider-model-name");
    expect(serialized).not.toContain("pnpm");
  });

  it("exposes trusted auto-apply without exposing its checks", () => {
    const resolved = resolveOptions({
      ai: {
        ...aiOptions,
        execution: {
          ...aiOptions.execution,
          applyMode: "trusted-auto",
        },
      },
    });
    const runtime = createRuntimeAiConfig(resolved.ai);

    expect(runtime).toMatchObject({
      enabled: true,
      applyMode: "trusted-auto",
    });
    expect(JSON.stringify(runtime)).not.toContain("pnpm");
  });

  it.each([
    {
      label: "remote HTTP",
      mutate: (source: AiOptions): AiOptions => ({
        ...source,
        providers: {
          ...source.providers,
          relay: {
            ...relayProvider(source),
            baseURL: "http://relay.example.com/v1",
          },
        },
      }),
    },
    {
      label: "credential in Vite env",
      mutate: (source: AiOptions): AiOptions => ({
        ...source,
        providers: {
          ...source.providers,
          relay: { ...relayProvider(source), apiKeyEnv: "VITE_AI_KEY" },
        },
      }),
    },
    {
      label: "unknown default model",
      mutate: (source: AiOptions): AiOptions => ({
        ...source,
        providers: {
          ...source.providers,
          relay: { ...relayProvider(source), defaultModel: "missing" },
        },
      }),
    },
    {
      label: "unknown default provider",
      mutate: (source: AiOptions): AiOptions => ({
        ...source,
        defaultProvider: "missing",
      }),
    },
    {
      label: "auto without required check",
      mutate: (source: AiOptions): AiOptions => ({
        ...source,
        execution: { applyMode: "auto", checks: {} },
      }),
    },
    {
      label: "trusted auto without required check",
      mutate: (source: AiOptions): AiOptions => ({
        ...source,
        execution: { applyMode: "trusted-auto", checks: {} },
      }),
    },
    {
      label: "plaintext key field",
      mutate: (source: AiOptions): AiOptions =>
        ({
          ...source,
          providers: {
            ...source.providers,
            relay: { ...relayProvider(source), apiKey: "must-not-be-accepted" },
          },
        }) as AiOptions,
    },
  ])("rejects unsafe AI configuration: $label", ({ mutate }) => {
    expect(() => resolveOptions({ ai: mutate(aiOptions) })).toThrow(RangeError);
  });
});
