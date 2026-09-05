import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

import {
  createSession,
  createSourceRegistry,
  resolveCredentialEnvironment,
  resolveEnvironmentAiConfiguration,
  resolveProjectOptions,
  type ResolvedSpotPatchOptions,
} from "@spotpatch/dev-server";
import type { AstroIntegration } from "astro";
import { loadEnv } from "vite";

import { type AstroSpotPatchOptions } from "./options.js";
import { resolveAstroValidationChecks } from "./project-validation.js";
import { ASTRO_CLIENT_MODULE_ID, createAstroRuntimePlugin } from "./runtime-plugin.js";
import { createAstroTransform } from "./transform.js";
import { createAstroServerPlugin } from "./server-plugin.js";

export function spotPatch(userOptions: AstroSpotPatchOptions = {}): AstroIntegration {
  return {
    name: "@spotpatch/astro",
    hooks: {
      "astro:config:setup": async ({ command, config, updateConfig, injectScript }) => {
        if (command !== "dev" || userOptions.enabled === false) return;
        const root = fileURLToPath(config.root);
        const requireFromHost = createRequire(path.join(root, "package.json"));
        const astroMetadata: unknown = JSON.parse(
          await readFile(requireFromHost.resolve("astro/package.json"), "utf8"),
        );
        if (
          typeof astroMetadata !== "object" ||
          astroMetadata === null ||
          !("version" in astroMetadata) ||
          typeof astroMetadata.version !== "string"
        ) {
          throw new TypeError("Astro package version is unavailable.");
        }
        let resolvedOptions: ResolvedSpotPatchOptions | undefined;
        let credentials: ReturnType<typeof resolveCredentialEnvironment> = {};
        const options = (): ResolvedSpotPatchOptions => {
          if (resolvedOptions === undefined)
            throw new Error("SpotPatch Astro configuration is not ready.");
          return resolvedOptions;
        };
        const registry = createSourceRegistry();
        const session = createSession();
        updateConfig({
          vite: {
            plugins: [
              createAstroTransform({ root, options, registry }),
              createAstroRuntimePlugin({
                options,
                session,
                root,
                astroVersion: astroMetadata.version,
              }),
              {
                name: "spotpatch:astro:configuration",
                apply: "serve",
                async configResolved(viteConfig) {
                  // Astro overrides Vite mode from its CLI. Read the final value,
                  // not the provisional Astro config, before resolving credentials.
                  const environment =
                    viteConfig.envDir === false
                      ? process.env
                      : loadEnv(viteConfig.mode, viteConfig.envDir, "");
                  resolvedOptions = await resolveProjectOptions({
                    appRoot: root,
                    resolveValidationChecks: resolveAstroValidationChecks,
                    environmentAi:
                      userOptions.ai === undefined
                        ? resolveEnvironmentAiConfiguration(environment).ai
                        : false,
                    options: {
                      ...userOptions,
                      include: userOptions.include ?? ["**/*.{astro,js,jsx,ts,tsx}"],
                    },
                  });
                  credentials = resolveCredentialEnvironment(
                    resolvedOptions,
                    environment,
                  );
                },
              },
              createAstroServerPlugin(() => ({
                root,
                options: options(),
                registry,
                session,
                environment: credentials,
              })),
            ],
          },
        });
        injectScript("page", `import ${JSON.stringify(ASTRO_CLIENT_MODULE_ID)};`);
      },
    },
  };
}
