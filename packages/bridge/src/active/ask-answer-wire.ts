import { ContextualAskExecutorError } from "@spotpatch/agent";
import {
  ASK_EXECUTOR_ANSWER_WARNING_CODES,
  CONTEXTUAL_ASK_LIMITS,
  askAnswerDraftSchema,
  type AskAnswerDraft,
} from "@spotpatch/shared";

type JsonRecord = Readonly<Record<string, unknown>>;

/**
 * Flat wire format for Ask answers produced through structured output. It
 * avoids union keywords (oneOf/anyOf), which strict structured-output modes
 * reject, so every block carries every field and unused ones are empty.
 */
export const ASK_ANSWER_WIRE_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({
    blocks: Object.freeze({
      type: "array",
      minItems: 1,
      maxItems: CONTEXTUAL_ASK_LIMITS.maximumAnswerBlocks,
      items: Object.freeze({
        type: "object",
        properties: Object.freeze({
          kind: Object.freeze({
            type: "string",
            enum: Object.freeze(["paragraph", "list", "code"]),
          }),
          text: Object.freeze({
            type: Object.freeze(["string", "null"]),
            maxLength: CONTEXTUAL_ASK_LIMITS.maximumAnswerCharacters,
          }),
          listItems: Object.freeze({
            type: "array",
            maxItems: CONTEXTUAL_ASK_LIMITS.maximumAnswerBlocks,
            items: Object.freeze({
              type: "object",
              properties: Object.freeze({
                text: Object.freeze({
                  type: "string",
                  minLength: 1,
                  maxLength: CONTEXTUAL_ASK_LIMITS.maximumAnswerCharacters,
                }),
                citations: citationListSchema(),
              }),
              required: Object.freeze(["text", "citations"]),
              additionalProperties: false,
            }),
          }),
          code: Object.freeze({
            type: Object.freeze(["string", "null"]),
            maxLength: CONTEXTUAL_ASK_LIMITS.maximumAnswerCharacters,
          }),
          language: Object.freeze({
            type: Object.freeze(["string", "null"]),
            maxLength: CONTEXTUAL_ASK_LIMITS.maximumLanguageCharacters,
          }),
          citations: citationListSchema(),
        }),
        required: Object.freeze([
          "kind",
          "text",
          "listItems",
          "code",
          "language",
          "citations",
        ]),
        additionalProperties: false,
      }),
    }),
    warnings: Object.freeze({
      type: "array",
      maxItems: CONTEXTUAL_ASK_LIMITS.maximumAnswerBlocks,
      items: Object.freeze({
        type: "object",
        properties: Object.freeze({
          code: Object.freeze({
            type: "string",
            enum: ASK_EXECUTOR_ANSWER_WARNING_CODES,
          }),
        }),
        required: Object.freeze(["code"]),
        additionalProperties: false,
      }),
    }),
  }),
  required: Object.freeze(["blocks", "warnings"]),
  additionalProperties: false,
});

function citationListSchema(): JsonRecord {
  return Object.freeze({
    type: "array",
    maxItems: CONTEXTUAL_ASK_LIMITS.maximumSources,
    items: Object.freeze({
      type: "object",
      properties: Object.freeze({
        handleId: Object.freeze({
          type: "string",
          minLength: 1,
          maxLength: CONTEXTUAL_ASK_LIMITS.maximumIdCharacters,
        }),
        startLine: Object.freeze({ type: "integer", minimum: 1 }),
        endLine: Object.freeze({ type: "integer", minimum: 1 }),
      }),
      required: Object.freeze(["handleId", "startLine", "endLine"]),
      additionalProperties: false,
    }),
  });
}

/** Prompt text describing how each wire block must be filled. */
export const ASK_ANSWER_WIRE_INSTRUCTIONS =
  "For each output block, populate every required wire field. paragraph uses text plus citations and sets listItems=[], code=null, language=null. list uses non-empty listItems and sets text=null, code=null, language=null, citations=[]. code uses code plus citations, optional language as string or null, and sets text=null, listItems=[].";

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: JsonRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => key in value);
}

function answerError(): ContextualAskExecutorError {
  return new ContextualAskExecutorError("ASK_ANSWER_INVALID");
}

/** Converts a wire answer into the validated public answer draft. */
export function parseAskAnswerWire(value: unknown): AskAnswerDraft {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["blocks", "warnings"]) ||
    !Array.isArray(value.blocks) ||
    !Array.isArray(value.warnings)
  ) {
    throw answerError();
  }
  const blocks = value.blocks.map((candidate: unknown): unknown => {
    if (
      !isRecord(candidate) ||
      !hasOnlyKeys(candidate, [
        "kind",
        "text",
        "listItems",
        "code",
        "language",
        "citations",
      ]) ||
      !Array.isArray(candidate.listItems) ||
      !Array.isArray(candidate.citations)
    ) {
      throw answerError();
    }
    if (candidate.kind === "paragraph") {
      if (
        typeof candidate.text !== "string" ||
        candidate.listItems.length !== 0 ||
        candidate.code !== null ||
        candidate.language !== null
      ) {
        throw answerError();
      }
      return {
        kind: "paragraph",
        text: candidate.text,
        citations: candidate.citations,
      };
    }
    if (candidate.kind === "list") {
      if (
        candidate.text !== null ||
        candidate.listItems.length === 0 ||
        candidate.code !== null ||
        candidate.language !== null ||
        candidate.citations.length !== 0
      ) {
        throw answerError();
      }
      return { kind: "list", items: candidate.listItems };
    }
    if (candidate.kind === "code") {
      if (
        candidate.text !== null ||
        candidate.listItems.length !== 0 ||
        typeof candidate.code !== "string" ||
        (candidate.language !== null && typeof candidate.language !== "string")
      ) {
        throw answerError();
      }
      return {
        kind: "code",
        code: candidate.code,
        ...(candidate.language === null ? {} : { language: candidate.language }),
        citations: candidate.citations,
      };
    }
    throw answerError();
  });
  return askAnswerDraftSchema.parse({ blocks, warnings: value.warnings });
}
