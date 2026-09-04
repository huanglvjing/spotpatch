import { createHash, randomBytes } from "node:crypto";

import type {
  AskSourceGrantEntry,
  ContextualAskExecutor,
  ContextualAskReadSnapshot,
} from "@spotpatch/agent";
import {
  askAnswerDraftSchema,
  askAnswerResultSchema,
  askJobCreateRequestSchema,
  askJobEventSchema,
  askJobResultResponseSchema,
  askJobSnapshotSchema,
  contextualAskCapabilitySchema,
  contextualAskExecutorCapabilitySchema,
  CONTEXTUAL_ASK_LIMITS,
  CONTEXTUAL_ASK_SCHEMA_VERSION,
  type AskAnswerBlock,
  type AskAnswerDraft,
  type AskAnswerResult,
  type AskAnswerWarning,
  type AskJobCreateRequest,
  type AskJobEvent,
  type AskJobResultResponse,
  type AskJobSnapshot,
  type AskJobStatus,
  type ContextualAskCapability,
  type ContextualAskErrorCode,
  type ContextualAskExecutorCapability,
} from "@spotpatch/shared";

import type { SourceRegistry } from "../registry/source-registry.js";
import type {
  WorkspaceActivityCoordinator,
  WorkspaceActivityLease,
} from "../workspace/activity-coordinator.js";
import { ContextualAskError, asContextualAskError } from "./error.js";
import {
  captureAskReadSnapshot,
  type CapturedAskReadSnapshot,
} from "./read-snapshot.js";

const ACTIVE_STATUSES = new Set<AskJobStatus>([
  "queued",
  "authorizing",
  "running",
  "cancelling",
]);
const TERMINAL_STATUSES = new Set<AskJobStatus>(["answered", "cancelled", "failed"]);

export type ContextualAskJobEventListener = (event: AskJobEvent) => void;

interface InternalAskJob {
  readonly controller: AbortController;
  readonly createdAt: string;
  readonly events: AskJobEvent[];
  readonly executor: ContextualAskExecutor;
  executorCapability: ContextualAskExecutorCapability;
  readonly fingerprint: string;
  readonly id: string;
  readonly lease: WorkspaceActivityLease;
  readonly listeners: Set<ContextualAskJobEventListener>;
  readonly request: AskJobCreateRequest;
  errorCode: ContextualAskErrorCode | undefined;
  expiresAt: number | undefined;
  phaseMessage: string | undefined;
  result: AskAnswerResult | undefined;
  runPromise: Promise<void> | undefined;
  sequence: number;
  snapshot: CapturedAskReadSnapshot | undefined;
  status: AskJobStatus;
  updatedAt: string;
}

export interface ContextualAskManager {
  cancel(jobId: string): AskJobSnapshot;
  capability(signal: AbortSignal): Promise<ContextualAskCapability>;
  close(): Promise<void>;
  create(request: AskJobCreateRequest): Promise<AskJobSnapshot>;
  events(jobId: string, afterSequence?: number): readonly AskJobEvent[];
  result(jobId: string): Promise<AskJobResultResponse>;
  snapshot(jobId: string): AskJobSnapshot;
  subscribe(jobId: string, listener: ContextualAskJobEventListener): () => void;
}

interface ContextualAskManagerDependencies {
  readonly captureSnapshot: typeof captureAskReadSnapshot;
  readonly createId: () => string;
  readonly now: () => Date;
}

export interface CreateContextualAskManagerOptions {
  readonly coordinator: WorkspaceActivityCoordinator;
  readonly enabled: boolean;
  readonly executors?: readonly ContextualAskExecutor[];
  readonly registry: SourceRegistry;
  readonly root: string;
  readonly dependencies?: Partial<ContextualAskManagerDependencies>;
}

const DEFAULT_DEPENDENCIES: ContextualAskManagerDependencies = Object.freeze({
  captureSnapshot: captureAskReadSnapshot,
  createId: () => randomBytes(16).toString("base64url"),
  now: () => new Date(),
});

function fingerprint(request: AskJobCreateRequest): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        envelope: request.envelope,
        executorId: request.executorId,
        providerDataConsent: request.providerDataConsent,
      }),
    )
    .digest("hex");
}

