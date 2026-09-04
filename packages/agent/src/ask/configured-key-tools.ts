import {
  ASK_EXECUTOR_ANSWER_WARNING_CODES,
  askAnswerDraftSchema,
  CONTEXTUAL_ASK_LIMITS,
  redactSensitiveText,
  type AskAnswerDraft,
} from "@spotpatch/shared";
import { z } from "zod";

import type {
  ProviderToolCall,
  ProviderToolDefinition,
  ProviderToolResult,
} from "../provider/provider-types.js";
import {
  ContextualAskExecutorError,
  type ContextualAskExecutorInput,
} from "./executor-port.js";
import type { ConfiguredKeyAskObservedRange } from "./configured-key-prompt.js";

const TOOL_OUTPUT_METADATA_RESERVE_CHARACTERS = 1_024;

export const CONFIGURED_KEY_ASK_TOOL_NAMES = Object.freeze({
  listSources: "list_sources",
  searchSources: "search_sources",
  readSource: "read_source",
  submitAnswer: "submit_answer",
} as const);

const sourceIdSchema = z.string().min(1).max(CONTEXTUAL_ASK_LIMITS.maximumIdCharacters);
const listSourcesArgumentsSchema = z.strictObject({});
const searchSourcesArgumentsSchema = z.strictObject({
  query: z
    .string()
    .min(1)
    .max(CONTEXTUAL_ASK_LIMITS.maximumSearchQueryCharacters)
    .refine((query) => !query.includes("\0")),
  sourceIds: z
    .array(sourceIdSchema)
    .max(CONTEXTUAL_ASK_LIMITS.maximumReadFiles)
    .nullable()
    .optional(),
});
const readSourceArgumentsSchema = z.strictObject({
  sourceId: sourceIdSchema,
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
});

const citationJsonSchema = Object.freeze({
  type: "object",
  properties: Object.freeze({
    handleId: Object.freeze({ type: "string", minLength: 1 }),
    startLine: Object.freeze({ type: "integer", minimum: 1 }),
    endLine: Object.freeze({ type: "integer", minimum: 1 }),
  }),
  required: Object.freeze(["handleId", "startLine", "endLine"]),
  additionalProperties: false,
});
const citationListJsonSchema = Object.freeze({
  type: "array",
  maxItems: CONTEXTUAL_ASK_LIMITS.maximumSources,
  items: citationJsonSchema,
});
const paragraphJsonSchema = Object.freeze({
  type: "object",
  properties: Object.freeze({
    kind: Object.freeze({ type: "string", const: "paragraph" }),
    text: Object.freeze({
      type: "string",
      minLength: 1,
      maxLength: CONTEXTUAL_ASK_LIMITS.maximumAnswerCharacters,
    }),
    citations: citationListJsonSchema,
  }),
  required: Object.freeze(["kind", "text", "citations"]),
  additionalProperties: false,
});
const listJsonSchema = Object.freeze({
  type: "object",
  properties: Object.freeze({
    kind: Object.freeze({ type: "string", const: "list" }),
    items: Object.freeze({
      type: "array",
      minItems: 1,
      maxItems: CONTEXTUAL_ASK_LIMITS.maximumAnswerBlocks,
      items: Object.freeze({
        type: "object",
        properties: Object.freeze({
          text: Object.freeze({
            type: "string",
            minLength: 1,
            maxLength: CONTEXTUAL_ASK_LIMITS.maximumAnswerCharacters,
          }),
          citations: citationListJsonSchema,
        }),
        required: Object.freeze(["text", "citations"]),
        additionalProperties: false,
      }),
    }),
  }),
  required: Object.freeze(["kind", "items"]),
  additionalProperties: false,
});
const codeJsonSchema = Object.freeze({
  type: "object",
  properties: Object.freeze({
    kind: Object.freeze({ type: "string", const: "code" }),
    code: Object.freeze({
      type: "string",
      minLength: 1,
      maxLength: CONTEXTUAL_ASK_LIMITS.maximumAnswerCharacters,
    }),
    language: Object.freeze({
      type: "string",
      minLength: 1,
      maxLength: CONTEXTUAL_ASK_LIMITS.maximumLanguageCharacters,
    }),
    citations: citationListJsonSchema,
  }),
  required: Object.freeze(["kind", "code", "language", "citations"]),
  additionalProperties: false,
});

