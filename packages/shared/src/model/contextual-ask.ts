import { z } from "zod";

import { CONTEXTUAL_ASK_ERROR_CODES } from "../errors/error-code.js";
import {
  ASK_ANSWER_WARNING_CODES,
  ASK_EXECUTOR_ANSWER_WARNING_CODES,
  ASK_SOURCE_CONFIDENCES,
  CONTEXTUAL_ASK_EXECUTOR_KINDS,
  CONTEXTUAL_ASK_EXECUTOR_STATES,
  CONTEXTUAL_ASK_LIMITS,
  CONTEXTUAL_ASK_SCHEMA_VERSION,
} from "../protocol/contextual-ask-constants.js";
import {
  MAX_ANNOTATION_INSTRUCTION_CHARACTERS,
  MAX_TARGET_INSTRUCTION_CHARACTERS,
  SPOTPATCH_LOCALES,
} from "./annotation.js";
import { pageContextSchema, spotTargetContextSchema } from "./context-schema.js";

const limits = CONTEXTUAL_ASK_LIMITS;
export const contextualAskBoundedText = (maximum: number): z.ZodString =>
  z.string().trim().min(1).max(maximum);
export const contextualAskOpaqueIdSchema = z
  .string()
  .min(1)
  .max(limits.maximumIdCharacters)
  .regex(/^[A-Za-z0-9_-]+$/u);
const profileIdSchema = z
  .string()
  .min(1)
  .max(limits.maximumProfileIdCharacters)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u);
const contentHashSchema = z
  .string()
  .length(limits.contentHashHexCharacters)
  .regex(/^[a-f0-9]+$/u);
export const contextualAskRelativePathSchema = z
  .string()
  .min(1)
  .max(limits.maximumRelativePathCharacters)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      !Array.from(value).some((character) => {
        const codePoint = character.codePointAt(0);
        return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
      }) &&
      !/^[A-Za-z]:/u.test(value) &&
      value
        .split("/")
        .every((segment) => segment !== "" && segment !== "." && segment !== ".."),
    { message: "Expected a safe project-relative POSIX path." },
  );

export const contextualAskExecutorPreferenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("configured-key"),
    providerProfileId: profileIdSchema,
    modelProfileId: profileIdSchema,
  }),
  z.strictObject({ kind: z.literal("managed-codex") }),
]);

export const contextualAskOptionsSchema = z.union([
  z.boolean(),
  z.strictObject({
    defaultExecutor: contextualAskExecutorPreferenceSchema.optional(),
  }),
]);

export const spotSelectionTargetSchema = spotTargetContextSchema
  .omit({ instruction: true, page: true })
  .extend({
    targetId: contextualAskOpaqueIdSchema,
    page: pageContextSchema,
  })
  .strict();

export const spotSelectionContextSchema = z
  .strictObject({
    schemaVersion: z.literal(CONTEXTUAL_ASK_SCHEMA_VERSION),
    selectionId: contextualAskOpaqueIdSchema,
    locale: z.enum(SPOTPATCH_LOCALES),
    targets: z.array(spotSelectionTargetSchema).min(1).max(limits.maximumTargets),
    createdAt: z.iso.datetime(),
  })
  .superRefine((selection, context) => {
    const targetIds = selection.targets.map((target) => target.targetId);
    if (new Set(targetIds).size !== targetIds.length) {
      context.addIssue({
        code: "custom",
        message: "Selection target IDs must be unique.",
        path: ["targets"],
      });
    }
  });

export const askDraftOriginSchema = z
  .strictObject({
    kind: z.literal("contextual-ask"),
    askJobId: contextualAskOpaqueIdSchema,
    question: contextualAskBoundedText(limits.maximumQuestionCharacters),
    answerDigest: contextualAskBoundedText(limits.maximumQuestionCharacters),
    sourceIds: z.array(contextualAskOpaqueIdSchema).max(limits.maximumSources),
  })
  .superRefine((origin, context) => {
    if (new Set(origin.sourceIds).size !== origin.sourceIds.length) {
      context.addIssue({
        code: "custom",
        message: "Ask origin source IDs must be unique.",
        path: ["sourceIds"],
      });
    }
  });

const askTaskSchema = z.strictObject({
  kind: z.literal("ask"),
  question: contextualAskBoundedText(limits.maximumQuestionCharacters),
});
const changeInstructionSchema = z.strictObject({
  targetId: contextualAskOpaqueIdSchema,
  instruction: contextualAskBoundedText(MAX_TARGET_INSTRUCTION_CHARACTERS),
});
const changeTaskSchema = z.strictObject({
  kind: z.literal("change"),
  instructions: z.array(changeInstructionSchema).min(1).max(limits.maximumTargets),
  origin: askDraftOriginSchema.optional(),
});
const envelopeBaseShape = {
  schemaVersion: z.literal(CONTEXTUAL_ASK_SCHEMA_VERSION),
  taskId: contextualAskOpaqueIdSchema,
  selection: spotSelectionContextSchema,
  createdAt: z.iso.datetime(),
} as const;