function fileCountBucket(count: number): "one" | "few" | "many" {
  if (count <= 1) return "one";
  if (count <= 5) return "few";
  return "many";
}

function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  const reason = (): Error =>
    signal.reason instanceof Error
      ? signal.reason
      : new ContextualAskError("ASK_CANCELLED");
  if (signal.aborted) return Promise.reject(reason());
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(reason());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(
          error instanceof Error
            ? error
            : new ContextualAskError("ASK_EXECUTOR_UNAVAILABLE", { cause: error }),
        );
      },
    );
  });
}

export function createContextualAskManager(
  options: CreateContextualAskManagerOptions,
): ContextualAskManager {
  const dependencies = Object.freeze({
    ...DEFAULT_DEPENDENCIES,
    ...options.dependencies,
  });
  const executors = new Map<string, ContextualAskExecutor>();
  for (const executor of options.executors ?? []) {
    if (executors.has(executor.executorId)) {
      throw new TypeError("Contextual Ask executor IDs must be unique.");
    }
    executors.set(executor.executorId, executor);
  }
  const jobs = new Map<string, InternalAskJob>();
  const requests = new Map<string, Readonly<{ fingerprint: string; jobId: string }>>();
  const pendingRequests = new Map<
    string,
    Readonly<{
      controller: AbortController;
      fingerprint: string;
      promise: Promise<AskJobSnapshot>;
    }>
  >();
  let closed = false;
  const isClosed = (): boolean => closed;

  const cleanupExpired = (): void => {
    const now = dependencies.now().getTime();
    for (const [jobId, job] of jobs) {
      if (job.expiresAt !== undefined && now >= job.expiresAt) {
        job.snapshot?.dispose();
        jobs.delete(jobId);
        const request = requests.get(job.request.requestId);
        if (request?.jobId === jobId) requests.delete(job.request.requestId);
      }
    }
  };

  const requireJob = (jobId: string): InternalAskJob => {
    cleanupExpired();
    const job = jobs.get(jobId);
    if (job === undefined) throw new ContextualAskError("ASK_RESULT_EXPIRED");
    return job;
  };

  const publicSnapshot = (job: InternalAskJob): AskJobSnapshot =>
    askJobSnapshotSchema.parse({
      schemaVersion: CONTEXTUAL_ASK_SCHEMA_VERSION,
      jobId: job.id,
      selectionId: job.request.envelope.selection.selectionId,
      status: job.status,
      executor: {
        executorId: job.executorCapability.executorId,
        kind: job.executorCapability.kind,
        label: job.executorCapability.label,
        modelLabel: job.executorCapability.effectiveModelLabel,
      },
      ...(job.phaseMessage === undefined ? {} : { phaseMessage: job.phaseMessage }),
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      canCancel: ["queued", "authorizing", "running"].includes(job.status),
      ...(job.errorCode === undefined ? {} : { errorCode: job.errorCode }),
    });

  const appendEvent = (job: InternalAskJob, event: AskJobEvent): void => {
    job.events.push(askJobEventSchema.parse(event));
    if (job.events.length > CONTEXTUAL_ASK_LIMITS.maximumRetainedEvents) {
      job.events.splice(
        0,
        job.events.length - CONTEXTUAL_ASK_LIMITS.maximumRetainedEvents,
      );
    }
    for (const listener of job.listeners) listener(event);
  };

  const eventBase = (job: InternalAskJob) => {
    job.sequence += 1;
    return {
      schemaVersion: CONTEXTUAL_ASK_SCHEMA_VERSION,
      sequence: job.sequence,
      jobId: job.id,
      status: job.status,
      timestamp: dependencies.now().toISOString(),
    } as const;
  };

  const emitSnapshot = (job: InternalAskJob): void => {
    appendEvent(job, {
      ...eventBase(job),
      type: "snapshot",
      snapshot: publicSnapshot(job),
    });
  };

  const emitPhase = (job: InternalAskJob, message: string): void => {
    appendEvent(job, { ...eventBase(job), type: "phase", message });
  };

  const emitReadActivity = (
    job: InternalAskJob,
    entry: AskSourceGrantEntry | undefined,
    state: "started" | "succeeded" | "failed",
  ): void => {
    appendEvent(job, {
      ...eventBase(job),
      type: "read-activity",
      activity:
        entry === undefined
          ? {
              kind: "file-count",
              bucket: fileCountBucket(job.snapshot?.grant.sources.length ?? 0),
            }
          : {
              kind: "source",
              sourceId: entry.fileId,
              relativePath: entry.relativePath,
            },
      state,
    });
  };

  const transition = (
    job: InternalAskJob,
    status: AskJobStatus,
    phaseMessage: string,
    errorCode?: ContextualAskErrorCode,
  ): void => {
    job.status = status;
    job.phaseMessage = phaseMessage;
    job.errorCode = errorCode;
    job.updatedAt = dependencies.now().toISOString();
    emitSnapshot(job);
    if (!TERMINAL_STATUSES.has(status)) emitPhase(job, phaseMessage);
  };

  const finish = (job: InternalAskJob): void => {
    job.expiresAt = dependencies.now().getTime() + CONTEXTUAL_ASK_LIMITS.resultTtlMs;
    job.lease.release();
    job.snapshot?.dispose();
    job.snapshot = undefined;
  };

  const fail = (job: InternalAskJob, error: unknown): void => {
    if (TERMINAL_STATUSES.has(job.status)) return;
    const normalized = asContextualAskError(error);
    const abortReason: unknown = job.controller.signal.reason;
    const cancelled =
      normalized.code === "ASK_CANCELLED" ||
      (abortReason instanceof ContextualAskError &&
        abortReason.code === "ASK_CANCELLED");
    transition(
      job,
      cancelled ? "cancelled" : "failed",
      cancelled ? "Question cancelled." : "Question failed.",
      cancelled ? "ASK_CANCELLED" : normalized.code,
    );
    appendEvent(job, {
      ...eventBase(job),
      type: "error",
      errorCode: cancelled ? "ASK_CANCELLED" : normalized.code,
    });
    finish(job);
  };

  const instrumentSnapshot = (
    job: InternalAskJob,
    snapshot: ContextualAskReadSnapshot,
    onLimitExceeded: () => void,
  ): ContextualAskReadSnapshot => {
    const byHandle = new Map(
      snapshot.manifest().map((entry) => [entry.handleId, entry]),
    );
    let readOperations = 0;
    const beginOperation = (): void => {
      readOperations += 1;
      if (readOperations > CONTEXTUAL_ASK_LIMITS.maximumToolCalls) {
        onLimitExceeded();
        throw new ContextualAskError("ASK_LIMIT_EXCEEDED");
      }
    };
    return Object.freeze({
      manifest: () => snapshot.manifest(),
      read(
        handleId: string,
        range?: Readonly<{ startLine?: number; endLine?: number }>,
      ) {
        beginOperation();
        const entry = byHandle.get(handleId);
        if (job.status === "running") emitReadActivity(job, entry, "started");
        try {
          const result = snapshot.read(handleId, range);
          if (job.status === "running") emitReadActivity(job, entry, "succeeded");
          return result;
        } catch (error: unknown) {
          if (job.status === "running") emitReadActivity(job, entry, "failed");
          throw error;
        }
      },
      search(query: string) {
        beginOperation();
        if (job.status === "running") emitReadActivity(job, undefined, "started");
        try {
          const result = snapshot.search(query);
          if (job.status === "running") {
            emitReadActivity(job, undefined, "succeeded");
          }
          return result;
        } catch (error: unknown) {
          if (job.status === "running") emitReadActivity(job, undefined, "failed");
          throw error;
        }
      },
    });
  };

  const projectAnswer = async (
    job: InternalAskJob,
    draft: AskAnswerDraft,
    captured: CapturedAskReadSnapshot,
  ): Promise<AskAnswerResult> => {
    const sourceIds = new Map<string, string>();
    const sources = new Map<string, ReturnType<typeof captured.projectCitation>>();
    const projectCitations = (
      citations: readonly Readonly<{
        handleId: string;
        startLine: number;
        endLine: number;
      }>[],
    ): string[] =>
      citations.map((citation) => {
        const key = `${citation.handleId}:${String(citation.startLine)}:${String(citation.endLine)}`;
        let sourceId = sourceIds.get(key);
        if (sourceId === undefined) {
          sourceId = dependencies.createId();
          sourceIds.set(key, sourceId);
          sources.set(
            sourceId,
            captured.projectCitation(
              citation.handleId,
              citation.startLine,
              citation.endLine,
            ),
          );
        }
        return sourceId;
      });
    const blocks: AskAnswerBlock[] = draft.blocks.map((block): AskAnswerBlock => {
      if (block.kind === "list") {
        return {
          kind: "list",
          items: block.items.map((item) => ({
            text: item.text,
            sourceIds: projectCitations(item.citations),
          })),
        };
      }
      return Object.freeze({
        kind: block.kind,
        ...(block.kind === "paragraph" ? { text: block.text } : { code: block.code }),
        ...(block.kind === "code" && block.language !== undefined
          ? { language: block.language }
          : {}),
        sourceIds: projectCitations(block.citations),
      }) as AskAnswerBlock;
    });
    const warnings: AskAnswerWarning[] = [...draft.warnings];
    if (
      captured.grant.truncated &&
      !warnings.some((warning) => warning.code === "source-truncated")
    ) {
      warnings.push(Object.freeze({ code: "source-truncated" }));
    }
    if (
      (await captured.isStale()) &&
      !warnings.some((warning) => warning.code === "source-stale")
    ) {
      warnings.push(Object.freeze({ code: "source-stale" }));
    }
    const created = dependencies.now();
    return askAnswerResultSchema.parse({
      schemaVersion: CONTEXTUAL_ASK_SCHEMA_VERSION,
      jobId: job.id,
      selectionId: job.request.envelope.selection.selectionId,
      contextHash: captured.grant.contextHash,
      executor: {
        executorId: job.executorCapability.executorId,
        kind: job.executorCapability.kind,
        label: job.executorCapability.label,
        modelLabel: job.executorCapability.effectiveModelLabel,
      },
      blocks,
      sources: [...sources].map(([sourceId, source]) => ({
        sourceId,
        label: source.label,
        relativePath: source.relativePath,
        fileId: source.fileId,
        startLine: source.startLine,
        endLine: source.endLine,
        confidence: source.confidence,
        targetIds: source.targetIds,
        ...(source.sourceVersion === undefined
          ? {}
          : { sourceVersion: source.sourceVersion }),
        contentHash: source.contentHash,
      })),
      warnings,
      createdAt: created.toISOString(),
      expiresAt: new Date(
        created.getTime() + CONTEXTUAL_ASK_LIMITS.resultTtlMs,
      ).toISOString(),
    });
  };

  const run = async (job: InternalAskJob): Promise<void> => {
    const timeout = setTimeout(() => {
      job.controller.abort(new ContextualAskError("ASK_TIMEOUT"));
    }, CONTEXTUAL_ASK_LIMITS.jobTimeoutMs);
    timeout.unref();
    try {
      transition(job, "authorizing", "Authorizing selected sources.");
      const captured = await dependencies.captureSnapshot({
        root: options.root,
        registry: options.registry,
        selection: job.request.envelope.selection,
        signal: job.controller.signal,
        createHandleId: dependencies.createId,
      });
      if (job.controller.signal.aborted) {
        captured.dispose();
      }
      job.controller.signal.throwIfAborted();
      job.snapshot = captured;
      transition(job, "running", "Analyzing the authorized snapshot.");
      emitReadActivity(job, undefined, "succeeded");
      const readLimit = { exceeded: false };
      const execution = await raceWithAbort(
        job.executor.execute(
          {
            jobId: job.id,
            envelope: job.request.envelope,
            grant: captured.grant,
            snapshot: instrumentSnapshot(job, captured.snapshot, () => {
              readLimit.exceeded = true;
            }),
          },
          job.controller.signal,
        ),
        job.controller.signal,
      );
      const draft = askAnswerDraftSchema.parse(execution);
      const effectiveModelLabel = job.executor.effectiveModelLabel?.();
      if (effectiveModelLabel !== undefined) {
        job.executorCapability = contextualAskExecutorCapabilitySchema.parse({
          ...job.executorCapability,
          effectiveModelLabel,
        });
      }
      if (readLimit.exceeded) throw new ContextualAskError("ASK_LIMIT_EXCEEDED");
      job.controller.signal.throwIfAborted();
      const result = await projectAnswer(job, draft, captured);
      job.controller.signal.throwIfAborted();
      job.result = result;
      transition(job, "answered", "Answer ready.");
      appendEvent(job, { ...eventBase(job), type: "answer-ready" });
      finish(job);
    } catch (error: unknown) {
      fail(
        job,
        error instanceof Error && error.name === "ZodError"
          ? new ContextualAskError("ASK_ANSWER_INVALID", { cause: error })
          : asContextualAskError(error),
      );
    } finally {
      clearTimeout(timeout);
    }
  };

  return Object.freeze({
    async capability(signal: AbortSignal): Promise<ContextualAskCapability> {
      if (!options.enabled || closed) {
        return contextualAskCapabilitySchema.parse({
          schemaVersion: CONTEXTUAL_ASK_SCHEMA_VERSION,
          enabled: false,
          executors: [],
          safety: {
            selectionRequired: true,
            singleTurn: true,
            writesAllowed: false,
            historyStored: false,
          },
          checkedAt: dependencies.now().toISOString(),
        });
      }
      const capabilities = (
        await Promise.all(
          [...executors.values()].map(async (executor) => {
            try {
              return contextualAskExecutorCapabilitySchema.parse(
                await raceWithAbort(executor.capability(signal), signal),
              );
            } catch {
              return undefined;
            }
          }),
        )
      ).filter((capability) => capability !== undefined);
      return contextualAskCapabilitySchema.parse({
        schemaVersion: CONTEXTUAL_ASK_SCHEMA_VERSION,
        enabled: true,
        executors: capabilities,
        safety: {
          selectionRequired: true,
          singleTurn: true,
          writesAllowed: false,
          historyStored: false,
        },
        checkedAt: dependencies.now().toISOString(),
      });
    },

    async create(rawRequest: AskJobCreateRequest): Promise<AskJobSnapshot> {
      cleanupExpired();
      if (!options.enabled || closed) throw new ContextualAskError("ASK_DISABLED");
      const parsed = askJobCreateRequestSchema.safeParse(rawRequest);
      if (!parsed.success) throw new ContextualAskError("ASK_QUESTION_INVALID");
      const request = parsed.data;
      const requestFingerprint = fingerprint(request);
      const previous = requests.get(request.requestId);
      if (previous !== undefined) {
        if (previous.fingerprint !== requestFingerprint) {
          throw new ContextualAskError("ASK_IDEMPOTENCY_CONFLICT");
        }
        return publicSnapshot(requireJob(previous.jobId));
      }
      const pending = pendingRequests.get(request.requestId);
      if (pending !== undefined) {
        if (pending.fingerprint !== requestFingerprint) {
          throw new ContextualAskError("ASK_IDEMPOTENCY_CONFLICT");
        }
        return await pending.promise;
      }
      if ([...jobs.values()].some((job) => ACTIVE_STATUSES.has(job.status))) {
        throw new ContextualAskError("ASK_BUSY");
      }
      const executor = executors.get(request.executorId);
      if (executor === undefined)
        throw new ContextualAskError("ASK_EXECUTOR_UNAVAILABLE");
      const lease = options.coordinator.acquire("ask");
      if (lease === undefined) throw new ContextualAskError("ASK_BUSY");
      const controller = new AbortController();
      let leaseTransferred = false;
      const creation = (async (): Promise<AskJobSnapshot> => {
        try {
          const capabilitySignal = AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(CONTEXTUAL_ASK_LIMITS.capabilityTimeoutMs),
          ]);
          const capability = contextualAskExecutorCapabilitySchema.parse(
            await raceWithAbort(
              executor.capability(capabilitySignal),
              capabilitySignal,
            ),
          );
          if (isClosed()) throw new ContextualAskError("ASK_DISABLED");
          if (
            capability.executorId !== executor.executorId ||
            capability.state !== "ready" ||
            !capability.readOnlyProven
          ) {
            throw new ContextualAskError("ASK_EXECUTOR_UNAVAILABLE");
          }
          for (const [jobId, existing] of jobs) {
            if (TERMINAL_STATUSES.has(existing.status)) {
              existing.snapshot?.dispose();
              jobs.delete(jobId);
              requests.delete(existing.request.requestId);
            }
          }
          const createdAt = dependencies.now().toISOString();
          const job: InternalAskJob = {
            controller: new AbortController(),
            createdAt,
            events: [],
            executor,
            executorCapability: capability,
            fingerprint: requestFingerprint,
            id: dependencies.createId(),
            lease,
            listeners: new Set(),
            request,
            errorCode: undefined,
            expiresAt: undefined,
            phaseMessage: "Question queued.",
            result: undefined,
            runPromise: undefined,
            sequence: 0,
            snapshot: undefined,
            status: "queued",
            updatedAt: createdAt,
          };
          jobs.set(job.id, job);
          requests.set(request.requestId, {
            fingerprint: requestFingerprint,
            jobId: job.id,
          });
          leaseTransferred = true;
          emitSnapshot(job);
          emitPhase(job, "Question queued.");
          job.runPromise = run(job);
          return publicSnapshot(job);
        } catch (error: unknown) {
          throw error instanceof ContextualAskError
            ? error
            : new ContextualAskError("ASK_EXECUTOR_UNAVAILABLE", {
                cause: error,
              });
        } finally {
          if (!leaseTransferred) lease.release();
          pendingRequests.delete(request.requestId);
        }
      })();
      pendingRequests.set(request.requestId, {
        controller,
        fingerprint: requestFingerprint,
        promise: creation,
      });
      return await creation;
    },

    cancel(jobId: string): AskJobSnapshot {
      const job = requireJob(jobId);
      if (TERMINAL_STATUSES.has(job.status)) return publicSnapshot(job);
      if (job.status !== "cancelling") {
        transition(job, "cancelling", "Cancelling question.");
        job.controller.abort(new ContextualAskError("ASK_CANCELLED"));
        job.snapshot?.dispose();
        job.snapshot = undefined;
      }
      return publicSnapshot(job);
    },

    events(jobId: string, afterSequence = 0): readonly AskJobEvent[] {
      if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
        throw new ContextualAskError("ASK_PROTOCOL_INCOMPATIBLE");
      }
      return Object.freeze(
        requireJob(jobId).events.filter((event) => event.sequence > afterSequence),
      );
    },

    async result(jobId: string): Promise<AskJobResultResponse> {
      const job = requireJob(jobId);
      await job.runPromise;
      const current = requireJob(jobId);
      return askJobResultResponseSchema.parse({
        snapshot: publicSnapshot(current),
        ...(current.result === undefined ? {} : { result: current.result }),
      });
    },

    snapshot(jobId: string): AskJobSnapshot {
      return publicSnapshot(requireJob(jobId));
    },

    subscribe(jobId: string, listener: ContextualAskJobEventListener): () => void {
      const job = requireJob(jobId);
      if (job.listeners.size >= CONTEXTUAL_ASK_LIMITS.maximumEventSubscribers) {
        throw new ContextualAskError("ASK_LIMIT_EXCEEDED");
      }
      job.listeners.add(listener);
      return () => job.listeners.delete(listener);
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      for (const pending of pendingRequests.values()) {
        pending.controller.abort(new ContextualAskError("ASK_CANCELLED"));
      }
      await Promise.allSettled(
        [...pendingRequests.values()].map((pending) => pending.promise),
      );
      for (const job of jobs.values()) {
        if (ACTIVE_STATUSES.has(job.status)) {
          job.controller.abort(new ContextualAskError("ASK_CANCELLED"));
        }
      }
      await Promise.allSettled(
        [...jobs.values()].map((job) => job.runPromise ?? Promise.resolve()),
      );
      for (const job of jobs.values()) {
        job.snapshot?.dispose();
        job.listeners.clear();
        job.lease.release();
      }
      jobs.clear();
      requests.clear();
      pendingRequests.clear();
      await Promise.allSettled(
        [...executors.values()].map(async (executor) => executor.dispose?.()),
      );
    },
  });
}
