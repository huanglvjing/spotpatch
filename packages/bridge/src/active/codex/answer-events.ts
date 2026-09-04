import { ContextualAskExecutorError } from "@spotpatch/agent";
import {
  ASK_EXECUTOR_ANSWER_WARNING_CODES,
  CONTEXTUAL_ASK_LIMITS,
  askAnswerDraftSchema,
  type AskAnswerDraft,
} from "@spotpatch/shared";

type JsonRecord = Readonly<Record<string, unknown>>;
type TerminalTurnStatus = "completed" | "failed" | "interrupted";

const SAFE_ITEM_TYPES = new Set([
  "commandExecution",
  "contextCompaction",
  "plan",
  "reasoning",
  "userMessage",
]);
const FORBIDDEN_ITEM_TYPES = new Set([
  "collabToolCall",
  "dynamicToolCall",
  "imageView",
  "mcpToolCall",
  "webSearch",
]);
const MAXIMUM_DELTA_CHARACTERS = CONTEXTUAL_ASK_LIMITS.maximumAnswerCharacters * 2;
const CORRELATED_METHODS = new Set([
  "item/agentMessage/delta",
  "item/completed",
  "item/started",
  "turn/completed",
  "turn/diff/updated",
  "turn/started",
]);

export const MANAGED_CODEX_ASK_OUTPUT_SCHEMA = Object.freeze({
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

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: JsonRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => key in value);
}