export const spotAskTaskEnvelopeSchema = z.strictObject({
  ...envelopeBaseShape,
  task: askTaskSchema,
});

export const spotChangeTaskEnvelopeSchema = z
  .strictObject({
    ...envelopeBaseShape,
    task: changeTaskSchema,
  })
  .superRefine((envelope, context) => {
    const targetIds = envelope.selection.targets.map((target) => target.targetId);
    const instructionIds = envelope.task.instructions.map(
      (instruction) => instruction.targetId,
    );
    if (
      new Set(instructionIds).size !== instructionIds.length ||
      instructionIds.length !== targetIds.length ||
      targetIds.some((targetId) => !instructionIds.includes(targetId))
    ) {
      context.addIssue({
        code: "custom",
        message: "Change instructions must map one-to-one to selection targets.",
        path: ["task", "instructions"],
      });
    }
    const total = envelope.task.instructions.reduce(
      (characters, instruction) => characters + instruction.instruction.length,
      0,
    );
    if (total > MAX_ANNOTATION_INSTRUCTION_CHARACTERS) {
      context.addIssue({
        code: "custom",
        message: "Combined change instructions exceed the task limit.",
        path: ["task", "instructions"],
      });
    }
  });

export const spotTaskEnvelopeSchema = z.union([
  spotAskTaskEnvelopeSchema,
  spotChangeTaskEnvelopeSchema,
]);

export const askAnswerWarningSchema = z.strictObject({
  code: z.enum(ASK_ANSWER_WARNING_CODES),
});

const askExecutorAnswerWarningSchema = z.strictObject({
  code: z.enum(ASK_EXECUTOR_ANSWER_WARNING_CODES),
});

export const askDraftCitationSchema = z
  .strictObject({
    handleId: contextualAskOpaqueIdSchema,
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  })
  .refine((citation) => citation.endLine >= citation.startLine, {
    message: "Citation endLine must not precede startLine.",
  });

const draftCitationListSchema = z
  .array(askDraftCitationSchema)
  .max(limits.maximumSources);
const draftParagraphBlockSchema = z.strictObject({
  kind: z.literal("paragraph"),
  text: contextualAskBoundedText(limits.maximumAnswerCharacters),
  citations: draftCitationListSchema,
});
const draftListBlockSchema = z.strictObject({
  kind: z.literal("list"),
  items: z
    .array(
      z.strictObject({
        text: contextualAskBoundedText(limits.maximumAnswerCharacters),
        citations: draftCitationListSchema,
      }),
    )
    .min(1)
    .max(limits.maximumAnswerBlocks),
});
const draftCodeBlockSchema = z.strictObject({
  kind: z.literal("code"),
  code: z.string().min(1).max(limits.maximumAnswerCharacters),
  language: contextualAskBoundedText(limits.maximumLanguageCharacters).optional(),
  citations: draftCitationListSchema,
});
export const askAnswerDraftBlockSchema = z.discriminatedUnion("kind", [
  draftParagraphBlockSchema,
  draftListBlockSchema,
  draftCodeBlockSchema,
]);

function draftCharacters(
  blocks: readonly z.infer<typeof askAnswerDraftBlockSchema>[],
): number {
  return blocks.reduce((total, block) => {
    if (block.kind === "paragraph") return total + block.text.length;
    if (block.kind === "code") return total + block.code.length;
    return (
      total + block.items.reduce((itemTotal, item) => itemTotal + item.text.length, 0)
    );
  }, 0);
}

export const askAnswerDraftSchema = z
  .strictObject({
    blocks: z.array(askAnswerDraftBlockSchema).min(1).max(limits.maximumAnswerBlocks),
    warnings: z.array(askExecutorAnswerWarningSchema).max(limits.maximumAnswerBlocks),
  })
  .superRefine((answer, context) => {
    if (draftCharacters(answer.blocks) > limits.maximumAnswerCharacters) {
      context.addIssue({
        code: "custom",
        message: "Combined answer text exceeds the answer limit.",
        path: ["blocks"],
      });
    }
    const citations = answer.blocks.flatMap((block) =>
      block.kind === "list"
        ? block.items.flatMap((item) => item.citations)
        : block.citations,
    );
    if (
      citations.length === 0 &&
      !answer.warnings.some((warning) => warning.code === "insufficient-evidence")
    ) {
      context.addIssue({
        code: "custom",
        message: "An uncited answer draft must declare insufficient evidence.",
        path: ["warnings"],
      });
    }
    const distinct = new Set(
      citations.map(
        (citation) =>
          `${citation.handleId}:${String(citation.startLine)}:${String(citation.endLine)}`,
      ),
    );
    if (distinct.size > limits.maximumSources) {
      context.addIssue({
        code: "custom",
        message: "Answer references exceed the source limit.",
        path: ["blocks"],
      });
    }
  });

