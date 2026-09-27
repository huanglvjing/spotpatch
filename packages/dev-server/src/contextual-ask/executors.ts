import type { ContextualAskExecutor } from "@spotpatch/agent";
import type { ContextualAskExecutorPreference } from "@spotpatch/shared";

/** Executors that drive a locally installed Agent CLI instead of an API key. */
export interface ManagedAskExecutors {
  readonly codex: ContextualAskExecutor;
  readonly claudeCode: ContextualAskExecutor;
}

export interface ComposeContextualAskExecutorsOptions {
  readonly configuredKey: readonly ContextualAskExecutor[];
  readonly managed: ManagedAskExecutors;
  readonly defaultExecutor?: ContextualAskExecutorPreference;
}

/**
 * Orders independent executor implementations without coupling dev-server to
 * any Agent. The preferred kind comes first; otherwise configured keys lead.
 */
export function composeContextualAskExecutors(
  options: ComposeContextualAskExecutorsOptions,
): readonly ContextualAskExecutor[] {
  const { codex, claudeCode } = options.managed;
  const preference = options.defaultExecutor?.kind;
  return Object.freeze(
    preference === "managed-codex"
      ? [codex, claudeCode, ...options.configuredKey]
      : preference === "claude-code"
        ? [claudeCode, codex, ...options.configuredKey]
        : [...options.configuredKey, codex, claudeCode],
  );
}
