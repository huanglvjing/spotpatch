import type { ResolvedSpotPatchOptions } from "@spotpatch/dev-server";

export interface SpotPatchPluginContext {
  readonly getCredentialEnvironment: () => Readonly<Record<string, string | undefined>>;
  readonly getOptions: () => ResolvedSpotPatchOptions;
}
