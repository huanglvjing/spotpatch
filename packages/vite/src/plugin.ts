import path from "node:path";

import {
  createSession,
  createSourceRegistry,
  resolveCredentialEnvironment,
  resolveEnvironmentAiConfiguration,
  resolveOptions,
  resolveProjectOptions,
} from "@spotpatch/dev-server";
import { loadEnv, type ConfigEnv, type Plugin, type UserConfig } from "vite";

import type { ViteSpotPatchOptions } from "./options.js";
import type { SpotPatchPluginContext } from "./plugin-context.js";
import { createRuntimeInjectionPlugin } from "./runtime/runtime-injection-plugin.js";
import { createServerPlugin } from "./server/server-plugin.js";
import { createTransformPlugin } from "./transform/transform-plugin.js";

export function spotPatch(userOptions: ViteSpotPatchOptions = {}): Plugin[] {
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
  const configure = async (
    config: UserConfig,
    environment: ConfigEnv,
  ): Promise<void> => {
    const root = path.resolve(process.cwd(), config.root ?? ".");
    const loadedEnvironment =
      config.envDir === false
        ? process.env
        : loadEnv(environment.mode, path.resolve(root, config.envDir ?? "."), "");
    const environmentAi =
      userOptions.ai === undefined
        ? resolveEnvironmentAiConfiguration(loadedEnvironment).ai
        : false;

    options = await resolveProjectOptions({
      appRoot: root,
      environmentAi,
      options: userOptions,
    });

    credentialEnvironment = resolveCredentialEnvironment(options, loadedEnvironment);
  };

  return [
    createTransformPlugin({ configure, context, registry }),
    createRuntimeInjectionPlugin({ context, session }),
    createServerPlugin({ context, registry, session }),
  ];
}
