import path from "node:path";

import {
  createAgentJobManager,
  createExternalHandoffService,
  createSpotPatchMiddleware,
  type AgentJobManager,
  type ExternalHandoffService,
  type SourceRegistry,
  type SpotPatchSession,
} from "@spotpatch/dev-server";
import type { Plugin, ResolvedConfig } from "vite";

import type { SpotPatchPluginContext } from "../plugin-context.js";

interface ServerPluginInput {
  readonly context: SpotPatchPluginContext;
  readonly registry: SourceRegistry;
  readonly session: SpotPatchSession;
}

export function createServerPlugin(input: ServerPluginInput): Plugin {
  let agentManager: AgentJobManager | undefined;
  let externalHandoffService: ExternalHandoffService | undefined;
  let config: ResolvedConfig | undefined;

  const closeResources = async (): Promise<void> => {
    input.registry.clear();
    await externalHandoffService?.close();
    externalHandoffService = undefined;
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

    async configureServer(server) {
      if (config === undefined) {
        throw new Error("SpotPatch server initialized before Vite config resolution.");
      }

      const root = path.resolve(config.root);
      const options = input.context.getOptions();
      agentManager =
        options.ai === false
          ? undefined
          : createAgentJobManager({
              ai: options.ai,
              environment: input.context.getCredentialEnvironment(),
              root,
            });
      externalHandoffService = options.externalAgent.enabled
        ? createExternalHandoffService({
            framework: "vite",
            root,
            sessionId: input.session.id,
          })
        : undefined;

      if (externalHandoffService !== undefined) {
        try {
          await externalHandoffService.start();
        } catch {
          config.logger.warn(
            "[spotpatch:vite] External Agent handoff is unavailable; core tools remain active.",
          );
        }
      }

      server.middlewares.use(
        createSpotPatchMiddleware({
          ...(agentManager === undefined ? {} : { agentManager }),
          ...(externalHandoffService === undefined ? {} : { externalHandoffService }),
          options,
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
        `[spotpatch:vite] Ready. Toggle picker with ${options.shortcut}.`,
      );
    },

    async closeBundle() {
      await closeResources();
    },
  };
}
