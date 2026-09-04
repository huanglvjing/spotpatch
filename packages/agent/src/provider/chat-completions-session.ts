import { ERROR_CODES, SpotPatchError } from "@spotpatch/shared";

import {
  assertUniqueToolCallIds,
  isRecord,
  jsonStringifyToolOutput,
  parseJsonRecord,
  parseToolArguments,
  validateToolResults,
} from "./provider-parsing.js";
import { postProviderStream } from "./provider-transport.js";
import type {
  ProviderSession,
  ProviderSessionOptions,
  ProviderToolCall,
  ProviderToolResult,
  ProviderTurn,
} from "./provider-types.js";

interface MutableToolCall {
  arguments: string;
  id?: string;
  name?: string;
}

interface ParsedChatTurn {
  readonly assistantMessage: Readonly<Record<string, unknown>>;
  readonly turn: ProviderTurn;
}

function chatTools(options: ProviderSessionOptions): readonly unknown[] {
  return Object.freeze(
    options.tools.map((tool) =>
      Object.freeze({
        type: "function",
        function: Object.freeze({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          strict: true,
        }),
      }),
    ),
  );
}

function mergeToolCallDelta(value: unknown, calls: Map<number, MutableToolCall>): void {
  if (
    !isRecord(value) ||
    typeof value.index !== "number" ||
    !Number.isSafeInteger(value.index) ||
    value.index < 0
  ) {
    throw new SpotPatchError(ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED);
  }

  const index = value.index;
  const call = calls.get(index) ?? { arguments: "" };

  if (typeof value.id === "string") {
    if (call.id !== undefined && call.id !== value.id) {
      throw new SpotPatchError(ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED);
    }

    call.id = value.id;
  }

  if (value.function !== undefined) {
    if (!isRecord(value.function)) {
      throw new SpotPatchError(ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED);
    }

    if (typeof value.function.name === "string") {
      if (call.name !== undefined && call.name !== value.function.name) {
        throw new SpotPatchError(ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED);
      }

      call.name = value.function.name;
    }

    if (typeof value.function.arguments === "string") {
      call.arguments += value.function.arguments;
    }
  }

  calls.set(index, call);
}

function finalizeToolCalls(
  calls: ReadonlyMap<number, MutableToolCall>,
): readonly ProviderToolCall[] {
  return Object.freeze(
    [...calls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, call]) => {
        if (call.id === undefined || call.name === undefined) {
          throw new SpotPatchError(ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED);
        }

        return Object.freeze({
          id: call.id,
          name: call.name,
          arguments: parseToolArguments(call.arguments),
        });
      }),
  );
}

function parseChatEvents(
  events: Awaited<ReturnType<typeof postProviderStream>>,
): ParsedChatTurn {
  const content: string[] = [];
  const calls = new Map<number, MutableToolCall>();
  let done = false;
  let finishReason: string | null | undefined;
  let terminal = false;

  for (const event of events) {
    if (event.data === "[DONE]") {
      done = true;
      continue;
    }
    if (terminal || done) {
      throw new SpotPatchError(ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED);
    }

    const payload = parseJsonRecord(event.data);

    if (!Array.isArray(payload.choices) || payload.choices.length === 0) {
      if (payload.error !== undefined) {
        throw new SpotPatchError(ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED);
      }

      continue;
    }

    for (const choice of payload.choices) {
      if (!isRecord(choice) || !isRecord(choice.delta)) {
        throw new SpotPatchError(ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED);
      }

      if (typeof choice.delta.content === "string") {
        content.push(choice.delta.content);
      } else if (choice.delta.content !== undefined && choice.delta.content !== null) {
        throw new SpotPatchError(ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED);
      }

      if (choice.delta.tool_calls !== undefined) {
        if (!Array.isArray(choice.delta.tool_calls)) {
          throw new SpotPatchError(ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED);
        }

        for (const toolCall of choice.delta.tool_calls) {
          mergeToolCallDelta(toolCall, calls);
        }
      }

      if (typeof choice.finish_reason === "string") {
        finishReason = choice.finish_reason;
        terminal = true;
      } else if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
        throw new SpotPatchError(ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED);
      }
    }
  }

  if (!done || (finishReason !== "stop" && finishReason !== "tool_calls")) {
    throw new SpotPatchError(ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED);
  }

  const finalText = content.join("");
  const toolCalls = finalizeToolCalls(calls);
  assertUniqueToolCallIds(toolCalls);

  if (toolCalls.length === 0 && finalText.trim().length === 0) {
    throw new SpotPatchError(ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED);
  }

  const assistantToolCalls = toolCalls.map((call) => ({
    id: call.id,
    type: "function",
    function: {
      name: call.name,
      arguments: JSON.stringify(call.arguments),
    },
  }));

  return Object.freeze({
    assistantMessage: Object.freeze({
      role: "assistant",
      content: finalText.length === 0 ? null : finalText,
      ...(assistantToolCalls.length === 0 ? {} : { tool_calls: assistantToolCalls }),
    }),
    turn: Object.freeze({ finalText, toolCalls }),
  });
}

export function createChatCompletionsSession(
  options: ProviderSessionOptions,
): ProviderSession {
  const fetch = options.fetch ?? globalThis.fetch;
  const tools = chatTools(options);
  const messages: Readonly<Record<string, unknown>>[] = [
    Object.freeze({ role: "system", content: options.instructions }),
    Object.freeze({ role: "user", content: options.userPrompt }),
  ];
  let pendingCalls: readonly ProviderToolCall[] = Object.freeze([]);
  let finished = false;

  return Object.freeze({
    async next(
      toolResults: readonly ProviderToolResult[] | undefined,
      signal: AbortSignal,
    ): Promise<ProviderTurn> {
      if (finished) {
        throw new SpotPatchError(ERROR_CODES.INTERNAL_ERROR);
      }

      const validatedResults = validateToolResults(pendingCalls, toolResults);

      for (const result of validatedResults) {
        messages.push(
          Object.freeze({
            role: "tool",
            tool_call_id: result.toolCallId,
            content: jsonStringifyToolOutput(result.output),
          }),
        );
      }

      const parsed = parseChatEvents(
        await postProviderStream({
          authentication: options.provider.authentication,
          body: {
            model: options.model.model,
            messages,
            tools,
            tool_choice: "auto",
            stream: true,
          },
          credential: options.credential,
          fetch,
          limits: options.limits,
          signal,
          url: `${options.provider.baseURL}/chat/completions`,
        }),
      );
      messages.push(parsed.assistantMessage);
      pendingCalls = parsed.turn.toolCalls;
      finished = pendingCalls.length === 0;
      return parsed.turn;
    },
  });
}
