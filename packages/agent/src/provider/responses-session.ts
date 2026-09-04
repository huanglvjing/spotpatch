import { ERROR_CODES, SpotPatchError } from "@spotpatch/shared";

import {
  isRecord,
  jsonStringifyToolOutput,
  parseJsonRecord,
  parseToolArguments,
  requireString,
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

function responseTools(options: ProviderSessionOptions): readonly unknown[] {
  return Object.freeze(
    options.tools.map((tool) =>
      Object.freeze({
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        strict: true,
      }),
    ),
  );
}

function collectFunctionCall(
  item: Readonly<Record<string, unknown>>,
  calls: Map<string, ProviderToolCall>,
): void {
  if (item.type !== "function_call") {
    return;
  }

  const id = requireString(item, "call_id");
  const call = Object.freeze({
    id,
    name: requireString(item, "name"),
    arguments: parseToolArguments(item.arguments),
  });
  const existing = calls.get(id);

  if (
    existing !== undefined &&
    (existing.name !== call.name ||
      JSON.stringify(existing.arguments) !== JSON.stringify(call.arguments))
  ) {
    throw new SpotPatchError(ERROR_CODES.TOOL_CALL_ID_CONFLICT);
  }

  calls.set(id, call);
}

function textFromOutput(response: Readonly<Record<string, unknown>>): string {
  if (!Array.isArray(response.output)) {
    return "";
  }

  const parts: string[] = [];

  for (const output of response.output) {
    if (
      !isRecord(output) ||
      output.type !== "message" ||
      !Array.isArray(output.content)
    ) {
      continue;
    }

    for (const content of output.content) {
      if (
        isRecord(content) &&
        content.type === "output_text" &&
        typeof content.text === "string"
      ) {
        parts.push(content.text);
      }
    }
  }

  return parts.join("");
}

function callsFromOutput(
  response: Readonly<Record<string, unknown>>,
  calls: Map<string, ProviderToolCall>,
): void {
  if (!Array.isArray(response.output)) {
    return;
  }

  const outputCallIds = new Set<string>();
  for (const output of response.output) {
    if (isRecord(output)) {
      if (output.type === "function_call") {
        const callId = requireString(output, "call_id");
        if (outputCallIds.has(callId)) {
          throw new SpotPatchError(ERROR_CODES.TOOL_CALL_ID_CONFLICT);
        }
        outputCallIds.add(callId);
      }
      collectFunctionCall(output, calls);
    }
  }
}

interface ParsedResponsesTurn {
  readonly outputItems: readonly unknown[];
  readonly turn: ProviderTurn;
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function parseResponsesEvents(
  events: Awaited<ReturnType<typeof postProviderStream>>,
): ParsedResponsesTurn {
  const calls = new Map<string, ProviderToolCall>();
  const textDeltas: string[] = [];
  let completedResponse: Readonly<Record<string, unknown>> | undefined;
  let responseId: string | undefined;
  let terminal = false;

  for (const event of events) {
    if (event.data === "[DONE]") {
      continue;
    }
    if (terminal) {
      throw new SpotPatchError(ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED);
    }

    const payload = parseJsonRecord(event.data);
    const type = typeof payload.type === "string" ? payload.type : (event.event ?? "");

    if (
      type === "error" ||
      type === "response.failed" ||
      type === "response.incomplete"
    ) {
      throw new SpotPatchError(ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED);
    }

    if (type === "response.created" && isRecord(payload.response)) {
      responseId = requireString(payload.response, "id");
    } else if (type === "response.output_text.delta") {
      if (typeof payload.delta !== "string") {
        throw new SpotPatchError(ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED);
      }

      textDeltas.push(payload.delta);
    } else if (type === "response.output_item.done") {
      if (!isRecord(payload.item)) {
        throw new SpotPatchError(ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED);
      }

      collectFunctionCall(payload.item, calls);
    } else if (type === "response.completed") {
      if (!isRecord(payload.response)) {
        throw new SpotPatchError(ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED);
      }

      if (
        payload.response.status !== undefined &&
        payload.response.status !== "completed"
      ) {
        throw new SpotPatchError(ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED);
      }

      responseId = requireString(payload.response, "id");
      completedResponse = payload.response;
      callsFromOutput(payload.response, calls);
      terminal = true;
    }
  }

  if (responseId === undefined || completedResponse === undefined) {
    throw new SpotPatchError(ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED);
  }

  if (!isUnknownArray(completedResponse.output)) {
    throw new SpotPatchError(ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED);
  }

  const finalText =
    textDeltas.length > 0 ? textDeltas.join("") : textFromOutput(completedResponse);
  const toolCalls = Object.freeze([...calls.values()]);

  if (toolCalls.length === 0 && finalText.trim().length === 0) {
    throw new SpotPatchError(ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED);
  }

  return Object.freeze({
    outputItems: Object.freeze([...completedResponse.output]),
    turn: Object.freeze({ finalText, toolCalls }),
  });
}

export function createResponsesSession(
  options: ProviderSessionOptions,
): ProviderSession {
  const fetch = options.fetch ?? globalThis.fetch;
  const tools = responseTools(options);
  const inputItems: unknown[] = [
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
      inputItems.push(
        ...validatedResults.map((result) =>
          Object.freeze({
            type: "function_call_output",
            call_id: result.toolCallId,
            output: jsonStringifyToolOutput(result.output),
          }),
        ),
      );
      const body: Record<string, unknown> = {
        model: options.model.model,
        instructions: options.instructions,
        input: inputItems,
        tools,
        tool_choice: "auto",
        stream: true,
        store: false,
      };

      const parsed = parseResponsesEvents(
        await postProviderStream({
          authentication: options.provider.authentication,
          body,
          credential: options.credential,
          fetch,
          limits: options.limits,
          signal,
          url: `${options.provider.baseURL}/responses`,
        }),
      );
      inputItems.push(...parsed.outputItems);
      pendingCalls = parsed.turn.toolCalls;
      finished = pendingCalls.length === 0;
      return parsed.turn;
    },
  });
}
