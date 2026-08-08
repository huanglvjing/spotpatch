import type { ResolvedSpotPatchOptions } from "./options.js";

export interface SpotPatchPluginContext {
  readonly getCredentialEnvironment: () => Readonly<Record<string, string | undefined>>;
  readonly getOptions: () => ResolvedSpotPatchOptions;
}
