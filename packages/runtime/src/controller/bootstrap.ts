import { createController, type SpotPatchController } from "./runtime-controller.js";
import type { RuntimeConfig } from "./runtime-config.js";

export const RUNTIME_INSTANCE_KEY = "__spotpatchRuntime__" as const;

type GlobalWithSpotPatch = typeof globalThis & {
  [RUNTIME_INSTANCE_KEY]?: SpotPatchController;
};

export function bootstrapSpotPatch(config: RuntimeConfig): SpotPatchController {
  const target = globalThis as GlobalWithSpotPatch;
  target[RUNTIME_INSTANCE_KEY]?.dispose();
  const controller = createController(config);
  target[RUNTIME_INSTANCE_KEY] = controller;
  controller.mount();
  return controller;
}
