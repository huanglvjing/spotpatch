import {
  createConfiguredKeyAskExecutor,
  resolveProviderCredential,
  type ContextualAskExecutor,
} from "@spotpatch/agent";
import type {
  ContextualAskExecutorPreference,
  ResolvedAiOptions,
} from "@spotpatch/shared";

export interface CreateConfiguredKeyAskExecutorsOptions {
  readonly ai: ResolvedAiOptions;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly fetch?: typeof globalThis.fetch;
  readonly defaultExecutor?: ContextualAskExecutorPreference;
}

/** Builds one isolated read-only Ask executor per configured Provider/model pair. */
export function createConfiguredKeyAskExecutors(
  options: CreateConfiguredKeyAskExecutorsOptions,
): readonly ContextualAskExecutor[] {
  const preferred =
    options.defaultExecutor?.kind === "configured-key"
      ? options.defaultExecutor
      : Object.freeze({
          kind: "configured-key" as const,
          providerProfileId: options.ai.defaultProvider,
          modelProfileId:
            options.ai.providers[options.ai.defaultProvider]?.defaultModel ?? "",
        });
  const providers = Object.values(options.ai.providers).sort((left, right) =>
    left.id === preferred.providerProfileId
      ? -1
      : right.id === preferred.providerProfileId
        ? 1
        : 0,
  );
  return Object.freeze(
    providers.flatMap((provider) => {
      const credential = resolveProviderCredential(
        provider.apiKeyEnv,
        options.environment,
      );
      const models = Object.values(provider.models).sort((left, right) =>
        provider.id !== preferred.providerProfileId
          ? 0
          : left.id === preferred.modelProfileId
            ? -1
            : right.id === preferred.modelProfileId
              ? 1
              : 0,
      );
      return models.map((model) =>
        createConfiguredKeyAskExecutor({
          provider,
          model,
          credential,
          limits: options.ai.execution.limits,
          ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        }),
      );
    }),
  );
}
