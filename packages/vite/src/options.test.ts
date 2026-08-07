import { describe, expect, it } from "vitest";

import type { AiOptions } from "@spotpatch/shared";

import { createRuntimeAiConfig, DEFAULT_OPTIONS, resolveOptions } from "./options.js";

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

  it("resolves and deeply freezes provider, model, check, and limit data", () => {
    const resolved = resolveOptions({ ai: aiOptions });

    expect(resolved.ai).not.toBe(false);

    if (resolved.ai === false) {
      throw new Error("Expected resolved AI configuration.");
    }

    expect(resolved.ai.providers.relay).toMatchObject({
      id: "relay",
      label: "Team relay",
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
