import type { ContextualAskExecutor } from "@spotpatch/agent";
import type { ExternalHandoffFramework } from "@spotpatch/shared";

import { createAgentJobManager } from "./agent/job-manager.js";
import { createWorkspaceActivityCoordinator } from "./workspace/activity-coordinator.js";
import { createConfiguredKeyAskExecutors } from "./contextual-ask/configured-key-executors.js";
import { composeContextualAskExecutors } from "./contextual-ask/executors.js";
import {
  createContextualAskManager,
  type CreateContextualAskManagerOptions,
} from "./contextual-ask/manager.js";
import type { ExternalAgentControlPort } from "./external-agent/control-port.js";
import { createExternalHandoffService } from "./external-handoff/service.js";
import {
  resolveManagedExecutionValidation,
  type ResolvedManagedExecutionValidation,
} from "./project-validation.js";
import {
  createSpotPatchMiddleware,
  type CreateMiddlewareOptions,
  type SpotPatchMiddleware,
} from "./server/middleware.js";

export interface DevelopmentSessionInput extends Omit<
  CreateMiddlewareOptions,
  | "agentManager"
  | "contextualAskManager"
  | "externalAgentControl"
  | "externalHandoffService"
> {
  readonly framework: ExternalHandoffFramework;
  readonly resolveSourceImports?: CreateContextualAskManagerOptions["resolveSourceImports"];
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly executionRoot?: string;
  readonly createManagedAskExecutor: () => ContextualAskExecutor;
  readonly createExternalAgentControl: (
    validation: ResolvedManagedExecutionValidation,
  ) => Promise<ExternalAgentControlPort>;
  readonly resolveValidation?: () => Promise<ResolvedManagedExecutionValidation>;
}

export interface DevelopmentSession {
  readonly middleware: SpotPatchMiddleware;
  readonly close: () => Promise<void>;
}

/** Owns feature services, not HTTP listeners or framework-specific transports. */
export async function createDevelopmentSession(
  input: DevelopmentSessionInput,
): Promise<DevelopmentSession> {
  const cleanups: (() => void | Promise<void>)[] = [
    () => {
      input.registry.clear();
    },
  ];
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> =>
    (closing ??= (async () => {
      const errors: unknown[] = [];
      // Stop consumers before their dependencies, including after partial startup.
      for (const cleanup of cleanups.splice(0).reverse()) {
        try {
          await cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length > 0)
        throw new AggregateError(errors, "SpotPatch service cleanup failed.");
    })());
  const warn = (message: string): void => {
    input.logger?.warn(`[spotpatch:${input.framework}] ${message}`);
  };
  try {
    const { options, root, registry } = input;
    const coordinator = createWorkspaceActivityCoordinator();
    const agentManager =
      options.ai === false
        ? undefined
        : createAgentJobManager({
            ai: options.ai,
            environment: input.environment,
            root: input.executionRoot ?? root,
            coordinator,
          });
    if (agentManager !== undefined) cleanups.push(() => agentManager.close());
    const preference =
      options.contextualAsk.defaultExecutor === undefined
        ? {}
        : { defaultExecutor: options.contextualAsk.defaultExecutor };
    const contextualAskManager = !options.contextualAsk.enabled
      ? undefined
      : createContextualAskManager({
          coordinator,
          enabled: true,
          registry,
          root,
          ...(input.resolveSourceImports === undefined
            ? {}
            : { resolveSourceImports: input.resolveSourceImports }),
          executors: composeContextualAskExecutors({
            configuredKey:
              options.ai === false
                ? []
                : createConfiguredKeyAskExecutors({
                    ai: options.ai,
                    environment: input.environment,
                    ...preference,
                  }),
            managedCodex: input.createManagedAskExecutor(),
            ...preference,
          }),
        });
    if (contextualAskManager !== undefined)
      cleanups.push(() => contextualAskManager.close());
    const externalHandoffService = !options.externalAgent.enabled
      ? undefined
      : createExternalHandoffService({
          framework: input.framework,
          root,
          sessionId: input.session.id,
        });
    let externalAgentControl: ExternalAgentControlPort | undefined;
    if (externalHandoffService !== undefined) {
      cleanups.push(() => externalHandoffService.close());
      try {
        await externalHandoffService.start();
      } catch {
        warn("External Agent handoff is unavailable; core tools remain active.");
      }
      if (externalHandoffService.capability().brokerReady) {
        try {
          const validation = await (input.resolveValidation?.() ??
            resolveManagedExecutionValidation({ ai: options.ai, appRoot: root }));
          const control = await input.createExternalAgentControl(validation);
          externalAgentControl = control;
          cleanups.push(() => control.dispose());
        } catch {
          warn("Managed Agent control is unavailable; Inbox remains active.");
        }
      }
    }
    const middleware = createSpotPatchMiddleware({
      options,
      root,
      registry,
      session: input.session,
      ...(input.projectDataFlowSource === undefined
        ? {}
        : { projectDataFlowSource: input.projectDataFlowSource }),
      ...(input.bootstrap === undefined ? {} : { bootstrap: input.bootstrap }),
      ...(input.logger === undefined ? {} : { logger: input.logger }),
      ...(input.editorLauncher === undefined
        ? {}
        : { editorLauncher: input.editorLauncher }),
      ...(agentManager === undefined ? {} : { agentManager }),
      ...(contextualAskManager === undefined ? {} : { contextualAskManager }),
      ...(externalHandoffService === undefined ? {} : { externalHandoffService }),
      ...(externalAgentControl === undefined ? {} : { externalAgentControl }),
    });
    cleanups.push(() => {
      middleware.dispose();
    });
    return Object.freeze({ middleware, close });
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "SpotPatch service startup and cleanup failed.",
      );
    }
    throw error;
  }
}
