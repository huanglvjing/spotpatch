import { z } from "zod";

import { CONTEXTUAL_ASK_ERROR_CODES } from "../errors/error-code.js";
import {
  askAnswerResultSchema,
  contextualAskBoundedText,
  contextualAskOpaqueIdSchema,
  contextualAskRelativePathSchema,
  spotAskTaskEnvelopeSchema,
} from "../model/contextual-ask.js";
import {
  ASK_FILE_COUNT_BUCKETS,
  ASK_JOB_STATUSES,
  ASK_READ_ACTIVITY_STATES,
  CONTEXTUAL_ASK_EXECUTOR_KINDS,
  CONTEXTUAL_ASK_LIMITS,
  CONTEXTUAL_ASK_SCHEMA_VERSION,
} from "./contextual-ask-constants.js";

const limits = CONTEXTUAL_ASK_LIMITS;
const timestampSchema = z.iso.datetime();

export const contextualAskCapabilityRequestSchema = z.strictObject({});

export const askJobCreateRequestSchema = z.strictObject({
  schemaVersion: z.literal(CONTEXTUAL_ASK_SCHEMA_VERSION),
  requestId: contextualAskOpaqueIdSchema,
  envelope: spotAskTaskEnvelopeSchema,
  executorId: contextualAskOpaqueIdSchema,
  model: contextualAskBoundedText(limits.maximumLabelCharacters).optional(),
  providerDataConsent: z.literal(true),
});

export const askJobActionRequestSchema = z.strictObject({});

export const askJobEventsRequestSchema = z.strictObject({
  afterSequence: z.number().int().nonnegative().optional(),
});

const askJobExecutorSnapshotSchema = z.strictObject({
  executorId: contextualAskOpaqueIdSchema,
  kind: z.enum(CONTEXTUAL_ASK_EXECUTOR_KINDS),
  label: contextualAskBoundedText(limits.maximumLabelCharacters),
  modelLabel: contextualAskBoundedText(limits.maximumLabelCharacters),
});

export const askJobSnapshotSchema = z
  .strictObject({
    schemaVersion: z.literal(CONTEXTUAL_ASK_SCHEMA_VERSION),
    jobId: contextualAskOpaqueIdSchema,
    selectionId: contextualAskOpaqueIdSchema,
    status: z.enum(ASK_JOB_STATUSES),
    executor: askJobExecutorSnapshotSchema,
    phaseMessage: contextualAskBoundedText(
      limits.maximumPhaseMessageCharacters,
    ).optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    canCancel: z.boolean(),
    errorCode: z.enum(CONTEXTUAL_ASK_ERROR_CODES).optional(),
  })
  .superRefine((snapshot, context) => {
    if (Date.parse(snapshot.updatedAt) < Date.parse(snapshot.createdAt)) {
      context.addIssue({
        code: "custom",
        message: "Job updatedAt must not precede createdAt.",
        path: ["updatedAt"],
      });
    }

    const cancellable = ["queued", "authorizing", "running"].includes(snapshot.status);
    if (snapshot.canCancel !== cancellable) {
      context.addIssue({
        code: "custom",
        message: "Job canCancel does not match its status.",
        path: ["canCancel"],
      });
    }

    if (
      (snapshot.status === "failed" && snapshot.errorCode === undefined) ||
      (snapshot.status === "failed" && snapshot.errorCode === "ASK_CANCELLED") ||
      (snapshot.status === "cancelled" && snapshot.errorCode !== "ASK_CANCELLED") ||
      (snapshot.status !== "failed" &&
        snapshot.status !== "cancelled" &&
        snapshot.errorCode !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Job errorCode does not match its terminal status.",
        path: ["errorCode"],
      });
    }
  });

export const askJobResultResponseSchema = z
  .strictObject({
    snapshot: askJobSnapshotSchema,
    result: askAnswerResultSchema.optional(),
  })
  .superRefine((response, context) => {
    const answered = response.snapshot.status === "answered";
    if (answered !== (response.result !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Only an answered job must contain an answer result.",
        path: ["result"],
      });
      return;
    }
    if (
      response.result !== undefined &&
      (response.result.jobId !== response.snapshot.jobId ||
        response.result.selectionId !== response.snapshot.selectionId ||
        response.result.executor.executorId !== response.snapshot.executor.executorId)
    ) {
      context.addIssue({
        code: "custom",
        message: "Answer result identity does not match the job snapshot.",
        path: ["result"],
      });
    }
  });

