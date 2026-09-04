import { describe, expect, it } from "vitest";

import {
  createOpenAICompatibleProviderSession,
  createProviderCredential,
  type ProviderSession,
  type ProviderToolResult,
} from "@spotpatch/agent";
import {
  DEFAULT_AGENT_LIMITS,
  type AiProviderProtocol,
  type ResolvedAiModelProfile,
  type ResolvedOpenAICompatibleProviderOptions,
} from "@spotpatch/shared";

import {
  ASK_READONLY_TOOLS,
  createAskPocPrompt,
  createSourceHandleId,
  runKeyReadonlyPoc,
  type AskPocSource,
} from "./key-readonly-poc.js";

const TEST_KEY = "q1-test-key-never-log";
const SOURCE = Object.freeze({
  sourceId: "source-card",
  path: "src/Card.tsx",
  targetIds: Object.freeze(["target-card"]),
  content: [
    'import type { JSX } from "react";',
    "",
    "export function Card(): JSX.Element {",
    '  return <article data-component="Card">Selected card</article>;',
    "}",
  ].join("\n"),
}) satisfies AskPocSource;

interface CapturedRequest {
  readonly authorization: string | null;
  readonly body: Readonly<Record<string, unknown>>;
  readonly url: string;
}

function sseResponse(events: readonly unknown[]): Response {
  const body = `${events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("")}data: [DONE]\n\n`;
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
    status: 200,
  });
}

function responsesToolTurn(
  responseId: string,
  callId: string,
  name: string,
  arguments_: Readonly<Record<string, unknown>>,
): Response {
  const item = {
    type: "function_call",
    call_id: callId,
    name,
    arguments: JSON.stringify(arguments_),
  };
  return sseResponse([
    { type: "response.created", response: { id: responseId } },
    { type: "response.output_item.done", item },
    { type: "response.completed", response: { id: responseId, output: [item] } },
  ]);
}

