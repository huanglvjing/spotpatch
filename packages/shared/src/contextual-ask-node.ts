import type { SpotAnnotation } from "./model/annotation.js";
import { spotAnnotationSchema } from "./model/context-schema.js";
import {
  spotChangeTaskEnvelopeSchema,
  type SpotChangeTaskEnvelope,
} from "./model/contextual-ask.js";

/**
 * Temporary migration boundary for existing Change consumers.
 * Ask envelopes are intentionally excluded both by the public type and runtime parser.
 */
export function adaptChangeEnvelopeToSpotAnnotationV3(
  envelope: SpotChangeTaskEnvelope,
): SpotAnnotation {
  const change = spotChangeTaskEnvelopeSchema.parse(envelope);
  const instructions = new Map(
    change.task.instructions.map((instruction) => [
      instruction.targetId,
      instruction.instruction,
    ]),
  );
  const firstTarget = change.selection.targets[0];
  if (firstTarget === undefined) {
    throw new TypeError("A Change envelope must contain at least one target.");
  }
  const targets = change.selection.targets.map(({ targetId, page, ...target }) => {
    const instruction = instructions.get(targetId);
    if (instruction === undefined) {
      throw new TypeError("A Change target must have an instruction.");
    }
    return { ...target, page, instruction };
  });

  const annotation = spotAnnotationSchema.parse({
    schemaVersion: 3,
    id: change.taskId,
    locale: change.selection.locale,
    page: firstTarget.page,
    targets,
    createdAt: change.createdAt,
  });
  // JSON protocol objects cannot carry explicit `undefined`; strict parsing above
  // therefore satisfies the legacy interface's exact-optional-property contract.
  return annotation as unknown as SpotAnnotation;
}

export {
  askAnswerBlockSchema,
  askAnswerDraftBlockSchema,
  askAnswerDraftSchema,
  askAnswerResultSchema,
  askAnswerWarningSchema,
  askDraftCitationSchema,
  askDraftOriginSchema,
  askSourceReferenceSchema,
  contextualAskCapabilitySchema,
  contextualAskExecutorCapabilitySchema,
  contextualAskExecutorPreferenceSchema,
  contextualAskOptionsSchema,
  spotAskTaskEnvelopeSchema,
  spotChangeTaskEnvelopeSchema,
  spotSelectionContextSchema,
  spotSelectionTargetSchema,
  spotTaskEnvelopeSchema,
} from "./model/contextual-ask.js";
export {
  askJobActionRequestSchema,
  askJobCreateRequestSchema,
  askJobEventSchema,
  askJobEventsRequestSchema,
  askJobResultResponseSchema,
  askJobSnapshotSchema,
  contextualAskCapabilityRequestSchema,
} from "./protocol/contextual-ask.js";

export type {
  AskAnswerBlock,
  AskAnswerDraft,
  AskAnswerDraftBlock,
  AskAnswerResult,
  AskAnswerWarning,
  AskDraftCitation,
  AskDraftOrigin,
  AskSourceReference,
  ContextualAskCapability,
  ContextualAskExecutorCapability,
  ContextualAskExecutorPreference,
  ContextualAskOptions,
  SpotAskTaskEnvelope,
  SpotChangeTaskEnvelope,
  SpotSelectionContext,
  SpotSelectionTarget,
  SpotTaskEnvelope,
} from "./model/contextual-ask.js";
export type {
  AskJobActionRequest,
  AskJobCreateRequest,
  AskJobEvent,
  AskJobEventsRequest,
  AskJobResultResponse,
  AskJobSnapshot,
  ContextualAskCapabilityRequest,
} from "./protocol/contextual-ask.js";
export {
  ASK_ANSWER_WARNING_CODES,
  ASK_EXECUTOR_ANSWER_WARNING_CODES,
  ASK_FILE_COUNT_BUCKETS,
  ASK_JOB_STATUSES,
  ASK_READ_ACTIVITY_STATES,
  ASK_SOURCE_CONFIDENCES,
  CONTEXTUAL_ASK_EXECUTOR_KINDS,
  CONTEXTUAL_ASK_EXECUTOR_STATES,
  CONTEXTUAL_ASK_LIMITS,
  CONTEXTUAL_ASK_PERMISSION_PROFILE,
  CONTEXTUAL_ASK_SCHEMA_VERSION,
  type AskAnswerWarningCode,
  type AskExecutorAnswerWarningCode,
  type AskFileCountBucket,
  type AskJobStatus,
  type AskReadActivityState,
  type AskSourceConfidence,
  type ContextualAskExecutorKind,
  type ContextualAskExecutorState,
} from "./protocol/contextual-ask-constants.js";
export {
  getAskJobEndpoint,
  SPOTPATCH_ENDPOINTS,
  SPOTPATCH_TOKEN_HEADER,
  type AskJobAction,
} from "./protocol/endpoints.js";
export {
  CONTEXTUAL_ASK_ERROR_CODES,
  type ContextualAskErrorCode,
} from "./errors/error-code.js";
