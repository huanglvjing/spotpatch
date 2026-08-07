import type {
  ContextBudget,
  RuntimeAiConfig,
  SPOTPATCH_API_BASE,
} from "@spotpatch/shared";

export interface RuntimeConfig {
  readonly apiBase: typeof SPOTPATCH_API_BASE;
  readonly ai: RuntimeAiConfig;
  readonly budget: Readonly<ContextBudget>;
  readonly debug: boolean;
  readonly redact: boolean;
  readonly sessionToken: string;
  readonly shortcut: string;
  readonly spotPatchVersion: string;
  readonly viteVersion: string;
}
