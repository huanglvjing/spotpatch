import {
  ERROR_CODES,
  type AgentCapabilitySnapshot,
  type AgentJobEvent,
  type AgentJobResult,
  type AgentJobSnapshot,
  type AgentWorkspaceHealthSnapshot,
  type RuntimeAiConfig,
  type SpotAnnotation,
} from "@spotpatch/shared";

import {
  RuntimeApiError,
  runtimeApiErrorCode,
  type RuntimeApi,
} from "../api/runtime-api.js";
import type { AgentActivityItem } from "../ui/agent-panel.js";
import type { ExecutionActivityKind } from "../ui/execution-island.js";
import type { RuntimeView } from "../ui/runtime-view.js";

export interface AgentWorkflow {
  readonly apply: () => void;
  readonly beginSelection: () => void;
  readonly cancel: () => void;
  readonly consentChanged: () => void;
  readonly disposeSelection: () => void;
  readonly providerOrModelChanged: () => void;
  readonly reset: () => void;
  readonly revert: () => void;
  readonly run: () => void;
  readonly testCapability: () => void;
}

export interface CreateAgentWorkflowOptions {
  readonly ai: RuntimeAiConfig;
  readonly api: RuntimeApi;
  readonly getAnnotation: () => SpotAnnotation | undefined;
  readonly onApplied: () => void;
  readonly onReselectRequired: () => void;
  readonly view: RuntimeView;
}

function capabilityKey(providerProfileId: string, modelProfileId: string): string {
  return `${providerProfileId}:${modelProfileId}`;
}

const TOOL_ACTIVITY_KIND: Readonly<Partial<Record<string, ExecutionActivityKind>>> =
  Object.freeze({
    list_files: "discover",
    search_text: "search",
    read_file: "read",
    replace_text: "patch",
    apply_patch: "patch",
    run_check: "check",
  });

function toolActivityKind(toolName: string): ExecutionActivityKind {
  return TOOL_ACTIVITY_KIND[toolName] ?? "unknown";
}

function activityFromEvent(event: AgentJobEvent): AgentActivityItem | undefined {
  if (event.type === "tool") {
    const detail = event.data.relativePath ?? event.data.checkLabel;
    return Object.freeze({
      key: `tool:${String(event.data.turn)}:${event.data.toolCallId}`,
      kind: toolActivityKind(event.data.toolName),
      ...(detail === undefined ? {} : { detail }),
      label: `${event.data.toolName}${detail === undefined ? "" : ` · ${detail}`} · ${event.data.state}`,
      state:
        event.data.state === "started"
          ? "active"
          : event.data.state === "succeeded"
            ? "success"
            : "failure",
    });
  }

  if (event.type === "check") {
    return Object.freeze({
      key: `check:${event.data.result.checkId}:${String(event.sequence)}`,
      kind: "check",
      detail: event.data.result.label,
      label: `${event.data.result.label} · ${event.data.result.status}`,
      state:
        event.data.result.status === "passed"
          ? "success"
          : event.data.result.status === "failed" ||
              event.data.result.status === "timed-out"
            ? "failure"
            : "info",
    });
  }

  return undefined;
}

