import type { ResolvedSpotPatchOptions, SimpleAiOptions } from "./options.js";

const AI_ENVIRONMENT_NAMES = Object.freeze({
  authentication: "SPOTPATCH_AI_AUTHENTICATION",
  baseURL: "SPOTPATCH_AI_BASE_URL",
  credential: "SPOTPATCH_AI_API_KEY",
  model: "SPOTPATCH_AI_MODEL",
  protocol: "SPOTPATCH_AI_PROTOCOL",
} as const);

export interface EnvironmentAiConfiguration {
  readonly ai: false | SimpleAiOptions;
}

export function resolveCredentialEnvironment(
  options: ResolvedSpotPatchOptions,
  environment: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
  if (options.ai === false) {
    return Object.freeze({});
  }

  const names = new Set(
    Object.values(options.ai.providers).map((provider) => provider.apiKeyEnv),
  );
  const missing = [...names].filter((name) => {
    const value = environment[name];
    return value === undefined || value.trim().length === 0;
  });

  if (missing.length > 0) {
    throw new RangeError(
      `SpotPatch AI credential environment is missing ${missing.join(", ")}.`,
    );
  }

  return Object.freeze(
    Object.fromEntries(
      [...names].map((name) => {
        const value = environment[name];

        if (value === undefined) {
          throw new RangeError("SpotPatch AI credential resolution failed.");
        }

        return [name, value];
      }),
    ),
  );
}

function normalizedValue(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  const value = environment[name];

  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  return value.trim();
}

export function resolveEnvironmentAiConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): EnvironmentAiConfiguration {
  const baseURL = normalizedValue(environment, AI_ENVIRONMENT_NAMES.baseURL);
  const model = normalizedValue(environment, AI_ENVIRONMENT_NAMES.model);
  const credential = normalizedValue(environment, AI_ENVIRONMENT_NAMES.credential);
  const protocol = normalizedValue(environment, AI_ENVIRONMENT_NAMES.protocol);
  const authentication = normalizedValue(
    environment,
    AI_ENVIRONMENT_NAMES.authentication,
  );
  const configuredValues = [baseURL, model, credential, protocol, authentication];

  if (configuredValues.every((value) => value === undefined)) {
    return Object.freeze({ ai: false });
  }

  const missing = [
    [AI_ENVIRONMENT_NAMES.baseURL, baseURL],
    [AI_ENVIRONMENT_NAMES.model, model],
    [AI_ENVIRONMENT_NAMES.credential, credential],
  ]
    .filter((entry): entry is [string, undefined] => entry[1] === undefined)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new RangeError(
      `SpotPatch AI environment configuration is incomplete; missing ${missing.join(", ")}.`,
    );
  }

  if (baseURL === undefined || model === undefined || credential === undefined) {
    throw new RangeError("SpotPatch AI environment configuration is incomplete.");
  }

  if (
    protocol !== undefined &&
    protocol !== "responses" &&
    protocol !== "chat-completions"
  ) {
    throw new RangeError(
      "SpotPatch SPOTPATCH_AI_PROTOCOL must be responses or chat-completions.",
    );
  }

  if (
    authentication !== undefined &&
    authentication !== "bearer" &&
    authentication !== "x-api-key"
  ) {
    throw new RangeError(
      "SpotPatch SPOTPATCH_AI_AUTHENTICATION must be bearer or x-api-key.",
    );
  }

  return Object.freeze({
    ai: Object.freeze({
      baseURL,
      model,
      ...(protocol === undefined ? {} : { protocol }),
      ...(authentication === undefined ? {} : { authentication }),
    }),
  });
}
