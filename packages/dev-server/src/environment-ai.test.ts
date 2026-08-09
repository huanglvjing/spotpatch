import { describe, expect, it } from "vitest";

import { resolveEnvironmentAiConfiguration } from "./environment-ai.js";
import { resolveOptions } from "./options.js";

const TEST_CREDENTIAL = "synthetic-environment-credential";

describe("environment AI configuration", () => {
  it("keeps AI disabled when no SpotPatch AI variables exist", () => {
    expect(resolveEnvironmentAiConfiguration({})).toEqual({ ai: false });
  });

  it("creates the minimal single-provider configuration from environment values", () => {
    const environment = resolveEnvironmentAiConfiguration({
      SPOTPATCH_AI_API_KEY: TEST_CREDENTIAL,
      SPOTPATCH_AI_BASE_URL: "https://relay.example.test/v1",
      SPOTPATCH_AI_MODEL: "provider/model",
    });
    const resolved = resolveOptions({}, environment.ai);

    expect(resolved.ai).not.toBe(false);

    if (resolved.ai === false) {
      throw new Error("Expected environment AI configuration.");
    }

    expect(resolved.ai.providers.default).toMatchObject({
      authentication: "bearer",
      baseURL: "https://relay.example.test/v1",
      protocol: "chat-completions",
      apiKeyEnv: "SPOTPATCH_AI_API_KEY",
      defaultModel: "default",
    });
    expect(resolved.ai.providers.default?.models.default).toMatchObject({
      label: "AI model",
      model: "provider/model",
    });
    expect(JSON.stringify(resolved)).not.toContain(TEST_CREDENTIAL);
  });

  it("accepts explicit protocol and x-api-key authentication overrides", () => {
    const environment = resolveEnvironmentAiConfiguration({
      SPOTPATCH_AI_API_KEY: TEST_CREDENTIAL,
      SPOTPATCH_AI_AUTHENTICATION: "x-api-key",
      SPOTPATCH_AI_BASE_URL: "https://relay.example.test/v1",
      SPOTPATCH_AI_MODEL: "provider/model",
      SPOTPATCH_AI_PROTOCOL: "responses",
    });
    const resolved = resolveOptions({}, environment.ai);

    if (resolved.ai === false) {
      throw new Error("Expected environment AI configuration.");
    }

    expect(resolved.ai.providers.default).toMatchObject({
      authentication: "x-api-key",
      protocol: "responses",
    });
  });

  it("reports incomplete configuration without disclosing credential values", () => {
    let error: unknown;

    try {
      resolveEnvironmentAiConfiguration({ SPOTPATCH_AI_API_KEY: TEST_CREDENTIAL });
    } catch (caught: unknown) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RangeError);
    expect(String(error)).toContain("SPOTPATCH_AI_BASE_URL");
    expect(String(error)).toContain("SPOTPATCH_AI_MODEL");
    expect(String(error)).not.toContain(TEST_CREDENTIAL);
  });

  it.each([
    ["SPOTPATCH_AI_PROTOCOL", "legacy"],
    ["SPOTPATCH_AI_AUTHENTICATION", "custom-header"],
  ])("rejects an unsupported %s value", (name, value) => {
    expect(() =>
      resolveEnvironmentAiConfiguration({
        SPOTPATCH_AI_API_KEY: TEST_CREDENTIAL,
        SPOTPATCH_AI_BASE_URL: "https://relay.example.test/v1",
        SPOTPATCH_AI_MODEL: "provider/model",
        [name]: value,
      }),
    ).toThrow(RangeError);
  });
});
