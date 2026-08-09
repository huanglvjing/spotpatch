import { bootstrapSpotPatch, type RuntimeConfig } from "@spotpatch/runtime";
import { SPOTPATCH_API_BASE } from "@spotpatch/shared";

type ViteRuntimeConfig = Extract<RuntimeConfig, { readonly framework: "vite" }>;

declare const __SPOTPATCH_RUNTIME_CONFIG__: Omit<ViteRuntimeConfig, "apiBase">;

bootstrapSpotPatch({
  ...__SPOTPATCH_RUNTIME_CONFIG__,
  apiBase: SPOTPATCH_API_BASE,
});
