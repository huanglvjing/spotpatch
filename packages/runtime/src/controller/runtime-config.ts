import type {
  ContextBudget,
  RuntimeAiConfig,
  SPOTPATCH_API_BASE,
  SpotPatchLocalePreference,
} from "@spotpatch/shared";

export interface RuntimeConfig {
  readonly apiBase: typeof SPOTPATCH_API_BASE;
  readonly ai: RuntimeAiConfig;
  readonly budget: Readonly<ContextBudget>;
  readonly debug: boolean;
  readonly locale: SpotPatchLocalePreference;
  readonly maxTargets: number;
  readonly redact: boolean;
  readonly sessionToken: string;
  readonly shortcut: string;
  readonly spotPatchVersion: string;
  readonly viteVersion: string;
}
