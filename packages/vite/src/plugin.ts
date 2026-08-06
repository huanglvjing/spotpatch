import type { Plugin } from "vite";

import { resolveOptions, type SpotPatchOptions } from "./options.js";
import { createSourceRegistry } from "./registry/source-registry.js";
import { createTransformPlugin } from "./transform/transform-plugin.js";

export function spotPatch(userOptions: SpotPatchOptions = {}): Plugin[] {
  const options = resolveOptions(userOptions);

  if (!options.enabled) {
    return [];
  }

  const registry = createSourceRegistry();

  return [createTransformPlugin({ options, registry })];
}