export function createAgentWorkflow(
  options: CreateAgentWorkflowOptions,
): AgentWorkflow {
  const errorCode = (error: unknown) =>
    runtimeApiErrorCode(error) ?? ERROR_CODES.INTERNAL_ERROR;
  const errorMessage = (error: unknown): string =>
    options.view.messages().errors[errorCode(error)];
  const capabilities = new Map<string, AgentCapabilitySnapshot>();
  const providerConsents = new Set<string>();
  const activities = new Map<string, AgentActivityItem>();
  let revision = 0;
  let snapshot: AgentJobSnapshot | undefined;
  let result: AgentJobResult | undefined;
  let appliedDuringCurrentJob = false;
  let actionPending = false;

  const selectedProfiles = () => options.view.readAgentSelection();
  const consentKey = (selection: NonNullable<ReturnType<typeof selectedProfiles>>) =>
    `${selection.providerProfileId}:${selection.applyMode}`;

  const refreshWorkspaceHealth = async (
    workflowRevision: number,
  ): Promise<AgentWorkspaceHealthSnapshot> => {
    options.view.renderAgentWorkspaceHealth("checking");

    try {
      const health = await options.api.agentWorkspaceHealth();

      if (workflowRevision !== revision) {
        return health;
      }

      options.view.renderAgentWorkspaceHealth(health.state, health, health.errorCode);
      return health;
    } catch (error: unknown) {
      if (workflowRevision === revision) {
        options.view.renderAgentWorkspaceHealth("blocked", undefined, errorCode(error));
      }

      throw error;
    }
  };

  const renderJob = (explicitErrorCode?: ReturnType<typeof errorCode>): void => {
    if (snapshot === undefined) {
      return;
    }

    options.view.renderAgentJob(
      snapshot,
      result,
      Object.freeze([...activities.values()]),
      explicitErrorCode ?? snapshot.errorCode,
    );
  };

  const restoreProviderState = (): void => {
    const selection = selectedProfiles();

    if (selection === undefined) {
      options.view.setAgentProviderConsent(false);
      options.view.renderAgentCapability(
        "error",
        options.view.messages().agent.providerUnavailable,
      );
      return;
    }

    options.view.setAgentProviderConsent(providerConsents.has(consentKey(selection)));
    const cached = capabilities.get(
      capabilityKey(selection.providerProfileId, selection.modelProfileId),
    );

    if (cached === undefined) {
      options.view.renderAgentCapability(
        "idle",
        options.view.messages().agent.connectionNotTested,
      );
    } else {
      options.view.renderAgentCapability(
        "ready",
        options.view.messages().agent.capabilityVerified,
        cached,
      );
    }
  };

  const probe = async (workflowRevision: number): Promise<AgentCapabilitySnapshot> => {
    const selection = selectedProfiles();

    if (selection === undefined) {
      throw new Error("Agent provider selection is unavailable.");
    }

    const key = capabilityKey(selection.providerProfileId, selection.modelProfileId);
    const cached = capabilities.get(key);

    if (cached !== undefined) {
      return cached;
    }

    options.view.renderAgentCapability(
      "probing",
      options.view.messages().agent.testingCapability,
    );
    const capability = await options.api.agentCapability(selection);

    if (workflowRevision !== revision) {
      return capability;
    }

    if (capability.state !== "agent-ready") {
      throw new RuntimeApiError(
        capability.errorCode ?? ERROR_CODES.MODEL_TOOL_CALL_UNSUPPORTED,
      );
    }

    capabilities.set(key, capability);
    options.view.renderAgentCapability(
      "ready",
      options.view.messages().agent.capabilityVerified,
      capability,
    );
    options.view.announce(options.view.messages().agent.capabilityVerifiedAnnouncement);
    return capability;
  };

  const refreshResult = async (
    jobId: string,
    workflowRevision: number,
  ): Promise<void> => {
    try {
      const response = await options.api.agentResult(jobId);

      if (workflowRevision !== revision || response.snapshot.jobId !== jobId) {
        return;
      }

      snapshot = response.snapshot;
      result = response.result;
      renderJob();
    } catch (error: unknown) {
      if (workflowRevision === revision) {
        renderJob(errorCode(error));
      }
    }
  };

  const observeJob = async (jobId: string, workflowRevision: number): Promise<void> => {
    try {
      await options.api.agentEvents(jobId, (event) => {
        if (workflowRevision !== revision || event.jobId !== jobId) {
          return;
        }

        if (event.type === "snapshot") {
          snapshot = event.data.snapshot;

          if (snapshot.status === "applied" && !appliedDuringCurrentJob) {
            appliedDuringCurrentJob = true;
            options.onApplied();
          }
        }

        const activity = activityFromEvent(event);

        if (activity !== undefined) {
          activities.set(activity.key, activity);
        }

        renderJob();
      });

      if (workflowRevision === revision) {
        await refreshResult(jobId, workflowRevision);
      }
    } catch (error: unknown) {
      if (
        workflowRevision === revision &&
        !(error instanceof DOMException && error.name === "AbortError")
      ) {
        renderJob(errorCode(error));
      }
    }
  };

  const runAction = async (action: "apply" | "cancel" | "revert"): Promise<void> => {
    const current = snapshot;

    if (current === undefined || actionPending) {
      return;
    }

    actionPending = true;
    const workflowRevision = revision;
    snapshot = Object.freeze({
      ...current,
      status:
        action === "apply"
          ? "applying"
          : action === "cancel"
            ? "cancelling"
            : "reverting",
      phaseMessage:
        action === "apply"
          ? options.view.messages().agent.applying
          : action === "cancel"
            ? options.view.messages().agent.cancelling
            : options.view.messages().agent.reverting,
      canCancel: false,
      canApply: false,
      canRevert: false,
    });
    renderJob();

    try {
      const updated =
        action === "apply"
          ? await options.api.applyAgentJob(current.jobId)
          : action === "cancel"
            ? await options.api.cancelAgentJob(current.jobId)
            : await options.api.revertAgentJob(current.jobId);

      if (workflowRevision !== revision) {
        return;
      }

      snapshot = updated;

      if (updated.status === "applied" && !appliedDuringCurrentJob) {
        appliedDuringCurrentJob = true;
        options.onApplied();
      }

      await refreshResult(updated.jobId, workflowRevision);
    } catch (error: unknown) {
      if (workflowRevision !== revision) {
        return;
      }

      snapshot = current;
      await refreshResult(current.jobId, workflowRevision);
      renderJob(errorCode(error));
      options.view.announce(errorMessage(error));
    } finally {
      if (workflowRevision === revision) {
        actionPending = false;
      }
    }
  };

  const resetState = (): void => {
    revision += 1;
    snapshot = undefined;
    result = undefined;
    activities.clear();
    appliedDuringCurrentJob = false;
    actionPending = false;
    options.view.resetAgentJob();
    options.view.setAgentEditingEnabled(true);
    restoreProviderState();
  };

  return Object.freeze({
    apply(): void {
      if (snapshot?.canApply === true) {
        void runAction("apply");
      }
    },

    beginSelection(): void {
      resetState();
      const workflowRevision = revision;

      if (options.ai.enabled) {
        void refreshWorkspaceHealth(workflowRevision).catch(() => undefined);
      }
    },

    cancel(): void {
      if (snapshot?.canCancel === true) {
        void runAction("cancel");
      }
    },

    consentChanged(): void {
      const selection = selectedProfiles();

      if (selection === undefined) {
        return;
      }

      if (options.view.agentConsentGranted()) {
        providerConsents.add(consentKey(selection));
      } else {
        providerConsents.delete(consentKey(selection));
      }
    },

    disposeSelection(): void {
      const cancellableJobId =
        snapshot?.canCancel === true || snapshot?.status === "cancelling"
          ? snapshot.jobId
          : undefined;
      revision += 1;
      snapshot = undefined;
      result = undefined;
      activities.clear();
      appliedDuringCurrentJob = false;
      actionPending = false;

      if (cancellableJobId !== undefined) {
        void options.api.cancelAgentJob(cancellableJobId).catch(() => undefined);
      }
    },

    providerOrModelChanged(): void {
      revision += 1;
      restoreProviderState();
      const workflowRevision = revision;
      void refreshWorkspaceHealth(workflowRevision).catch(() => undefined);
    },

    reset(): void {
      const mustReselect = appliedDuringCurrentJob;
      resetState();

      if (mustReselect) {
        options.onReselectRequired();
      } else if (options.ai.enabled) {
        const workflowRevision = revision;
        void refreshWorkspaceHealth(workflowRevision).catch(() => undefined);
      }
    },

    revert(): void {
      if (snapshot?.canRevert === true) {
        void runAction("revert");
      }
    },

    run(): void {
      if (!options.ai.enabled || snapshot !== undefined) {
        return;
      }

      const selection = selectedProfiles();
      const annotation = options.getAnnotation();

      if (selection === undefined || annotation === undefined) {
        options.view.announce(
          options.view.messages().announcements.completeInstructions,
        );
        return;
      }

      if (!options.view.agentConsentGranted()) {
        options.view.announce(options.view.messages().agent.consentRequired);
        return;
      }

      providerConsents.add(consentKey(selection));
      const workflowRevision = ++revision;
      options.view.setAgentEditingEnabled(false);

      void refreshWorkspaceHealth(workflowRevision)
        .then(async (health) => {
          if (workflowRevision !== revision) {
            return;
          }

          if (health.state === "blocked") {
            throw new RuntimeApiError(
              health.errorCode ?? ERROR_CODES.WORKTREE_LOCAL_CHANGES_UNSUPPORTED,
            );
          }

          if (
            health.state === "consent-required" &&
            !options.view.agentWorkspaceConsentGranted()
          ) {
            throw new RuntimeApiError(ERROR_CODES.WORKTREE_DIRTY);
          }

          const created = await options.api.createAgentJob({
            annotation,
            applyMode: selection.applyMode,
            providerProfileId: selection.providerProfileId,
            modelProfileId: selection.modelProfileId,
            providerDataConsent: true,
            ...(selection.applyMode === "trusted-auto"
              ? { trustedFastModeConsent: true as const }
              : {}),
            workingTreeMode:
              health.state === "consent-required"
                ? "include-local-changes"
                : "require-clean",
          });

          if (workflowRevision !== revision) {
            return;
          }

          snapshot = created;
          result = undefined;
          activities.clear();
          renderJob();
          void observeJob(created.jobId, workflowRevision);
        })
        .catch((error: unknown) => {
          if (workflowRevision !== revision) {
            return;
          }

          options.view.setAgentEditingEnabled(true);
          options.view.renderAgentCapability(
            "error",
            errorMessage(error),
            undefined,
            errorCode(error),
          );
          options.view.announce(errorMessage(error));
        });
    },

    testCapability(): void {
      if (!options.ai.enabled || snapshot !== undefined) {
        return;
      }

      const workflowRevision = ++revision;
      void Promise.all([
        probe(workflowRevision),
        refreshWorkspaceHealth(workflowRevision),
      ]).catch((error: unknown) => {
        if (workflowRevision === revision) {
          options.view.renderAgentCapability(
            "error",
            errorMessage(error),
            undefined,
            errorCode(error),
          );
          options.view.announce(errorMessage(error));
        }
      });
    },
  });
}
