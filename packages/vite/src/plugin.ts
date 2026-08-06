import type { Plugin } from "vite";

import { resolveOptions, type SpotPatchOptions } from "./options.js";
import { createSourceRegistry } from "./registry/source-registry.js";
import { createRuntimeInjectionPlugin } from "./runtime/runtime-injection-plugin.js";
import { createServerPlugin } from "./server/server-plugin.js";
import { createSession } from "./session/session.js";
import { createTransformPlugin } from "./transform/transform-plugin.js";

export function spotPatch(userOptions: SpotPatchOptions = {}): Plugin[] {
  const options = resolveOptions(userOptions);

  if (!options.enabled) {
    return [];
  }

  const registry = createSourceRegistry();
  const session = createSession();

  return [
    createTransformPlugin({ options, registry }),
    createRuntimeInjectionPlugin({ options, session }),
    createServerPlugin({ options, registry, session }),
  ];
}
