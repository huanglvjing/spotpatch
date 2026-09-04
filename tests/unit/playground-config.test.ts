import { describe, expect, it } from "vitest";

import { resolvePlaygroundSpotPatchOptions } from "../../playgrounds/minimal-react-18/vite.config.js";

describe("complete playground configuration", () => {
  it("keeps Contextual Ask visible without installing the E2E provider", () => {
    const options = resolvePlaygroundSpotPatchOptions({});

    expect(options).toMatchObject({
      contextualAsk: true,
      dataFlow: {},
      externalAgent: true,
    });
    expect(options.ai).toBeUndefined();
  });

  it("adds the fake provider without controlling the Contextual Ask feature flag", () => {
    const options = resolvePlaygroundSpotPatchOptions({
      SPOTPATCH_E2E_AI_UI: "1",
    });

    expect(options.contextualAsk).toBe(true);
    expect(options.ai).toMatchObject({
      defaultProvider: "relay",
      providers: {
        relay: {
          apiKeyEnv: "SPOTPATCH_E2E_API_KEY",
          baseURL: "https://relay.example.invalid/v1",
          protocol: "responses",
        },
      },
    });
  });
});
