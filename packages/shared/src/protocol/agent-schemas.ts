import { z } from "zod";

import { ERROR_CODES } from "../errors/error-code.js";
import {
  AGENT_CAPABILITY_STATES,
  AGENT_CHECK_STATUSES,
  AGENT_FILE_CHANGE_KINDS,
  AGENT_JOB_STATUSES,
} from "../model/agent.js";

const profileIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const boundedString = (maximum: number): z.ZodString => z.string().max(maximum);
const errorCodeSchema = z.enum(ERROR_CODES);

export const agentCapabilitySnapshotSchema = z.strictObject({
  providerProfileId: profileIdSchema,
  providerLabel: boundedString(100),
  modelProfileId: profileIdSchema,
  modelLabel: boundedString(100),
  protocol: z.enum(["responses", "chat-completions"]),
  state: z.enum(AGENT_CAPABILITY_STATES),
  authenticated: z.boolean(),
  modelAvailable: z.boolean(),
  toolCalling: z.boolean(),
  toolResultContinuation: z.boolean(),
  streaming: z.boolean(),
  checkedAt: z.iso.datetime().optional(),
  errorCode: errorCodeSchema.optional(),
});

export const agentChangedFileSchema = z.strictObject({
  relativePath: boundedString(1_024),
  kind: z.enum(AGENT_FILE_CHANGE_KINDS),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});

export const agentCheckResultSchema = z.strictObject({
  checkId: profileIdSchema,
  label: boundedString(100),
  status: z.enum(AGENT_CHECK_STATUSES),
  durationMs: z.number().int().nonnegative(),
  output: boundedString(80_000),
});

export const agentJobSnapshotSchema = z.strictObject({
  jobId: z
    .string()
    .min(22)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
  status: z.enum(AGENT_JOB_STATUSES),
  providerProfileId: profileIdSchema,
  providerLabel: boundedString(100),
  modelProfileId: profileIdSchema,
  modelLabel: boundedString(100),
  phaseMessage: boundedString(1_024),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  canCancel: z.boolean(),
  canApply: z.boolean(),
  canRevert: z.boolean(),
  errorCode: errorCodeSchema.optional(),
});

export const agentJobResultSchema = z.strictObject({
  jobId: z
    .string()
    .min(22)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
  summary: boundedString(80_000),
  diff: boundedString(1_000_000),
  files: z.array(agentChangedFileSchema).max(100),
  checks: z.array(agentCheckResultSchema).max(100),
});

export const agentJobResultResponseSchema = z
  .strictObject({
    snapshot: agentJobSnapshotSchema,
    result: agentJobResultSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.result !== undefined && value.result.jobId !== value.snapshot.jobId) {
      context.addIssue({
        code: "custom",
        message: "Agent result and snapshot job IDs must match.",
        path: ["result", "jobId"],
      });
    }
  });

const agentJobEventBaseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sequence: z.number().int().positive(),
  jobId: z
    .string()
    .min(22)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
  status: z.enum(AGENT_JOB_STATUSES),
  timestamp: z.iso.datetime(),
});

export const agentJobEventSchema = z
  .discriminatedUnion("type", [
    agentJobEventBaseSchema.extend({
      type: z.literal("snapshot"),
      data: z.strictObject({ snapshot: agentJobSnapshotSchema }),
    }),
    agentJobEventBaseSchema.extend({
      type: z.literal("phase"),
      data: z.strictObject({ message: boundedString(1_024) }),
    }),
    agentJobEventBaseSchema.extend({
      type: z.literal("tool"),
      data: z.strictObject({
        toolCallId: boundedString(256),
        toolName: boundedString(100),
        state: z.enum(["started", "succeeded", "failed"]),
        relativePath: boundedString(1_024).optional(),
        checkLabel: boundedString(100).optional(),
      }),
    }),
    agentJobEventBaseSchema.extend({
      type: z.literal("check"),
      data: z.strictObject({ result: agentCheckResultSchema }),
    }),
    agentJobEventBaseSchema.extend({
      type: z.literal("result-ready"),
      data: z.strictObject({ hasResult: z.literal(true) }),
    }),
    agentJobEventBaseSchema.extend({
      type: z.literal("error"),
      data: z.strictObject({
        code: errorCodeSchema,
        message: boundedString(1_024),
      }),
    }),
  ])
  .superRefine((event, context) => {
    if (event.type !== "snapshot") {
      return;
    }

    if (event.data.snapshot.jobId !== event.jobId) {
      context.addIssue({
        code: "custom",
        message: "Agent event and snapshot job IDs must match.",
        path: ["data", "snapshot", "jobId"],
      });
    }

    if (event.data.snapshot.status !== event.status) {
      context.addIssue({
        code: "custom",
        message: "Agent event and snapshot statuses must match.",
        path: ["data", "snapshot", "status"],
      });
    }
  });