const sourceIdListSchema = z
  .array(contextualAskOpaqueIdSchema)
  .max(limits.maximumSources);
const paragraphBlockSchema = z.strictObject({
  kind: z.literal("paragraph"),
  text: contextualAskBoundedText(limits.maximumAnswerCharacters),
  sourceIds: sourceIdListSchema,
});
const listBlockSchema = z.strictObject({
  kind: z.literal("list"),
  items: z
    .array(
      z.strictObject({
        text: contextualAskBoundedText(limits.maximumAnswerCharacters),
        sourceIds: sourceIdListSchema,
      }),
    )
    .min(1)
    .max(limits.maximumAnswerBlocks),
});
const codeBlockSchema = z.strictObject({
  kind: z.literal("code"),
  code: z.string().min(1).max(limits.maximumAnswerCharacters),
  language: contextualAskBoundedText(limits.maximumLanguageCharacters).optional(),
  sourceIds: sourceIdListSchema,
});
export const askAnswerBlockSchema = z.discriminatedUnion("kind", [
  paragraphBlockSchema,
  listBlockSchema,
  codeBlockSchema,
]);

export const askSourceReferenceSchema = z
  .strictObject({
    sourceId: contextualAskOpaqueIdSchema,
    label: contextualAskBoundedText(limits.maximumLabelCharacters),
    relativePath: contextualAskRelativePathSchema,
    fileId: contextualAskOpaqueIdSchema,
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    confidence: z.enum(ASK_SOURCE_CONFIDENCES),
    targetIds: z.array(contextualAskOpaqueIdSchema).min(1).max(limits.maximumTargets),
    sourceVersion: contextualAskBoundedText(limits.maximumIdCharacters).optional(),
    contentHash: contentHashSchema,
  })
  .superRefine((source, context) => {
    if (source.endLine < source.startLine) {
      context.addIssue({
        code: "custom",
        message: "Source endLine must not precede startLine.",
        path: ["endLine"],
      });
    }
    if (new Set(source.targetIds).size !== source.targetIds.length) {
      context.addIssue({
        code: "custom",
        message: "Source target IDs must be unique.",
        path: ["targetIds"],
      });
    }
  });

function resultBlockCharacters(
  blocks: readonly z.infer<typeof askAnswerBlockSchema>[],
): number {
  return blocks.reduce((total, block) => {
    if (block.kind === "paragraph") return total + block.text.length;
    if (block.kind === "code") return total + block.code.length;
    return (
      total + block.items.reduce((itemTotal, item) => itemTotal + item.text.length, 0)
    );
  }, 0);
}

