import { bootstrapSpotPatch, type RuntimeConfig } from "@spotpatch/runtime";
import { SPOTPATCH_API_BASE } from "@spotpatch/shared";

declare const __SPOTPATCH_RUNTIME_CONFIG__: Omit<RuntimeConfig, "apiBase">;

bootstrapSpotPatch({
  ...__SPOTPATCH_RUNTIME_CONFIG__,
  apiBase: SPOTPATCH_API_BASE,
});
