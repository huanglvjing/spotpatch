import {
  ERROR_CODES,
  type AgentCapabilitySnapshot,
  type AgentJobEvent,
  type AgentJobResult,
  type AgentJobSnapshot,
  type ErrorCode,
  type RuntimeAiConfig,
  type SpotAnnotation,
} from "@spotpatch/shared";

import {
  RuntimeApiError,
  runtimeApiErrorCode,
  type RuntimeApi,
} from "../api/runtime-api.js";
import type { AgentActivityItem } from "../ui/agent-panel.js";
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

const ERROR_MESSAGES = Object.freeze({
  [ERROR_CODES.INVALID_REQUEST]: "The Agent request was rejected as invalid.",
  [ERROR_CODES.INVALID_TOKEN]: "The local SpotPatch session expired.",
  [ERROR_CODES.ORIGIN_NOT_ALLOWED]: "The current page origin is not authorized.",
  [ERROR_CODES.SOURCE_NOT_FOUND]: "The selected source is no longer available.",
  [ERROR_CODES.SOURCE_OUTSIDE_ROOT]: "The selected source is outside the project.",
  [ERROR_CODES.SOURCE_TOO_LARGE]: "The selected source exceeds the safety limit.",
  [ERROR_CODES.EDITOR_OPEN_FAILED]: "The editor request failed.",
  [ERROR_CODES.AI_DISABLED]: "AI execution is disabled in Vite configuration.",
  [ERROR_CODES.PROVIDER_NOT_CONFIGURED]:
    "The provider Key environment variable is missing on the Vite process.",
  [ERROR_CODES.PROVIDER_AUTH_FAILED]:
    "The provider rejected authentication. Check the server-side Key.",
  [ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED]:
    "The relay does not match the configured OpenAI-compatible protocol.",
  [ERROR_CODES.MODEL_NOT_ALLOWED]: "The selected model profile is not allowed.",
  [ERROR_CODES.MODEL_TOOL_CALL_UNSUPPORTED]:
    "The selected model did not complete the required tool-call probe.",
  [ERROR_CODES.PROVIDER_RATE_LIMITED]:
    "The provider is rate limited. Wait and try again.",
  [ERROR_CODES.AGENT_BUSY]: "Another write Agent job is still active.",
  [ERROR_CODES.AGENT_LIMIT_EXCEEDED]:
    "The Agent stopped at a configured time, turn, output, or size limit.",
  [ERROR_CODES.AGENT_CANCELLED]: "The Agent job was cancelled.",
  [ERROR_CODES.WORKTREE_DIRTY]:
    "Commit or otherwise clean staged, unstaged, and untracked files before running AI.",
  [ERROR_CODES.TOOL_DENIED]: "A model tool request violated the local safety policy.",
  [ERROR_CODES.PATCH_REJECTED]: "The proposed patch did not pass local policy.",
  [ERROR_CODES.VALIDATION_FAILED]:
    "Required project checks failed. The change cannot be applied.",
  [ERROR_CODES.APPLY_CONFLICT]:
    "Project files changed after the Agent baseline; no overwrite was performed.",
  [ERROR_CODES.INTERNAL_ERROR]:
    "The Agent job failed without exposing private details.",
} satisfies Record<ErrorCode, string>);

function errorMessage(error: unknown): string {
  return ERROR_MESSAGES[runtimeApiErrorCode(error) ?? ERROR_CODES.INTERNAL_ERROR];
}

function snapshotErrorMessage(snapshot: AgentJobSnapshot): string | undefined {
  return snapshot.errorCode === undefined
    ? undefined
    : ERROR_MESSAGES[snapshot.errorCode];
}

function capabilityKey(providerProfileId: string, modelProfileId: string): string {
  return `${providerProfileId}:${modelProfileId}`;
}

function activityFromEvent(event: AgentJobEvent): AgentActivityItem | undefined {
  if (event.type === "tool") {
    return Object.freeze({
      key: `tool:${event.data.toolCallId}`,
      label: `${event.data.toolName} · ${event.data.state}`,
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
  const capabilities = new Map<string, AgentCapabilitySnapshot>();
  const providerConsents = new Set<string>();
  const activities = new Map<string, AgentActivityItem>();
  let revision = 0;
  let snapshot: AgentJobSnapshot | undefined;
  let result: AgentJobResult | undefined;
  let appliedDuringCurrentJob = false;
  let actionPending = false;

  const selectedProfiles = () => options.view.readAgentSelection();

  const renderJob = (explicitError?: string): void => {
    if (snapshot === undefined) {
      return;
    }

    options.view.renderAgentJob(
      snapshot,
      result,
      Object.freeze([...activities.values()]),
      explicitError ?? snapshotErrorMessage(snapshot),
    );
  };

  const restoreProviderState = (): void => {
    const selection = selectedProfiles();

    if (selection === undefined) {
      options.view.setAgentProviderConsent(false);
      options.view.renderAgentCapability(
        "error",
        "Provider configuration is unavailable.",
      );
      return;
    }

    options.view.setAgentProviderConsent(
      providerConsents.has(selection.providerProfileId),
    );
    const cached = capabilities.get(
      capabilityKey(selection.providerProfileId, selection.modelProfileId),
    );

    if (cached === undefined) {
      options.view.renderAgentCapability("idle", "Connection not tested");
    } else {
      options.view.renderAgentCapability("ready", "Agent capability verified", cached);
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
      "Testing authentication, tools, continuation, and streaming…",
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
      "Agent capability verified",
      capability,
    );
    options.view.announce("AI provider capability verified.");
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
        renderJob(errorMessage(error));
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
        renderJob(errorMessage(error));
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
          ? "Applying validated changes to the project."
          : action === "cancel"
            ? "Cancelling Agent job."
            : "Reverting the applied Agent change.",
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
      renderJob(errorMessage(error));
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
        providerConsents.add(selection.providerProfileId);
      } else {
        providerConsents.delete(selection.providerProfileId);
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
    },

    reset(): void {
      const mustReselect = appliedDuringCurrentJob;
      resetState();

      if (mustReselect) {
        options.onReselectRequired();
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
          "Complete the problem description and context collection first.",
        );
        return;
      }

      if (!options.view.agentConsentGranted()) {
        options.view.announce(
          "Confirm remote provider data transmission before running AI.",
        );
        return;
      }

      providerConsents.add(selection.providerProfileId);
      const workflowRevision = ++revision;
      options.view.setAgentEditingEnabled(false);

      void probe(workflowRevision)
        .then(async () => {
          if (workflowRevision !== revision) {
            return;
          }

          const created = await options.api.createAgentJob({
            annotation,
            providerProfileId: selection.providerProfileId,
            modelProfileId: selection.modelProfileId,
            providerDataConsent: true,
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
          options.view.renderAgentCapability("error", errorMessage(error));
          options.view.announce(errorMessage(error));
        });
    },

    testCapability(): void {
      if (!options.ai.enabled || snapshot !== undefined) {
        return;
      }

      const workflowRevision = ++revision;
      void probe(workflowRevision).catch((error: unknown) => {
        if (workflowRevision === revision) {
          options.view.renderAgentCapability("error", errorMessage(error));
          options.view.announce(errorMessage(error));
        }
      });
    },
  });
}
