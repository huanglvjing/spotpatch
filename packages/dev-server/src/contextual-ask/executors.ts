import type { ContextualAskExecutor } from "@spotpatch/agent";
import type { ContextualAskExecutorPreference } from "@spotpatch/shared";

export interface ComposeContextualAskExecutorsOptions {
  readonly configuredKey: readonly ContextualAskExecutor[];
  readonly managedCodex: ContextualAskExecutor;
  readonly defaultExecutor?: ContextualAskExecutorPreference;
}

/** Orders independent executor implementations without coupling dev-server to Codex. */
export function composeContextualAskExecutors(
  options: ComposeContextualAskExecutorsOptions,
): readonly ContextualAskExecutor[] {
  return Object.freeze(
    options.defaultExecutor?.kind === "managed-codex"
      ? [options.managedCodex, ...options.configuredKey]
      : [...options.configuredKey, options.managedCodex],
  );
}
