import { createHash, randomBytes } from "node:crypto";

import {
  applyPreparedAgentChange,
  executeAgentChange,
  inspectAgentWorkspace,
  probeProviderCapability,
  resolveProviderCredential,
  revertPreparedAgentChange,
  type ExecuteAgentChangeOptions,
  type PreparedAgentChange,
  type ProviderCredential,
} from "@spotpatch/agent";
import {
  ERROR_CODES,
  SpotPatchError,
  type AgentCapabilityRequest,
  type AgentCapabilitySnapshot,
  type AgentJobCreateRequest,
  type AgentJobEvent,
  type AgentJobResult,
  type AgentJobResultResponse,
  type AgentJobSnapshot,
  type AgentJobStatus,
  type AgentApplyMode,
  type AgentWorkspaceHealthSnapshot,
  type AgentWorkingTreeMode,
  type ErrorCode,
  type ResolvedAiModelProfile,
  type ResolvedAiOptions,
  type ResolvedOpenAICompatibleProviderOptions,
  type SpotAnnotation,
} from "@spotpatch/shared";

const MAX_RETAINED_JOBS = 32;
const MAX_RETAINED_EVENTS = 512;
const JOB_ID_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;

const ACTIVE_JOB_STATUSES = new Set<AgentJobStatus>([
  "queued",
  "preparing",
  "running",
  "validating",
  "awaiting-review",
  "applying",
  "cancelling",
  "reverting",
]);

const CANCELLABLE_JOB_STATUSES = new Set<AgentJobStatus>([
  "queued",
  "preparing",
  "running",
  "validating",
  "awaiting-review",
]);

const PRUNABLE_JOB_STATUSES = new Set<AgentJobStatus>([
  "completed",
  "cancelled",
  "reverted",
  "failed",
]);

export type AgentJobEventListener = (event: AgentJobEvent) => void;

interface AgentSelection {
  readonly credential: ProviderCredential;
  readonly model: ResolvedAiModelProfile;
  readonly provider: ResolvedOpenAICompatibleProviderOptions;
}

interface InternalAgentJob {
  readonly annotation: SpotAnnotation;
  readonly applyMode: AgentApplyMode;
  readonly controller: AbortController;
  readonly createdAt: string;
  readonly credential: ProviderCredential;
  readonly events: AgentJobEvent[];
  readonly id: string;
  readonly listeners: Set<AgentJobEventListener>;
  readonly model: ResolvedAiModelProfile;
  readonly provider: ResolvedOpenAICompatibleProviderOptions;
  readonly trustedFastModeConsent: boolean;
  readonly workingTreeMode: AgentWorkingTreeMode;
  errorCode: ErrorCode | undefined;
  phaseMessage: string;
  preparedChange: PreparedAgentChange | undefined;
  result: AgentJobResult | undefined;
  runPromise: Promise<void> | undefined;
  sequence: number;
  status: AgentJobStatus;
  updatedAt: string;
}

export interface AgentJobManager {
  apply(jobId: string): Promise<AgentJobSnapshot>;
  cancel(jobId: string): AgentJobSnapshot;
  close(): Promise<void>;
  create(request: AgentJobCreateRequest): AgentJobSnapshot;
  events(jobId: string): readonly AgentJobEvent[];
  probe(
    request: AgentCapabilityRequest,
    signal: AbortSignal,
  ): Promise<AgentCapabilitySnapshot>;
  result(jobId: string): AgentJobResultResponse;
  revert(jobId: string): Promise<AgentJobSnapshot>;
  subscribe(jobId: string, listener: AgentJobEventListener): () => void;
  workspaceHealth(signal: AbortSignal): Promise<AgentWorkspaceHealthSnapshot>;
}

interface AgentJobManagerDependencies {
  readonly applyChange: typeof applyPreparedAgentChange;
  readonly createJobId: () => string;
  readonly executeChange: typeof executeAgentChange;
  readonly inspectWorkspace: typeof inspectAgentWorkspace;
  readonly now: () => string;
  readonly probeCapability: typeof probeProviderCapability;
  readonly resolveCredential: typeof resolveProviderCredential;
  readonly revertChange: typeof revertPreparedAgentChange;
}