export const askAnswerResultSchema = z
  .strictObject({
    schemaVersion: z.literal(CONTEXTUAL_ASK_SCHEMA_VERSION),
    jobId: contextualAskOpaqueIdSchema,
    selectionId: contextualAskOpaqueIdSchema,
    contextHash: contentHashSchema,
    executor: z.strictObject({
      executorId: contextualAskOpaqueIdSchema,
      kind: z.enum(CONTEXTUAL_ASK_EXECUTOR_KINDS),
      label: contextualAskBoundedText(limits.maximumLabelCharacters),
      modelLabel: contextualAskBoundedText(limits.maximumLabelCharacters),
    }),
    blocks: z.array(askAnswerBlockSchema).min(1).max(limits.maximumAnswerBlocks),
    sources: z.array(askSourceReferenceSchema).max(limits.maximumSources),
    warnings: z.array(askAnswerWarningSchema).max(limits.maximumAnswerBlocks),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .superRefine((answer, context) => {
    if (Date.parse(answer.expiresAt) <= Date.parse(answer.createdAt)) {
      context.addIssue({
        code: "custom",
        message: "Answer expiry must follow creation.",
        path: ["expiresAt"],
      });
    }
    if (resultBlockCharacters(answer.blocks) > limits.maximumAnswerCharacters) {
      context.addIssue({
        code: "custom",
        message: "Combined answer text exceeds the answer limit.",
        path: ["blocks"],
      });
    }
    const sourceIds = answer.sources.map((source) => source.sourceId);
    if (new Set(sourceIds).size !== sourceIds.length) {
      context.addIssue({
        code: "custom",
        message: "Answer source IDs must be unique.",
        path: ["sources"],
      });
    }
    const available = new Set(sourceIds);
    const references = answer.blocks.flatMap((block) =>
      block.kind === "list"
        ? block.items.flatMap((item) => item.sourceIds)
        : block.sourceIds,
    );
    if (
      references.length === 0 &&
      !answer.warnings.some((warning) => warning.code === "insufficient-evidence")
    ) {
      context.addIssue({
        code: "custom",
        message: "An uncited answer must declare insufficient evidence.",
        path: ["warnings"],
      });
    }
    if (references.some((sourceId) => !available.has(sourceId))) {
      context.addIssue({
        code: "custom",
        message: "Answer blocks reference an unknown source ID.",
        path: ["blocks"],
      });
    }
    if (sourceIds.some((sourceId) => !references.includes(sourceId))) {
      context.addIssue({
        code: "custom",
        message: "Answer sources must be referenced by at least one block.",
        path: ["sources"],
      });
    }
  });

export const contextualAskExecutorCapabilitySchema = z
  .strictObject({
    executorId: contextualAskOpaqueIdSchema,
    kind: z.enum(CONTEXTUAL_ASK_EXECUTOR_KINDS),
    label: contextualAskBoundedText(limits.maximumLabelCharacters),
    requestedModelLabel: contextualAskBoundedText(limits.maximumLabelCharacters),
    effectiveModelLabel: contextualAskBoundedText(limits.maximumLabelCharacters),
    state: z.enum(CONTEXTUAL_ASK_EXECUTOR_STATES),
    providerDataConsentRequired: z.boolean(),
    readOnlyProven: z.boolean(),
    errorCode: z.enum(CONTEXTUAL_ASK_ERROR_CODES).optional(),
  })
  .superRefine((executor, context) => {
    if (
      (executor.state === "ready" &&
        (!executor.readOnlyProven || executor.errorCode !== undefined)) ||
      (executor.state !== "ready" && executor.errorCode === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Executor capability fields are inconsistent.",
      });
    }
  });

export const contextualAskCapabilitySchema = z
  .strictObject({
    schemaVersion: z.literal(CONTEXTUAL_ASK_SCHEMA_VERSION),
    enabled: z.boolean(),
    executors: z
      .array(contextualAskExecutorCapabilitySchema)
      .max(limits.maximumExecutors),
    safety: z.strictObject({
      selectionRequired: z.literal(true),
      singleTurn: z.literal(true),
      writesAllowed: z.literal(false),
      historyStored: z.literal(false),
    }),
    checkedAt: z.iso.datetime(),
  })
  .superRefine((capability, context) => {
    if (
      (!capability.enabled && capability.executors.length > 0) ||
      new Set(capability.executors.map((executor) => executor.executorId)).size !==
        capability.executors.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Contextual Ask capability fields are inconsistent.",
        path: ["executors"],
      });
    }
  });

export type ContextualAskExecutorPreference = z.infer<
  typeof contextualAskExecutorPreferenceSchema
>;
export type ContextualAskOptions = z.infer<typeof contextualAskOptionsSchema>;
export type SpotSelectionTarget = z.infer<typeof spotSelectionTargetSchema>;
export type SpotSelectionContext = z.infer<typeof spotSelectionContextSchema>;
export type AskDraftOrigin = z.infer<typeof askDraftOriginSchema>;
export type SpotAskTaskEnvelope = z.infer<typeof spotAskTaskEnvelopeSchema>;
export type SpotChangeTaskEnvelope = z.infer<typeof spotChangeTaskEnvelopeSchema>;
export type SpotTaskEnvelope = z.infer<typeof spotTaskEnvelopeSchema>;
export type AskAnswerWarning = z.infer<typeof askAnswerWarningSchema>;
export type AskDraftCitation = z.infer<typeof askDraftCitationSchema>;
export type AskAnswerDraftBlock = z.infer<typeof askAnswerDraftBlockSchema>;
export type AskAnswerDraft = z.infer<typeof askAnswerDraftSchema>;
export type AskAnswerBlock = z.infer<typeof askAnswerBlockSchema>;
export type AskSourceReference = z.infer<typeof askSourceReferenceSchema>;
export type AskAnswerResult = z.infer<typeof askAnswerResultSchema>;
export type ContextualAskExecutorCapability = z.infer<
  typeof contextualAskExecutorCapabilitySchema
>;
export type ContextualAskCapability = z.infer<typeof contextualAskCapabilitySchema>;
