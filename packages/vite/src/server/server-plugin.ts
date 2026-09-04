import path from "node:path";

import {
  composeContextualAskExecutors,
  createAgentJobManager,
  createConfiguredKeyAskExecutors,
  createContextualAskManager,
  createExternalHandoffService,
  createWorkspaceActivityCoordinator,
  createSpotPatchMiddleware,
  resolveManagedExecutionValidation,
  type AgentJobManager,
  type ContextualAskManager,
  type ExternalHandoffService,
  type SourceRegistry,
  type SpotPatchSession,
  type SpotPatchMiddleware,
} from "@spotpatch/dev-server";
import {
  createManagedCodexAskExecutor,
  createExternalAgentSupervisor,
  type ExternalAgentSupervisor,
} from "@spotpatch/bridge";
import type { Plugin, ResolvedConfig } from "vite";

import type { SpotPatchPluginContext } from "../plugin-context.js";

interface ServerPluginInput {
  readonly context: SpotPatchPluginContext;
  readonly registry: SourceRegistry;
  readonly session: SpotPatchSession;
}

export function createServerPlugin(input: ServerPluginInput): Plugin {
  let agentManager: AgentJobManager | undefined;
  let contextualAskManager: ContextualAskManager | undefined;
  let externalHandoffService: ExternalHandoffService | undefined;
  let externalAgentSupervisor: ExternalAgentSupervisor | undefined;
  let middleware: SpotPatchMiddleware | undefined;
  let config: ResolvedConfig | undefined;

  const closeResources = async (): Promise<void> => {
    middleware?.dispose();
    middleware = undefined;
    await externalAgentSupervisor?.dispose();
    externalAgentSupervisor = undefined;
    await externalHandoffService?.close();
    externalHandoffService = undefined;
    await agentManager?.close();
    agentManager = undefined;
    await contextualAskManager?.close();
    contextualAskManager = undefined;
    input.registry.clear();
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
      const coordinator = createWorkspaceActivityCoordinator();
      agentManager =
        options.ai === false
          ? undefined
          : createAgentJobManager({
              ai: options.ai,
              environment: input.context.getCredentialEnvironment(),
              root,
              coordinator,
            });
      contextualAskManager = options.contextualAsk.enabled
        ? createContextualAskManager({
            coordinator,
            enabled: true,
            executors: composeContextualAskExecutors({
              configuredKey:
                options.ai === false
                  ? []
                  : createConfiguredKeyAskExecutors({
                      ai: options.ai,
                      environment: input.context.getCredentialEnvironment(),
                      ...(options.contextualAsk.defaultExecutor === undefined
                        ? {}
                        : {
                            defaultExecutor: options.contextualAsk.defaultExecutor,
                          }),
                    }),
              managedCodex: createManagedCodexAskExecutor({ projectRoot: root }),
              ...(options.contextualAsk.defaultExecutor === undefined
                ? {}
                : { defaultExecutor: options.contextualAsk.defaultExecutor }),
            }),
            registry: input.registry,
            root,
          })
        : undefined;
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

        if (externalHandoffService.capability().brokerReady) {
          try {
            const validation = await resolveManagedExecutionValidation({
              ai: options.ai,
              appRoot: root,
            });
            externalAgentSupervisor = await createExternalAgentSupervisor({
              bridgeAdapter: "vite",
              checks: validation.checks,
              limits: validation.limits,
              root,
              sessionId: input.session.id,
              projectLabel: path.basename(root),
            });
          } catch {
            config.logger.warn(
              "[spotpatch:vite] Managed Agent control is unavailable; Inbox remains active.",
            );
          }
        }
      }

      middleware = createSpotPatchMiddleware({
        ...(agentManager === undefined ? {} : { agentManager }),
        ...(contextualAskManager === undefined ? {} : { contextualAskManager }),
        ...(externalAgentSupervisor === undefined
          ? {}
          : { externalAgentControl: externalAgentSupervisor }),
        ...(externalHandoffService === undefined ? {} : { externalHandoffService }),
        options,
        registry: input.registry,
        root,
        session: input.session,
        logger: config.logger,
      });
      server.middlewares.use(middleware);

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