export interface CreateAgentJobManagerOptions {
  readonly ai: ResolvedAiOptions;
  readonly dependencies?: Partial<AgentJobManagerDependencies>;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: typeof globalThis.fetch;
  readonly root: string;
}

const DEFAULT_DEPENDENCIES: AgentJobManagerDependencies = Object.freeze({
  applyChange: applyPreparedAgentChange,
  createJobId: () => randomBytes(16).toString("base64url"),
  executeChange: executeAgentChange,
  inspectWorkspace: inspectAgentWorkspace,
  now: () => new Date().toISOString(),
  probeCapability: probeProviderCapability,
  resolveCredential: resolveProviderCredential,
  revertChange: revertPreparedAgentChange,
});

function normalizeError(error: unknown): SpotPatchError {
  return error instanceof SpotPatchError
    ? error
    : new SpotPatchError(ERROR_CODES.INTERNAL_ERROR, undefined, { cause: error });
}

function isActive(status: AgentJobStatus): boolean {
  return ACTIVE_JOB_STATUSES.has(status);
}

function snapshot(job: InternalAgentJob): AgentJobSnapshot {
  const base = {
    jobId: job.id,
    status: job.status,
    providerProfileId: job.provider.id,
    providerLabel: job.provider.label,
    modelProfileId: job.model.id,
    modelLabel: job.model.label,
    phaseMessage: job.phaseMessage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    canCancel: CANCELLABLE_JOB_STATUSES.has(job.status),
    canApply:
      job.status === "awaiting-review" &&
      job.preparedChange?.validationPassed === true &&
      job.result !== undefined &&
      job.result.diff.length > 0,
    canRevert: job.status === "applied",
  } as const;

  return Object.freeze(
    job.errorCode === undefined ? base : { ...base, errorCode: job.errorCode },
  );
}

function capabilityCacheKey(
  provider: ResolvedOpenAICompatibleProviderOptions,
  model: ResolvedAiModelProfile,
): string {
  const configurationDigest = createHash("sha256")
    .update(provider.baseURL)
    .update("\0")
    .update(provider.protocol)
    .update("\0")
    .update(provider.authentication)
    .digest("hex");

  return `${provider.id}:${model.id}:${configurationDigest}`;
}

function freezeEvent<T extends AgentJobEvent>(event: T): T {
  return Object.freeze(event);
}

