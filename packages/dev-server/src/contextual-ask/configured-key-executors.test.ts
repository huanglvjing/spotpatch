import { CONTEXTUAL_ASK_LIMITS, type AiOptions } from "@spotpatch/shared";
import { describe, expect, it } from "vitest";

import { resolveOptions } from "../options.js";
import { createConfiguredKeyAskExecutors } from "./configured-key-executors.js";

const CREDENTIAL = "factory-secret-never-serialize";

function aiOptions(modelCount = 2): AiOptions {
  return {
    providers: {
      relay: {
        type: "openai-compatible",
        label: "Team relay",
        protocol: "responses",
        baseURL: "https://relay.example.test/v1",
        apiKeyEnv: "SPOTPATCH_FACTORY_KEY",
        models: Object.fromEntries(
          Array.from({ length: modelCount }, (_, index) => [
            `model-${String(index + 1)}`,
            {
              label: `Model ${String(index + 1)}`,
              model: `provider-model-${String(index + 1)}`,
            },
          ]),
        ),
        defaultModel: "model-1",
      },
    },
    defaultProvider: "relay",
  };
}

describe("createConfiguredKeyAskExecutors", () => {
  it("builds one stable opaque executor per configured model without exposing Key data", () => {
    const resolved = resolveOptions({
      ai: aiOptions(),
      contextualAsk: true,
    });
    if (resolved.ai === false) throw new Error("Expected AI configuration.");

    const first = createConfiguredKeyAskExecutors({
      ai: resolved.ai,
      environment: { SPOTPATCH_FACTORY_KEY: CREDENTIAL },
    });
    const second = createConfiguredKeyAskExecutors({
      ai: resolved.ai,
      environment: { SPOTPATCH_FACTORY_KEY: CREDENTIAL },
    });

    expect(first).toHaveLength(2);
    expect(new Set(first.map(({ executorId }) => executorId)).size).toBe(2);
    expect(first.map(({ executorId }) => executorId)).toEqual(
      second.map(({ executorId }) => executorId),
    );
    const preferred = createConfiguredKeyAskExecutors({
      ai: resolved.ai,
      environment: { SPOTPATCH_FACTORY_KEY: CREDENTIAL },
      defaultExecutor: {
        kind: "configured-key",
        providerProfileId: "relay",
        modelProfileId: "model-2",
      },
    });
    expect(preferred[0]?.executorId).toBe(first[1]?.executorId);
    expect(
      first.every(({ executorId }) => /^ask_key_[A-Za-z0-9_-]{24}$/u.test(executorId)),
    ).toBe(true);
    expect(JSON.stringify(first)).not.toContain(CREDENTIAL);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("rejects an enabled Ask configuration that cannot fit its capability schema", () => {
    expect(() =>
      resolveOptions({
        ai: aiOptions(CONTEXTUAL_ASK_LIMITS.maximumExecutors),
        contextualAsk: true,
      }),
    ).toThrow("executor limit");
  });
});