function chatToolTurn(
  callId: string,
  name: string,
  arguments_: Readonly<Record<string, unknown>>,
): Response {
  return sseResponse([
    {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: callId,
                function: { name, arguments: JSON.stringify(arguments_) },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
  ]);
}

function provider(protocol: AiProviderProtocol): Readonly<{
  model: ResolvedAiModelProfile;
  provider: ResolvedOpenAICompatibleProviderOptions;
}> {
  const model = Object.freeze({ id: "ask", label: "Ask model", model: "q1-model" });
  return Object.freeze({
    model,
    provider: Object.freeze({
      id: "q1-provider",
      type: "openai-compatible",
      label: "Q1 relay",
      protocol,
      authentication: "bearer",
      baseURL: "https://relay.example.test/v1",
      apiKeyEnv: "SPOTPATCH_Q1_KEY",
      models: Object.freeze({ ask: model }),
      defaultModel: "ask",
    }),
  });
}

function fetchQueue(
  responses: readonly Response[],
): Readonly<{ fetch: typeof globalThis.fetch; requests: CapturedRequest[] }> {
  const queue = [...responses];
  const requests: CapturedRequest[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (typeof init?.body !== "string") throw new Error("Expected a JSON body.");
    requests.push(
      Object.freeze({
        url: String(input),
        authorization: headers.get("authorization"),
        body: JSON.parse(init.body) as Readonly<Record<string, unknown>>,
      }),
    );
    const response = queue.shift();
    if (response === undefined) throw new Error("Unexpected Provider request.");
    return response;
  };
  return Object.freeze({ fetch, requests });
}

function answerArguments(handleId: string): Readonly<Record<string, unknown>> {
  return Object.freeze({
    blocks: Object.freeze([
      Object.freeze({
        kind: "paragraph",
        text: "这是 Card 组件，渲染一个 article。",
        citations: Object.freeze([Object.freeze({ handleId })]),
      }),
    ]),
    warnings: Object.freeze([]),
  });
}

describe("Q1 configured-key read-only tool loop", () => {
  it.each(["responses", "chat-completions"] as const)(
    "completes one cited answer through %s without exposing a write tool",
    async (protocol) => {
      const handleId = createSourceHandleId(SOURCE, 3, 5);
      const turns =
        protocol === "responses"
          ? [
              responsesToolTurn("response-1", "read-1", "read_source", {
                sourceId: SOURCE.sourceId,
                startLine: 3,
                endLine: 5,
              }),
              responsesToolTurn(
                "response-2",
                "submit-1",
                "submit_answer",
                answerArguments(handleId),
              ),
            ]
          : [
              chatToolTurn("read-1", "read_source", {
                sourceId: SOURCE.sourceId,
                startLine: 3,
                endLine: 5,
              }),
              chatToolTurn("submit-1", "submit_answer", answerArguments(handleId)),
            ];
      const capture = fetchQueue(turns);
      const resolved = provider(protocol);
      const prompt = createAskPocPrompt("这是什么组件？", [SOURCE]);
      const session = createOpenAICompatibleProviderSession({
        ...resolved,
        credential: createProviderCredential(TEST_KEY),
        instructions: prompt.instructions,
        userPrompt: prompt.userPrompt,
        tools: ASK_READONLY_TOOLS,
        limits: DEFAULT_AGENT_LIMITS,
        fetch: capture.fetch,
      });

      const result = await runKeyReadonlyPoc({
        session,
        signal: new AbortController().signal,
        sources: [SOURCE],
      });

      expect(result).toMatchObject({
        turns: 2,
        totalToolCalls: 2,
        issuedHandles: [handleId],
      });
      expect(result.answer.blocks[0]?.text).toContain("Card");
      expect(result.toolNames).toEqual([
        "list_sources",
        "search_sources",
        "read_source",
        "submit_answer",
      ]);
      expect(capture.requests).toHaveLength(2);
      expect(capture.requests[0]?.authorization).toBe(`Bearer ${TEST_KEY}`);
      const serializedRequests = JSON.stringify(
        capture.requests.map((request) => request.body),
      );
      expect(serializedRequests).not.toContain(TEST_KEY);
      expect(serializedRequests).not.toContain("apply_patch");
      expect(serializedRequests).not.toContain("replace_text");
      expect(serializedRequests).not.toContain("run_check");
      if (protocol === "responses") {
        expect(capture.requests.every((request) => request.body.store === false)).toBe(
          true,
        );
      }
    },
  );

  it("fails closed on a write or unknown tool call", async () => {
    const session: ProviderSession = Object.freeze({
      async next() {
        return Object.freeze({
          finalText: "",
          toolCalls: Object.freeze([
            Object.freeze({
              id: "write-1",
              name: "apply_patch",
              arguments: Object.freeze({ patch: "forbidden" }),
            }),
          ]),
        });
      },
    });

    await expect(
      runKeyReadonlyPoc({
        session,
        signal: new AbortController().signal,
        sources: [SOURCE],
      }),
    ).rejects.toThrow("ASK_POC_WRITE_OR_UNKNOWN_TOOL_REJECTED");
  });

  it("rejects free-form final text instead of silently accepting an uncited answer", async () => {
    const session: ProviderSession = Object.freeze({
      async next() {
        return Object.freeze({
          finalText: "This bypasses submit_answer.",
          toolCalls: Object.freeze([]),
        });
      },
    });

    await expect(
      runKeyReadonlyPoc({
        session,
        signal: new AbortController().signal,
        sources: [SOURCE],
      }),
    ).rejects.toThrow("ASK_POC_FREE_TEXT_REJECTED");
  });

  it("rejects fabricated citations that were never returned by a read tool", async () => {
    const session: ProviderSession = Object.freeze({
      async next() {
        return Object.freeze({
          finalText: "",
          toolCalls: Object.freeze([
            Object.freeze({
              id: "submit-1",
              name: "submit_answer",
              arguments: answerArguments("src_fabricated"),
            }),
          ]),
        });
      },
    });

    await expect(
      runKeyReadonlyPoc({
        session,
        signal: new AbortController().signal,
        sources: [SOURCE],
      }),
    ).rejects.toThrow("ASK_POC_CITATION_NOT_OBSERVED");
  });

  it("propagates cancellation without producing a fallback answer", async () => {
    const controller = new AbortController();
    controller.abort();
    const session: ProviderSession = Object.freeze({
      async next(
        _results: readonly ProviderToolResult[] | undefined,
        signal: AbortSignal,
      ) {
        if (!signal.aborted) throw new Error("The cancellation signal was lost.");
        throw new DOMException("The Ask job was cancelled.", "AbortError");
      },
    });

    await expect(
      runKeyReadonlyPoc({ session, signal: controller.signal, sources: [SOURCE] }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