export function createAgentJobManager(
  options: CreateAgentJobManagerOptions,
): AgentJobManager {
  const dependencies = Object.freeze({
    ...DEFAULT_DEPENDENCIES,
    ...options.dependencies,
  });
  const jobs = new Map<string, InternalAgentJob>();
  const capabilityCache = new Map<string, AgentCapabilitySnapshot>();
  let closed = false;

  const resolveSelection = (
    providerProfileId: string,
    modelProfileId: string,
  ): AgentSelection => {
    const provider = options.ai.providers[providerProfileId];

    if (provider === undefined) {
      throw new SpotPatchError(ERROR_CODES.PROVIDER_NOT_CONFIGURED);
    }

    const model = provider.models[modelProfileId];

    if (model === undefined) {
      throw new SpotPatchError(ERROR_CODES.MODEL_NOT_ALLOWED);
    }

    const credential = dependencies.resolveCredential(
      provider.apiKeyEnv,
      options.environment,
    );

    return Object.freeze({ credential, model, provider });
  };

  const requireJob = (jobId: string): InternalAgentJob => {
    if (!JOB_ID_PATTERN.test(jobId)) {
      throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
    }

    const job = jobs.get(jobId);

    if (job === undefined) {
      throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
    }

    return job;
  };

  const appendEvent = (job: InternalAgentJob, event: AgentJobEvent): void => {
    job.events.push(event);

    if (job.events.length > MAX_RETAINED_EVENTS) {
      job.events.splice(0, job.events.length - MAX_RETAINED_EVENTS);
    }

    for (const listener of job.listeners) {
      listener(event);
    }
  };

  const eventBase = (job: InternalAgentJob) => {
    job.sequence += 1;
    return {
      schemaVersion: 2 as const,
      sequence: job.sequence,
      jobId: job.id,
      status: job.status,
      timestamp: dependencies.now(),
    };
  };

  const emitSnapshot = (job: InternalAgentJob): void => {
    appendEvent(
      job,
      freezeEvent({
        ...eventBase(job),
        type: "snapshot",
        data: Object.freeze({ snapshot: snapshot(job) }),
      }),
    );
  };

  const emitPhase = (job: InternalAgentJob, message: string): void => {
    appendEvent(
      job,
      freezeEvent({
        ...eventBase(job),
        type: "phase",
        data: Object.freeze({ message }),
      }),
    );
  };

  const emitError = (job: InternalAgentJob, code: ErrorCode): void => {
    appendEvent(
      job,
      freezeEvent({
        ...eventBase(job),
        type: "error",
        data: Object.freeze({ code, message: "The Agent job failed." }),
      }),
    );
  };

  const transition = (
    job: InternalAgentJob,
    status: AgentJobStatus,
    phaseMessage: string,
    errorCode?: ErrorCode,
  ): void => {
    job.status = status;
    job.phaseMessage = phaseMessage;
    job.errorCode = errorCode;
    job.updatedAt = dependencies.now();
    emitSnapshot(job);
    emitPhase(job, phaseMessage);
  };

  const probeResolved = async (
    selection: AgentSelection,
    signal: AbortSignal,
  ): Promise<AgentCapabilitySnapshot> => {
    const key = capabilityCacheKey(selection.provider, selection.model);
    const cached = capabilityCache.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const capability = await dependencies.probeCapability({
      provider: selection.provider,
      modelProfileId: selection.model.id,
      limits: options.ai.execution.limits,
      credential: selection.credential,
      signal,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });

    if (capability.state !== "agent-ready") {
      throw new SpotPatchError(ERROR_CODES.MODEL_TOOL_CALL_UNSUPPORTED);
    }

    capabilityCache.set(key, capability);
    return capability;
  };

  const finishWithError = (job: InternalAgentJob, error: unknown): void => {
    const normalized = normalizeError(error);
    const cancelled =
      job.controller.signal.aborted || normalized.code === ERROR_CODES.AGENT_CANCELLED;

    transition(
      job,
      cancelled ? "cancelled" : "failed",
      cancelled ? "Agent job cancelled." : "Agent job failed.",
      cancelled ? ERROR_CODES.AGENT_CANCELLED : normalized.code,
    );

    if (!cancelled) {
      emitError(job, normalized.code);
    }
  };

  const applyChange = async (
    job: InternalAgentJob,
    preparedChange: PreparedAgentChange,
  ): Promise<void> => {
    transition(job, "applying", "Applying validated changes to the project.");

    try {
      await dependencies.applyChange(preparedChange);
      transition(job, "applied", "Changes were applied to local project files.");
    } catch (error: unknown) {
      const normalized = normalizeError(error);
      transition(job, "failed", "Agent change could not be applied.", normalized.code);
      emitError(job, normalized.code);
      throw normalized;
    }
  };

  const runJob = async (job: InternalAgentJob): Promise<void> => {
    try {
      transition(job, "preparing", "Preparing isolated Agent execution.");

      const callbacks: NonNullable<ExecuteAgentChangeOptions["callbacks"]> = {
        onCheck(result) {
          appendEvent(
            job,
            freezeEvent({
              ...eventBase(job),
              type: "check",
              data: Object.freeze({ result }),
            }),
          );
        },
        onPhase(event) {
          transition(job, event.phase, event.message);
        },
        onTool(event) {
          appendEvent(
            job,
            freezeEvent({
              ...eventBase(job),
              type: "tool",
              data: Object.freeze({ ...event }),
            }),
          );
        },
      };
      const preparedChange = await dependencies.executeChange({
        annotation: job.annotation,
        callbacks,
        credential: job.credential,
        execution: options.ai.execution,
        jobId: job.id,
        model: job.model,
        provider: job.provider,
        root: options.root,
        signal: job.controller.signal,
        workingTreeMode: job.workingTreeMode,
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      });
      job.preparedChange = preparedChange;
      job.result = preparedChange.result;
      appendEvent(
        job,
        freezeEvent({
          ...eventBase(job),
          type: "result-ready",
          data: Object.freeze({ hasResult: true as const }),
        }),
      );

      if (!preparedChange.validationPassed) {
        transition(
          job,
          "failed",
          "Required validation checks failed.",
          ERROR_CODES.VALIDATION_FAILED,
        );
        emitError(job, ERROR_CODES.VALIDATION_FAILED);
        return;
      }

      if (preparedChange.result.diff.length === 0) {
        transition(job, "completed", "No source changes were proposed.");
        return;
      }

      const shouldApplyDirectly =
        (job.applyMode === "auto" && preparedChange.autoApplyEligible) ||
        (job.applyMode === "trusted-auto" && job.trustedFastModeConsent);

      if (shouldApplyDirectly) {
        try {
          await applyChange(job, preparedChange);
        } catch {
          // applyChange already records the stable public failure on the Job.
        }
        return;
      }

      transition(job, "awaiting-review", "Validated changes are ready for review.");
    } catch (error: unknown) {
      finishWithError(job, error);
    }
  };

  const hasActiveJob = (excludedJobId?: string): boolean =>
    [...jobs.values()].some((job) => job.id !== excludedJobId && isActive(job.status));

  const pruneJobs = (): void => {
    if (jobs.size < MAX_RETAINED_JOBS) {
      return;
    }

    for (const [jobId, job] of jobs) {
      if (PRUNABLE_JOB_STATUSES.has(job.status)) {
        jobs.delete(jobId);
      }

      if (jobs.size < MAX_RETAINED_JOBS) {
        return;
      }
    }
  };

  return Object.freeze({
    async apply(jobId) {
      const job = requireJob(jobId);

      if (
        job.status !== "awaiting-review" ||
        job.preparedChange === undefined ||
        !job.preparedChange.validationPassed ||
        job.result?.diff.length === 0
      ) {
        throw new SpotPatchError(ERROR_CODES.PATCH_REJECTED);
      }

      await applyChange(job, job.preparedChange);
      return snapshot(job);
    },

    cancel(jobId) {
      const job = requireJob(jobId);

      if (!CANCELLABLE_JOB_STATUSES.has(job.status)) {
        return snapshot(job);
      }

      if (job.status === "awaiting-review") {
        job.preparedChange = undefined;
        job.controller.abort("agent-review-cancelled");
        transition(
          job,
          "cancelled",
          "Agent review was closed without applying changes.",
          ERROR_CODES.AGENT_CANCELLED,
        );
        return snapshot(job);
      }

      transition(job, "cancelling", "Cancelling Agent job.");
      job.controller.abort("agent-job-cancelled");
      return snapshot(job);
    },

    async close() {
      if (closed) {
        return;
      }

      closed = true;

      for (const job of jobs.values()) {
        if (CANCELLABLE_JOB_STATUSES.has(job.status)) {
          job.controller.abort("vite-server-closed");
        }
      }

      await Promise.allSettled(
        [...jobs.values()]
          .map((job) => job.runPromise)
          .filter((promise): promise is Promise<void> => promise !== undefined),
      );
      capabilityCache.clear();
      jobs.clear();
    },

    create(request) {
      if (closed) {
        throw new SpotPatchError(ERROR_CODES.AI_DISABLED);
      }

      const configuredApplyMode = options.ai.execution.applyMode;
      const requestedApplyMode =
        request.applyMode ??
        (request.trustedFastModeConsent === true
          ? "trusted-auto"
          : configuredApplyMode);
      const applyModeAllowed =
        configuredApplyMode === "trusted-auto"
          ? requestedApplyMode === "review" || requestedApplyMode === "trusted-auto"
          : requestedApplyMode === configuredApplyMode;
      const trustedConsentMatches =
        (requestedApplyMode === "trusted-auto") ===
        (request.trustedFastModeConsent === true);

      if (!applyModeAllowed || !trustedConsentMatches) {
        throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
      }

      if (hasActiveJob()) {
        throw new SpotPatchError(ERROR_CODES.AGENT_BUSY);
      }

      pruneJobs();

      if (jobs.size >= MAX_RETAINED_JOBS) {
        throw new SpotPatchError(ERROR_CODES.AGENT_BUSY);
      }

      const selection = resolveSelection(
        request.providerProfileId,
        request.modelProfileId,
      );
      const id = dependencies.createJobId();

      if (!JOB_ID_PATTERN.test(id) || jobs.has(id)) {
        throw new SpotPatchError(ERROR_CODES.INTERNAL_ERROR);
      }

      const timestamp = dependencies.now();
      const job: InternalAgentJob = {
        annotation: request.annotation,
        applyMode: requestedApplyMode,
        controller: new AbortController(),
        createdAt: timestamp,
        credential: selection.credential,
        errorCode: undefined,
        events: [],
        id,
        listeners: new Set(),
        model: selection.model,
        phaseMessage: "Agent job queued.",
        preparedChange: undefined,
        provider: selection.provider,
        result: undefined,
        runPromise: undefined,
        sequence: 0,
        status: "queued",
        trustedFastModeConsent: request.trustedFastModeConsent === true,
        updatedAt: timestamp,
        workingTreeMode: request.workingTreeMode,
      };
      jobs.set(id, job);
      emitSnapshot(job);
      emitPhase(job, job.phaseMessage);
      job.runPromise = Promise.resolve().then(async () => runJob(job));
      return snapshot(job);
    },

    events(jobId) {
      return Object.freeze([...requireJob(jobId).events]);
    },

    async probe(request, signal) {
      if (closed) {
        throw new SpotPatchError(ERROR_CODES.AI_DISABLED);
      }

      return probeResolved(
        resolveSelection(request.providerProfileId, request.modelProfileId),
        signal,
      );
    },

    result(jobId) {
      const job = requireJob(jobId);
      const response =
        job.result === undefined
          ? { snapshot: snapshot(job) }
          : { snapshot: snapshot(job), result: job.result };
      return Object.freeze(response);
    },

    async revert(jobId) {
      const job = requireJob(jobId);

      if (
        job.status !== "applied" ||
        job.preparedChange === undefined ||
        hasActiveJob(job.id)
      ) {
        throw new SpotPatchError(
          hasActiveJob(job.id) ? ERROR_CODES.AGENT_BUSY : ERROR_CODES.APPLY_CONFLICT,
        );
      }

      transition(job, "reverting", "Reverting the applied Agent change.");

      try {
        await dependencies.revertChange(job.preparedChange);
        transition(job, "reverted", "The Agent change was safely reverted.");
      } catch (error: unknown) {
        const normalized = normalizeError(error);
        transition(
          job,
          "applied",
          "Revert was rejected because project files changed.",
          normalized.code,
        );
        emitError(job, normalized.code);
        throw normalized;
      }

      return snapshot(job);
    },

    subscribe(jobId, listener) {
      const job = requireJob(jobId);
      job.listeners.add(listener);
      return () => {
        job.listeners.delete(listener);
      };
    },

    workspaceHealth(signal) {
      if (closed) {
        throw new SpotPatchError(ERROR_CODES.AI_DISABLED);
      }

      return dependencies.inspectWorkspace(options.root, signal);
    },
  } satisfies AgentJobManager);
}