const askJobEventBaseShape = {
  schemaVersion: z.literal(CONTEXTUAL_ASK_SCHEMA_VERSION),
  sequence: z.number().int().positive(),
  jobId: contextualAskOpaqueIdSchema,
  status: z.enum(ASK_JOB_STATUSES),
  timestamp: timestampSchema,
} as const;

const askJobSnapshotEventSchema = z.strictObject({
  ...askJobEventBaseShape,
  type: z.literal("snapshot"),
  snapshot: askJobSnapshotSchema,
});

const askJobPhaseEventSchema = z.strictObject({
  ...askJobEventBaseShape,
  type: z.literal("phase"),
  message: contextualAskBoundedText(limits.maximumPhaseMessageCharacters),
});

const askReadSourceActivitySchema = z.strictObject({
  kind: z.literal("source"),
  sourceId: contextualAskOpaqueIdSchema,
  relativePath: contextualAskRelativePathSchema,
});

const askReadFileCountActivitySchema = z.strictObject({
  kind: z.literal("file-count"),
  bucket: z.enum(ASK_FILE_COUNT_BUCKETS),
});

const askJobReadActivityEventSchema = z.strictObject({
  ...askJobEventBaseShape,
  type: z.literal("read-activity"),
  activity: z.discriminatedUnion("kind", [
    askReadSourceActivitySchema,
    askReadFileCountActivitySchema,
  ]),
  state: z.enum(ASK_READ_ACTIVITY_STATES),
});

const askJobAnswerReadyEventSchema = z.strictObject({
  ...askJobEventBaseShape,
  type: z.literal("answer-ready"),
});

const askJobErrorEventSchema = z.strictObject({
  ...askJobEventBaseShape,
  type: z.literal("error"),
  errorCode: z.enum(CONTEXTUAL_ASK_ERROR_CODES),
});

export const askJobEventSchema = z
  .discriminatedUnion("type", [
    askJobSnapshotEventSchema,
    askJobPhaseEventSchema,
    askJobReadActivityEventSchema,
    askJobAnswerReadyEventSchema,
    askJobErrorEventSchema,
  ])
  .superRefine((event, context) => {
    if (
      event.type === "snapshot" &&
      (event.snapshot.jobId !== event.jobId || event.snapshot.status !== event.status)
    ) {
      context.addIssue({
        code: "custom",
        message: "Snapshot event identity does not match its envelope.",
        path: ["snapshot"],
      });
    }
    if (event.type === "read-activity" && event.status !== "running") {
      context.addIssue({
        code: "custom",
        message: "Read activity is only valid while a job is running.",
        path: ["status"],
      });
    }
    if (
      event.type === "phase" &&
      ["answered", "cancelled", "failed"].includes(event.status)
    ) {
      context.addIssue({
        code: "custom",
        message: "Phase events cannot report a terminal state.",
        path: ["status"],
      });
    }
    if (event.type === "answer-ready" && event.status !== "answered") {
      context.addIssue({
        code: "custom",
        message: "Answer-ready must report the answered state.",
        path: ["status"],
      });
    }
    if (event.type === "error" && !["failed", "cancelled"].includes(event.status)) {
      context.addIssue({
        code: "custom",
        message: "Error events must report a terminal error state.",
        path: ["status"],
      });
    }
    if (
      event.type === "error" &&
      ((event.status === "cancelled" && event.errorCode !== "ASK_CANCELLED") ||
        (event.status === "failed" && event.errorCode === "ASK_CANCELLED"))
    ) {
      context.addIssue({
        code: "custom",
        message: "Error event code does not match its status.",
        path: ["errorCode"],
      });
    }
  });

export type ContextualAskCapabilityRequest = z.infer<
  typeof contextualAskCapabilityRequestSchema
>;
export type AskJobCreateRequest = z.infer<typeof askJobCreateRequestSchema>;
export type AskJobActionRequest = z.infer<typeof askJobActionRequestSchema>;
export type AskJobEventsRequest = z.infer<typeof askJobEventsRequestSchema>;
export type AskJobSnapshot = z.infer<typeof askJobSnapshotSchema>;
export type AskJobResultResponse = z.infer<typeof askJobResultResponseSchema>;
export type AskJobEvent = z.infer<typeof askJobEventSchema>;