function parseManagedCodexAnswer(text: string): AskAnswerDraft {
  const value: unknown = JSON.parse(text);
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

/** Detects write-capable activity even after the answer promise has settled. */
export function managedCodexActivityViolation(
  method: string,
  params: unknown,
): "ASK_PROTOCOL_INCOMPATIBLE" | "ASK_WRITE_ATTEMPTED" | undefined {
  if (!isRecord(params)) return undefined;
  if (method === "turn/diff/updated") {
    return typeof params.diff === "string" && params.diff.length > 0
      ? "ASK_WRITE_ATTEMPTED"
      : undefined;
  }
  if (
    (method !== "item/started" && method !== "item/completed") ||
    !isRecord(params.item)
  ) {
    return undefined;
  }
  if (params.item.type === "fileChange") return "ASK_WRITE_ATTEMPTED";
  return typeof params.item.type === "string" &&
    FORBIDDEN_ITEM_TYPES.has(params.item.type)
    ? "ASK_PROTOCOL_INCOMPATIBLE"
    : undefined;
}

function protocolError(cause?: unknown): ContextualAskExecutorError {
  return new ContextualAskExecutorError("ASK_PROTOCOL_INCOMPATIBLE", {
    ...(cause === undefined ? {} : { cause }),
  });
}

function writeError(): ContextualAskExecutorError {
  return new ContextualAskExecutorError("ASK_WRITE_ATTEMPTED");
}

function answerError(cause?: unknown): ContextualAskExecutorError {
  return new ContextualAskExecutorError("ASK_ANSWER_INVALID", {
    ...(cause === undefined ? {} : { cause }),
  });
}

interface CorrelatedEvent {
  readonly method: string;
  readonly params: JsonRecord;
  readonly turnId: string;
}

export interface ManagedCodexAnswerCollector {
  readonly result: Promise<AskAnswerDraft>;
  fail(error: ContextualAskExecutorError): void;
  handleNotification(method: string, params: unknown): void;
  setTurnId(turnId: string): void;
}

export function createManagedCodexAnswerCollector(
  threadId: string,
): ManagedCodexAnswerCollector {
  let turnId: string | undefined;
  let started = false;
  let terminalStatus: TerminalTurnStatus | undefined;
  let terminalCause: unknown;
  let finalText: string | undefined;
  let finalItemId: string | undefined;
  let deltaCharacters = 0;
  let settled = false;
  const pending: { readonly method: string; readonly params: JsonRecord }[] = [];
  const completedItems = new Map<string, string>();
  let resolveResult: ((answer: AskAnswerDraft) => void) | undefined;
  let rejectResult: ((error: ContextualAskExecutorError) => void) | undefined;
  const result = new Promise<AskAnswerDraft>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const fail = (error: ContextualAskExecutorError): void => {
    if (settled) return;
    settled = true;
    rejectResult?.(error);
  };

  const completeIfReady = (): void => {
    if (settled || terminalStatus === undefined) return;
    if (terminalStatus !== "completed") {
      fail(
        new ContextualAskExecutorError(
          terminalStatus === "interrupted"
            ? "ASK_CANCELLED"
            : "ASK_EXECUTOR_UNAVAILABLE",
          terminalCause === undefined ? {} : { cause: terminalCause },
        ),
      );
      return;
    }
    if (!started) return;
    if (finalText === undefined) {
      fail(answerError());
      return;
    }
    try {
      const answer = parseManagedCodexAnswer(finalText);
      settled = true;
      resolveResult?.(answer);
    } catch (error: unknown) {
      fail(answerError(error));
    }
  };

  const correlate = (
    method: string,
    value: JsonRecord,
  ): CorrelatedEvent | undefined => {
    if (value.threadId !== threadId) return undefined;
    const eventTurnId =
      typeof value.turnId === "string"
        ? value.turnId
        : (method === "turn/started" || method === "turn/completed") &&
            isRecord(value.turn) &&
            typeof value.turn.id === "string"
          ? value.turn.id
          : undefined;
    if (eventTurnId === undefined || eventTurnId.length === 0) {
      throw protocolError();
    }
    if (turnId === undefined) {
      pending.push(Object.freeze({ method, params: value }));
      return undefined;
    }
    if (eventTurnId !== turnId) return undefined;
    return Object.freeze({ method, params: value, turnId: eventTurnId });
  };

  const accept = (event: CorrelatedEvent): void => {
    if (settled) return;
    const { method, params } = event;
    const violation = managedCodexActivityViolation(method, params);
    if (violation === "ASK_WRITE_ATTEMPTED") throw writeError();
    if (violation === "ASK_PROTOCOL_INCOMPATIBLE") throw protocolError();
    if (method === "turn/started" || method === "turn/completed") {
      if (!isRecord(params.turn) || params.turn.id !== event.turnId) {
        throw protocolError();
      }
      const status = params.turn.status;
      if (method === "turn/started") {
        if (status !== "inProgress") throw protocolError();
        started = true;
      } else {
        if (status !== "completed" && status !== "failed" && status !== "interrupted") {
          throw protocolError();
        }
        if (terminalStatus !== undefined && terminalStatus !== status) {
          throw protocolError();
        }
        terminalStatus = status;
        terminalCause = params.turn.error;
      }
      completeIfReady();
      return;
    }
    if (method === "turn/diff/updated") {
      if (typeof params.diff !== "string") {
        throw protocolError();
      }
      return;
    }
    if (method === "item/agentMessage/delta") {
      if (typeof params.delta !== "string") throw protocolError();
      deltaCharacters += params.delta.length;
      if (deltaCharacters > MAXIMUM_DELTA_CHARACTERS) {
        throw new ContextualAskExecutorError("ASK_LIMIT_EXCEEDED");
      }
      return;
    }
    if (method !== "item/started" && method !== "item/completed") return;
    if (!isRecord(params.item)) throw protocolError();
    const item = params.item;
    const itemId = item.id;
    if (typeof itemId !== "string") throw protocolError();
    if (typeof item.type !== "string") throw protocolError();
    if (item.type !== "agentMessage") {
      if (!SAFE_ITEM_TYPES.has(item.type)) throw protocolError();
      return;
    }
    if (method === "item/started") return;
    const itemText = item.text;
    if (typeof itemText !== "string") throw protocolError();
    const serialized = JSON.stringify(item);
    const previous = completedItems.get(itemId);
    if (previous !== undefined) {
      if (previous !== serialized) throw protocolError();
      return;
    }
    completedItems.set(itemId, serialized);
    if (
      item.phase !== undefined &&
      item.phase !== null &&
      item.phase !== "final_answer"
    ) {
      if (item.phase !== "commentary") throw protocolError();
      return;
    }
    if (finalItemId !== undefined && finalItemId !== itemId) {
      throw answerError();
    }
    finalItemId = itemId;
    finalText = itemText;
    completeIfReady();
  };

  const handleNotification = (method: string, params: unknown): void => {
    if (settled) return;
    try {
      if (!CORRELATED_METHODS.has(method)) return;
      if (!isRecord(params)) {
        throw protocolError();
      }
      const event = correlate(method, params);
      if (event !== undefined) accept(event);
    } catch (error: unknown) {
      fail(error instanceof ContextualAskExecutorError ? error : protocolError(error));
    }
  };

  return Object.freeze({
    result,
    fail,
    handleNotification,
    setTurnId(nextTurnId: string) {
      if (settled) return;
      if (nextTurnId.length === 0 || (turnId !== undefined && turnId !== nextTurnId)) {
        fail(protocolError());
        return;
      }
      turnId = nextTurnId;
      const events = pending.splice(0);
      try {
        for (const event of events) {
          const correlated = correlate(event.method, event.params);
          if (correlated !== undefined) accept(correlated);
        }
      } catch (error: unknown) {
        fail(
          error instanceof ContextualAskExecutorError ? error : protocolError(error),
        );
      }
    },
  });
}
