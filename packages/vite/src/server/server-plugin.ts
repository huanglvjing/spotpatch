import path from "node:path";

import type { Plugin, ResolvedConfig } from "vite";

import type { ResolvedSpotPatchOptions } from "../options.js";
import type { SourceRegistry } from "../registry/source-registry.js";
import type { SpotPatchSession } from "../session/session.js";
import { createSpotPatchMiddleware } from "./middleware.js";

interface ServerPluginInput {
  readonly options: ResolvedSpotPatchOptions;
  readonly registry: SourceRegistry;
  readonly session: SpotPatchSession;
}

export function createServerPlugin(input: ServerPluginInput): Plugin {
  let config: ResolvedConfig | undefined;

  return {
    name: "spotpatch:server",
    apply: "serve",
    enforce: "pre",

    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },

    configureServer(server) {
      if (config === undefined) {
        throw new Error("SpotPatch server initialized before Vite config resolution.");
      }

      server.middlewares.use(
        createSpotPatchMiddleware({
          options: input.options,
          registry: input.registry,
          root: path.resolve(config.root),
          session: input.session,
          logger: config.logger,
        }),
      );

      server.httpServer?.once("close", () => {
        input.registry.clear();
      });

      config.logger.info(
        `[spotpatch:vite] Ready. Toggle picker with ${input.options.shortcut}.`,
      );
    },
  };
}
