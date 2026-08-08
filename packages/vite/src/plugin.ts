import path from "node:path";

import { loadEnv, type ConfigEnv, type Plugin, type UserConfig } from "vite";

import { resolveEnvironmentAiConfiguration } from "./environment-ai.js";
import { resolveOptions, type SpotPatchOptions } from "./options.js";
import type { SpotPatchPluginContext } from "./plugin-context.js";
import { createSourceRegistry } from "./registry/source-registry.js";
import { createRuntimeInjectionPlugin } from "./runtime/runtime-injection-plugin.js";
import { createServerPlugin } from "./server/server-plugin.js";
import { createSession } from "./session/session.js";
import { createTransformPlugin } from "./transform/transform-plugin.js";

export function spotPatch(userOptions: SpotPatchOptions = {}): Plugin[] {
  let options = resolveOptions(userOptions);
  let credentialEnvironment: Readonly<Record<string, string | undefined>> =
    Object.freeze({});

  if (!options.enabled) {
    return [];
  }

  const registry = createSourceRegistry();
  const session = createSession();
  const context = Object.freeze({
    getCredentialEnvironment: () => credentialEnvironment,
    getOptions: () => options,
  } satisfies SpotPatchPluginContext);
  const configure = (config: UserConfig, environment: ConfigEnv): void => {
    const root = path.resolve(process.cwd(), config.root ?? ".");
    const loadedEnvironment =
      config.envDir === false
        ? process.env
        : loadEnv(environment.mode, path.resolve(root, config.envDir ?? "."), "");
    const environmentAi =
      userOptions.ai === undefined
        ? resolveEnvironmentAiConfiguration(loadedEnvironment).ai
        : false;

    options = resolveOptions(userOptions, environmentAi);

    if (options.ai === false) {
      credentialEnvironment = Object.freeze({});
      return;
    }

    const names = new Set(
      Object.values(options.ai.providers).map((provider) => provider.apiKeyEnv),
    );
    const missing = [...names].filter((name) => {
      const value = loadedEnvironment[name];
      return value === undefined || value.trim().length === 0;
    });

    if (missing.length > 0) {
      throw new RangeError(
        `SpotPatch AI credential environment is missing ${missing.join(", ")}.`,
      );
    }

    credentialEnvironment = Object.freeze(
      Object.fromEntries([...names].map((name) => [name, loadedEnvironment[name]])),
    );
  };

  return [
    createTransformPlugin({ configure, context, registry }),
    createRuntimeInjectionPlugin({ context, session }),
    createServerPlugin({ context, registry, session }),
  ];
}
