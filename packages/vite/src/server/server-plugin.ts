import path from "node:path";
import {
  createDevelopmentSession,
  type DevelopmentSession,
  type SourceRegistry,
  type SpotPatchSession,
} from "@spotpatch/dev-server";
import {
  createManagedCodexAskExecutor,
  createExternalAgentSupervisor,
} from "@spotpatch/bridge";
import type { Plugin } from "vite";
import type { SpotPatchPluginContext } from "../plugin-context.js";

interface ServerPluginInput {
  readonly context: SpotPatchPluginContext;
  readonly registry: SourceRegistry;
  readonly session: SpotPatchSession;
}

export function createServerPlugin(input: ServerPluginInput): Plugin {
  let services: DevelopmentSession | undefined;
  return {
    name: "spotpatch:server",
    apply: "serve",
    enforce: "pre",
    async configureServer(server) {
      const root = path.resolve(server.config.root);
      const options = input.context.getOptions();
      const active = await createDevelopmentSession({
        root,
        options,
        registry: input.registry,
        session: input.session,
        framework: "vite",
        environment: input.context.getCredentialEnvironment(),
        logger: server.config.logger,
        createManagedAskExecutor: () =>
          createManagedCodexAskExecutor({ projectRoot: root }),
        createExternalAgentControl: (validation) =>
          createExternalAgentSupervisor({
            bridgeAdapter: "vite",
            ...validation,
            root,
            sessionId: input.session.id,
            projectLabel: path.basename(root),
          }),
      });
      services = active;
      server.middlewares.use(active.middleware);
      server.httpServer?.once("close", () => {
        void active.close().catch(() => {
          server.config.logger.warn("[spotpatch:vite] Service cleanup failed.");
        });
      });
      server.config.logger.info(
        `[spotpatch:vite] Ready. Toggle picker with ${options.shortcut}.`,
      );
    },
    async closeBundle() {
      await services?.close();
    },
  };
}