export const CONFIGURED_KEY_ASK_TOOLS: readonly ProviderToolDefinition[] =
  Object.freeze([
    Object.freeze({
      name: CONFIGURED_KEY_ASK_TOOL_NAMES.listSources,
      description:
        "List the source IDs already authorized for this Ask job. This does not read any additional file.",
      parameters: Object.freeze({
        type: "object",
        properties: Object.freeze({}),
        additionalProperties: false,
      }),
    }),
    Object.freeze({
      name: CONFIGURED_KEY_ASK_TOOL_NAMES.searchSources,
      description:
        "Search a bounded text query only inside the immutable authorized source snapshot.",
      parameters: Object.freeze({
        type: "object",
        properties: Object.freeze({
          query: Object.freeze({
            type: "string",
            minLength: 1,
            maxLength: CONTEXTUAL_ASK_LIMITS.maximumSearchQueryCharacters,
          }),
          sourceIds: Object.freeze({
            anyOf: Object.freeze([
              Object.freeze({
                type: "array",
                maxItems: CONTEXTUAL_ASK_LIMITS.maximumReadFiles,
                items: Object.freeze({ type: "string" }),
              }),
              Object.freeze({ type: "null" }),
            ]),
          }),
        }),
        required: Object.freeze(["query", "sourceIds"]),
        additionalProperties: false,
      }),
    }),
    Object.freeze({
      name: CONFIGURED_KEY_ASK_TOOL_NAMES.readSource,
      description:
        "Read one bounded 1-based line range from an authorized source ID in the immutable snapshot.",
      parameters: Object.freeze({
        type: "object",
        properties: Object.freeze({
          sourceId: Object.freeze({ type: "string", minLength: 1 }),
          startLine: Object.freeze({ type: "integer", minimum: 1 }),
          endLine: Object.freeze({ type: "integer", minimum: 1 }),
        }),
        required: Object.freeze(["sourceId", "startLine", "endLine"]),
        additionalProperties: false,
      }),
    }),
    Object.freeze({
      name: CONFIGURED_KEY_ASK_TOOL_NAMES.submitAnswer,
      description:
        "Submit the one structured, cited answer. This records the answer and has no project side effects.",
      parameters: Object.freeze({
        type: "object",
        properties: Object.freeze({
          blocks: Object.freeze({
            type: "array",
            minItems: 1,
            maxItems: CONTEXTUAL_ASK_LIMITS.maximumAnswerBlocks,
            items: Object.freeze({
              anyOf: Object.freeze([
                paragraphJsonSchema,
                listJsonSchema,
                codeJsonSchema,
              ]),
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
      }),
    }),
  ]);

interface ObservedRange {
  readonly startLine: number;
  readonly endLine: number;
}

export interface ConfiguredKeyAskToolController {
  executeRead(call: ProviderToolCall): ProviderToolResult;
  parseSubmission(call: ProviderToolCall): AskAnswerDraft;
}

function invalidAnswer(cause?: unknown): ContextualAskExecutorError {
  return new ContextualAskExecutorError("ASK_ANSWER_INVALID", {
    ...(cause === undefined ? {} : { cause }),
  });
}

function formatNumberedContent(
  content: string,
  startLine: number,
  maximumCharacters: number,
): Readonly<{
  content: string;
  endLine: number;
  truncated: boolean;
}> {
  const lines = content.split("\n");
  const output: string[] = [];
  let characters = 0;

  for (const [index, line] of lines.entries()) {
    const prefix = `${String(startLine + index)}: `;
    const separator = output.length === 0 ? "" : "\n";
    const available = maximumCharacters - characters - separator.length;
    if (available <= prefix.length) break;
    const complete = `${prefix}${redactSensitiveText(line)}`;
    if (complete.length > available) break;
    output.push(`${separator}${complete}`);
    characters += separator.length + complete.length;
  }

  if (output.length === 0) {
    throw new ContextualAskExecutorError("ASK_LIMIT_EXCEEDED");
  }
  return Object.freeze({
    content: output.join(""),
    endLine: startLine + output.length - 1,
    truncated: output.length < lines.length || characters >= maximumCharacters,
  });
}

function answerCitations(answer: AskAnswerDraft) {
  return answer.blocks.flatMap((block) =>
    block.kind === "list"
      ? block.items.flatMap((item) => item.citations)
      : block.citations,
  );
}

export function createConfiguredKeyAskToolController(
  input: ContextualAskExecutorInput,
  maximumToolOutputCharacters: number,
  initialObservedRanges: readonly ConfiguredKeyAskObservedRange[],
): ConfiguredKeyAskToolController {
  const sources = new Map(
    input.grant.sources.map((source) => [source.handleId, source]),
  );
  const observed = new Map<string, ObservedRange[]>();
  const observe = (sourceId: string, startLine: number, endLine: number): void => {
    const ranges = observed.get(sourceId) ?? [];
    ranges.push(Object.freeze({ startLine, endLine }));
    observed.set(sourceId, ranges);
  };

  for (const range of initialObservedRanges) {
    const source = sources.get(range.handleId);
    if (
      source === undefined ||
      range.startLine < 1 ||
      range.endLine < range.startLine ||
      range.endLine > source.lineCount
    ) {
      throw new ContextualAskExecutorError("ASK_SOURCE_SCOPE_DENIED");
    }
    observe(range.handleId, range.startLine, range.endLine);
  }

  const requireSource = (sourceId: string) => {
    const source = sources.get(sourceId);
    if (source === undefined) {
      throw new ContextualAskExecutorError("ASK_SOURCE_SCOPE_DENIED");
    }
    return source;
  };
  const outputContentLimit = Math.max(
    1,
    maximumToolOutputCharacters - TOOL_OUTPUT_METADATA_RESERVE_CHARACTERS,
  );

  return Object.freeze({
    executeRead(call: ProviderToolCall): ProviderToolResult {
      let output: unknown;
      switch (call.name) {
        case CONFIGURED_KEY_ASK_TOOL_NAMES.listSources: {
          const parsed = listSourcesArgumentsSchema.safeParse(call.arguments);
          if (!parsed.success) throw invalidAnswer(parsed.error);
          output = Object.freeze({
            sources: Object.freeze(
              input.snapshot.manifest().map((source) =>
                Object.freeze({
                  sourceId: source.handleId,
                  label: source.label,
                  relativePath: source.relativePath,
                  lineCount: source.lineCount,
                  confidence: source.confidence,
                  targetIds: source.targetIds,
                }),
              ),
            ),
            truncated: input.grant.truncated,
          });
          break;
        }
        case CONFIGURED_KEY_ASK_TOOL_NAMES.searchSources: {
          const parsed = searchSourcesArgumentsSchema.safeParse(call.arguments);
          if (!parsed.success) throw invalidAnswer(parsed.error);
          const selected =
            parsed.data.sourceIds === undefined || parsed.data.sourceIds === null
              ? undefined
              : new Set(parsed.data.sourceIds);
          if (selected !== undefined) {
            for (const sourceId of selected) requireSource(sourceId);
          }
          const matches = input.snapshot
            .search(parsed.data.query)
            .filter((match) => selected === undefined || selected.has(match.handleId));
          for (const match of matches) observe(match.handleId, match.line, match.line);
          output = Object.freeze({
            matches: Object.freeze(
              matches.map((match) =>
                Object.freeze({
                  sourceId: match.handleId,
                  line: match.line,
                  preview: redactSensitiveText(match.preview),
                }),
              ),
            ),
            truncated: matches.length >= CONTEXTUAL_ASK_LIMITS.maximumSearchResults,
          });
          break;
        }
        case CONFIGURED_KEY_ASK_TOOL_NAMES.readSource: {
          const parsed = readSourceArgumentsSchema.safeParse(call.arguments);
          if (!parsed.success) throw invalidAnswer(parsed.error);
          const source = requireSource(parsed.data.sourceId);
          if (
            parsed.data.endLine < parsed.data.startLine ||
            parsed.data.endLine > source.lineCount
          ) {
            output = Object.freeze({
              ok: false,
              errorCode: "invalid-line-range",
              retryable: true,
              sourceId: source.handleId,
              lineCount: source.lineCount,
            });
            break;
          }
          const result = input.snapshot.read(source.handleId, {
            startLine: parsed.data.startLine,
            endLine: parsed.data.endLine,
          });
          const formatted = formatNumberedContent(
            result.content,
            result.startLine,
            outputContentLimit,
          );
          observe(source.handleId, result.startLine, formatted.endLine);
          output = Object.freeze({
            ok: true,
            sourceId: source.handleId,
            startLine: result.startLine,
            endLine: formatted.endLine,
            content: formatted.content,
            truncated: formatted.truncated,
          });
          break;
        }
        default:
          throw new ContextualAskExecutorError("ASK_WRITE_ATTEMPTED");
      }
      return Object.freeze({ toolCallId: call.id, output });
    },

    parseSubmission(call: ProviderToolCall): AskAnswerDraft {
      const parsed = askAnswerDraftSchema.safeParse(call.arguments);
      if (!parsed.success) throw invalidAnswer(parsed.error);
      for (const citation of answerCitations(parsed.data)) {
        requireSource(citation.handleId);
        const ranges = observed.get(citation.handleId) ?? [];
        if (
          !ranges.some(
            (range) =>
              citation.startLine >= range.startLine &&
              citation.endLine <= range.endLine,
          )
        ) {
          throw invalidAnswer();
        }
      }
      return parsed.data;
    },
  });
}
