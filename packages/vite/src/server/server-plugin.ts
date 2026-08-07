import path from "node:path";

import type { Plugin, ResolvedConfig } from "vite";

import { createAgentJobManager, type AgentJobManager } from "../agent/job-manager.js";
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
  let agentManager: AgentJobManager | undefined;
  let config: ResolvedConfig | undefined;

  const closeResources = async (): Promise<void> => {
    input.registry.clear();
    await agentManager?.close();
    agentManager = undefined;
  };

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

      const root = path.resolve(config.root);
      agentManager =
        input.options.ai === false
          ? undefined
          : createAgentJobManager({ ai: input.options.ai, root });

      server.middlewares.use(
        createSpotPatchMiddleware({
          ...(agentManager === undefined ? {} : { agentManager }),
          options: input.options,
          registry: input.registry,
          root,
          session: input.session,
          logger: config.logger,
        }),
      );

      server.httpServer?.once("close", () => {
        void closeResources();
      });

      config.logger.info(
        `[spotpatch:vite] Ready. Toggle picker with ${input.options.shortcut}.`,
      );
    },

    async closeBundle() {
      await closeResources();
    },
  };
}
