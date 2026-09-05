import path from "node:path";

import {
  createExternalAgentSupervisor,
  createManagedCodexAskExecutor,
} from "@spotpatch/bridge";
import {
  createDevelopmentSession,
  type DevelopmentSession,
  type DevelopmentSessionInput,
} from "@spotpatch/dev-server";
import type { Plugin } from "vite";
import { DEFAULT_AGENT_LIMITS } from "@spotpatch/shared";

import { resolveAstroValidationChecks } from "./project-validation.js";
import { projectAstroSource, astroSourceImports } from "./source-projections.js";

type AstroSessionInput = Omit<
  DevelopmentSessionInput,
  "createManagedAskExecutor" | "createExternalAgentControl" | "framework" | "logger"
>;

export function createAstroServerPlugin(input: () => AstroSessionInput): Plugin {
  let services: DevelopmentSession | undefined;
  return {
    name: "spotpatch:astro:server",
    apply: "serve",
    async configureServer(server) {
      const resolved = input();
      const active = await createDevelopmentSession({
        ...resolved,
        framework: "astro",
        logger: server.config.logger,
        projectDataFlowSource: projectAstroSource,
        resolveSourceImports: astroSourceImports,
        async resolveValidation() {
          const ai = resolved.options.ai;
          const limits = ai === false ? DEFAULT_AGENT_LIMITS : ai.execution.limits;
          const checks = await resolveAstroValidationChecks({
            appRoot: resolved.root,
            checks: ai === false ? {} : ai.execution.checks,
            timeoutMs: limits.checkTimeoutMs,
          });
          return Object.freeze({ checks, limits });
        },
        createManagedAskExecutor: () =>
          createManagedCodexAskExecutor({ projectRoot: resolved.root }),
        createExternalAgentControl: (validation) =>
          createExternalAgentSupervisor({
            bridgeAdapter: "astro",
            ...validation,
            root: resolved.root,
            sessionId: resolved.session.id,
            projectLabel: path.basename(resolved.root),
          }),
      });
      services = active;
      server.middlewares.use(active.middleware);
      server.httpServer?.once("close", () => {
        void active.close().catch(() => {
          server.config.logger.warn("[spotpatch:astro] Service cleanup failed.");
        });
      });
      server.config.logger.info(
        `[spotpatch:astro] Ready. Toggle picker with ${resolved.options.shortcut}.`,
      );
    },
    async closeBundle() {
      await services?.close();
    },
  };
}
