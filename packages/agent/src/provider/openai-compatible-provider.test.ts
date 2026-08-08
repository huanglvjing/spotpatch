import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_AGENT_LIMITS,
  ERROR_CODES,
  type AiProviderProtocol,
  type ResolvedAiModelProfile,
  type ResolvedOpenAICompatibleProviderOptions,
} from "@spotpatch/shared";

import { probeProviderCapability } from "./capability-probe.js";
import { createOpenAICompatibleProviderSession } from "./openai-compatible-provider.js";
import { createProviderCredential } from "./provider-credential.js";

const encoder = new TextEncoder();
const TEST_KEY = "synthetic-provider-credential-do-not-use";

interface CapturedRequest {
  readonly authorization: string | null;
  readonly apiKey: string | null;
  readonly body: Readonly<Record<string, unknown>>;
  readonly redirect: RequestRedirect | undefined;
  readonly url: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRequestBody(body: BodyInit | null | undefined) {
  if (typeof body !== "string") {
    throw new Error("Expected a JSON string request body.");
  }

  const value = JSON.parse(body) as unknown;

  if (!isRecord(value)) {
    throw new Error("Expected a JSON object request body.");
  }

  return value;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }

  return input instanceof URL ? input.href : input.url;
}

function createFetchQueue(responses: readonly Response[]) {
  const queue = [...responses];
  const requests: CapturedRequest[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation((input, init) => {
    const response = queue.shift();

    if (response === undefined) {
      return Promise.reject(new Error("Unexpected provider request."));
    }

    requests.push(
      Object.freeze({
        authorization: new Headers(init?.headers).get("authorization"),
        apiKey: new Headers(init?.headers).get("x-api-key"),
        body: parseRequestBody(init?.body),
        redirect: init?.redirect,
        url: requestUrl(input),
      }),
    );
    return Promise.resolve(response);
  });

  return { fetch, requests };
}

function byteStream(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }

      controller.close();
    },
  });
}

function sseResponse(source: string): Response {
  const bytes = encoder.encode(source);
  const split = Math.max(1, Math.floor(bytes.length / 3));

  return new Response(
    byteStream([
      bytes.slice(0, split),
      bytes.slice(split, split * 2),
      bytes.slice(split * 2),
    ]),
    { headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
  );
}

function event(type: string, payload: Readonly<Record<string, unknown>>): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
}

function responsesToolTurn(
  responseId: string,
  callId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
): Response {
  const item = {
    type: "function_call",
    call_id: callId,
    name,
    arguments: JSON.stringify(args),
  };

  return sseResponse(
    event("response.created", { response: { id: responseId } }) +
      event("response.output_item.done", { item }) +
      event("response.completed", {
        response: { id: responseId, status: "completed", output: [item] },
      }),
  );
}

function responsesTextTurn(responseId: string, text: string): Response {
  const output = [
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text }],
    },
  ];

  return sseResponse(
    event("response.created", { response: { id: responseId } }) +
      event("response.output_text.delta", { delta: text }) +
      event("response.completed", {
        response: { id: responseId, status: "completed", output },
      }),
  );
}

function chatData(payload: Readonly<Record<string, unknown>>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function chatToolTurn(callId: string, name: string, argumentsJson: string): Response {
  const midpoint = Math.max(1, Math.floor(argumentsJson.length / 2));

  return sseResponse(
    chatData({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: callId,
                type: "function",
                function: {
                  name,
                  arguments: argumentsJson.slice(0, midpoint),
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    }) +
      chatData({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: argumentsJson.slice(midpoint) },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      }) +
      chatData({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }) +
      "data: [DONE]\n\n",
  );
}

function chatToolCallsTurn(
  calls: readonly Readonly<{
    id: string;
    name: string;
    argumentsJson: string;
  }>[],
): Response {
  return sseResponse(
    chatData({
      choices: [
        {
          delta: {
            tool_calls: calls.map((call, index) => ({
              index,
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: call.argumentsJson },
            })),
          },
          finish_reason: null,
        },
      ],
    }) +
      chatData({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }) +
      "data: [DONE]\n\n",
  );
}

function chatTextTurn(text: string): Response {
  return sseResponse(
    chatData({
      choices: [{ delta: { content: text }, finish_reason: null }],
    }) +
      chatData({ choices: [{ delta: {}, finish_reason: "stop" }] }) +
      "data: [DONE]\n\n",
  );
}

function provider(
  protocol: AiProviderProtocol,
  authentication: "bearer" | "x-api-key" = "bearer",
): ResolvedOpenAICompatibleProviderOptions {
  return Object.freeze({
    id: "relay",
    type: "openai-compatible",
    label: "Test relay",
    protocol,
    authentication,
    baseURL: "https://relay.example.test/v1",
    apiKeyEnv: "SPOTPATCH_TEST_API_KEY",
    models: Object.freeze({
      coding: Object.freeze({
        id: "coding",
        label: "Coding model",
        model: "provider-coding-model",
      }),
    }),
    defaultModel: "coding",
  });
}

function model(
  source: ResolvedOpenAICompatibleProviderOptions,
): ResolvedAiModelProfile {
  const value = source.models.coding;

  if (value === undefined) {
    throw new Error("Missing model fixture.");
  }

  return value;
}

function toolDefinition() {
  return Object.freeze({
    name: "read_file",
    description: "Reads one source file.",
    parameters: Object.freeze({
      type: "object",
      properties: Object.freeze({ path: Object.freeze({ type: "string" }) }),
      required: Object.freeze(["path"]),
      additionalProperties: false,
    }),
  });
}

describe("OpenAI-compatible provider", () => {
  it("replays Responses output items in memory when store is disabled", async () => {
    const source = provider("responses");
    const { fetch, requests } = createFetchQueue([
      responsesToolTurn("resp-1", "call-1", "read_file", {
        path: "src/App.tsx",
      }),
      responsesTextTurn("resp-2", "Change prepared."),
    ]);
    const session = createOpenAICompatibleProviderSession({
      provider: source,
      model: model(source),
      credential: createProviderCredential(TEST_KEY),
      instructions: "Use only the declared tools.",
      userPrompt: "Update the selected element.",
      tools: [toolDefinition()],
      limits: DEFAULT_AGENT_LIMITS,
      fetch,
    });
    const signal = new AbortController().signal;
    const first = await session.next(undefined, signal);
    const second = await session.next(
      [{ toolCallId: "call-1", output: { content: "source" } }],
      signal,
    );

    expect(first).toEqual({
      finalText: "",
      toolCalls: [
        {
          id: "call-1",
          name: "read_file",
          arguments: { path: "src/App.tsx" },
        },
      ],
    });
    expect(second).toEqual({ finalText: "Change prepared.", toolCalls: [] });
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      url: "https://relay.example.test/v1/responses",
      authorization: `Bearer ${TEST_KEY}`,
      redirect: "error",
    });
    expect(requests[0]?.body).toMatchObject({
      model: "provider-coding-model",
      stream: true,
      store: false,
      input: [{ role: "user", content: "Update the selected element." }],
    });
    expect(requests[1]?.body).not.toHaveProperty("previous_response_id");
    expect(requests[1]?.body.input).toEqual([
      { role: "user", content: "Update the selected element." },
      {
        type: "function_call",
        call_id: "call-1",
        name: "read_file",
        arguments: '{"path":"src/App.tsx"}',
      },
      {
        type: "function_call_output",
        call_id: "call-1",
        output: '{"content":"source"}',
      },
    ]);
    expect(JSON.stringify(requests.map((request) => request.body))).not.toContain(
      TEST_KEY,
    );
  });

  it("reconstructs fragmented Chat Completions tool calls and continuation", async () => {
    const source = provider("chat-completions");
    const { fetch, requests } = createFetchQueue([
      chatToolTurn("call-chat-1", "read_file", JSON.stringify({ path: "src/App.tsx" })),
      chatTextTurn("Change prepared."),
    ]);
    const session = createOpenAICompatibleProviderSession({
      provider: source,
      model: model(source),
      credential: createProviderCredential(TEST_KEY),
      instructions: "Use only the declared tools.",
      userPrompt: "Update the selected element.",
      tools: [toolDefinition()],
      limits: DEFAULT_AGENT_LIMITS,
      fetch,
    });
    const signal = new AbortController().signal;
    const first = await session.next(undefined, signal);
    const second = await session.next(
      [{ toolCallId: "call-chat-1", output: { content: "source" } }],
      signal,
    );

    expect(first.toolCalls).toEqual([
      {
        id: "call-chat-1",
        name: "read_file",
        arguments: { path: "src/App.tsx" },
      },
    ]);
    expect(second).toEqual({ finalText: "Change prepared.", toolCalls: [] });
    expect(requests[0]?.url).toBe("https://relay.example.test/v1/chat/completions");
    expect(requests[1]?.body.messages).toEqual([
      { role: "system", content: "Use only the declared tools." },
      { role: "user", content: "Update the selected element." },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call-chat-1",
            type: "function",
            function: {
              name: "read_file",
              arguments: '{"path":"src/App.tsx"}',
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call-chat-1",
        content: '{"content":"source"}',
      },
    ]);
  });

  it.each(["responses", "chat-completions"] as const)(
    "accepts a %s relay reusing a provider call ID in a later turn",
    async (protocol) => {
      const source = provider(protocol);
      const turns =
        protocol === "responses"
          ? [
              responsesToolTurn("resp-1", "reused-call", "read_file", {
                path: "src/App.tsx",
              }),
              responsesToolTurn("resp-2", "reused-call", "read_file", {
                path: "src/other.ts",
              }),
              responsesTextTurn("resp-3", "Change prepared."),
            ]
          : [
              chatToolTurn(
                "reused-call",
                "read_file",
                JSON.stringify({ path: "src/App.tsx" }),
              ),
              chatToolTurn(
                "reused-call",
                "read_file",
                JSON.stringify({ path: "src/other.ts" }),
              ),
              chatTextTurn("Change prepared."),
            ];
      const { fetch } = createFetchQueue(turns);
      const session = createOpenAICompatibleProviderSession({
        provider: source,
        model: model(source),
        credential: createProviderCredential(TEST_KEY),
        instructions: "Use only the declared tools.",
        userPrompt: "Inspect both files.",
        tools: [toolDefinition()],
        limits: DEFAULT_AGENT_LIMITS,
        fetch,
      });
      const signal = new AbortController().signal;
      const first = await session.next(undefined, signal);
      const second = await session.next(
        [{ toolCallId: "reused-call", output: { content: "first" } }],
        signal,
      );
      const third = await session.next(
        [{ toolCallId: "reused-call", output: { content: "second" } }],
        signal,
      );

      expect(first.toolCalls[0]).toMatchObject({
        id: "reused-call",
        arguments: { path: "src/App.tsx" },
      });
      expect(second.toolCalls[0]).toMatchObject({
        id: "reused-call",
        arguments: { path: "src/other.ts" },
      });
      expect(third).toEqual({ finalText: "Change prepared.", toolCalls: [] });
    },
  );

  it("rejects conflicting Chat Completions call IDs within one turn", async () => {
    const source = provider("chat-completions");
    const { fetch } = createFetchQueue([
      chatToolCallsTurn([
        {
          id: "duplicate-call",
          name: "read_file",
          argumentsJson: JSON.stringify({ path: "src/App.tsx" }),
        },
        {
          id: "duplicate-call",
          name: "read_file",
          argumentsJson: JSON.stringify({ path: "src/other.ts" }),
        },
      ]),
    ]);
    const session = createOpenAICompatibleProviderSession({
      provider: source,
      model: model(source),
      credential: createProviderCredential(TEST_KEY),
      instructions: "Use only the declared tools.",
      userPrompt: "Inspect the source.",
      tools: [toolDefinition()],
      limits: DEFAULT_AGENT_LIMITS,
      fetch,
    });

    await expect(
      session.next(undefined, new AbortController().signal),
    ).rejects.toMatchObject({ code: ERROR_CODES.TOOL_CALL_ID_CONFLICT });
  });

  it("reports malformed tool argument JSON separately from relay protocol errors", async () => {
    const source = provider("chat-completions");
    const { fetch } = createFetchQueue([
      chatToolTurn("invalid-arguments", "read_file", '{"path":'),
    ]);
    const session = createOpenAICompatibleProviderSession({
      provider: source,
      model: model(source),
      credential: createProviderCredential(TEST_KEY),
      instructions: "Use only the declared tools.",
      userPrompt: "Inspect the source.",
      tools: [toolDefinition()],
      limits: DEFAULT_AGENT_LIMITS,
      fetch,
    });

    await expect(
      session.next(undefined, new AbortController().signal),
    ).rejects.toMatchObject({ code: ERROR_CODES.TOOL_ARGUMENTS_INVALID });
  });

  it("uses x-api-key authentication without also sending a Bearer credential", async () => {
    const source = provider("chat-completions", "x-api-key");
    const { fetch, requests } = createFetchQueue([chatTextTurn("Ready.")]);
    const session = createOpenAICompatibleProviderSession({
      provider: source,
      model: model(source),
      credential: createProviderCredential(TEST_KEY),
      instructions: "Use only the declared tools.",
      userPrompt: "Update the selected element.",
      tools: [toolDefinition()],
      limits: DEFAULT_AGENT_LIMITS,
      fetch,
    });

    await session.next(undefined, new AbortController().signal);

    expect(requests[0]).toMatchObject({
      apiKey: TEST_KEY,
      authorization: null,
    });
  });

  it.each(["responses", "chat-completions"] as const)(
    "passes the %s capability probe only after tool-result continuation",
    async (protocol) => {
      const source = provider(protocol);
      const toolTurn =
        protocol === "responses"
          ? responsesToolTurn("probe-1", "probe-call", "spotpatch_capability_probe", {
              token: "spotpatch-ready-v1",
            })
          : chatToolTurn(
              "probe-call",
              "spotpatch_capability_probe",
              '{"token":"spotpatch-ready-v1"}',
            );
      const textTurn =
        protocol === "responses"
          ? responsesTextTurn("probe-2", "Capability confirmed.")
          : chatTextTurn("Capability confirmed.");
      const { fetch } = createFetchQueue([toolTurn, textTurn]);

      await expect(
        probeProviderCapability({
          provider: source,
          modelProfileId: "coding",
          limits: DEFAULT_AGENT_LIMITS,
          credential: createProviderCredential(TEST_KEY),
          fetch,
          now: () => "2026-08-07T00:00:00.000Z",
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual({
        providerProfileId: "relay",
        providerLabel: "Test relay",
        modelProfileId: "coding",
        modelLabel: "Coding model",
        protocol,
        state: "agent-ready",
        authenticated: true,
        modelAvailable: true,
        toolCalling: true,
        toolResultContinuation: true,
        streaming: true,
        checkedAt: "2026-08-07T00:00:00.000Z",
      });
    },
  );

  it("rejects a model that returns text instead of the required probe tool", async () => {
    const source = provider("responses");
    const { fetch } = createFetchQueue([
      responsesTextTurn("probe-no-tool", "I cannot call tools."),
    ]);

    await expect(
      probeProviderCapability({
        provider: source,
        modelProfileId: "coding",
        limits: DEFAULT_AGENT_LIMITS,
        credential: createProviderCredential(TEST_KEY),
        fetch,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.MODEL_TOOL_CALL_UNSUPPORTED,
    });
  });

  it.each([
    [401, ERROR_CODES.PROVIDER_AUTH_FAILED],
    [403, ERROR_CODES.PROVIDER_AUTH_FAILED],
    [404, ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED],
    [429, ERROR_CODES.PROVIDER_RATE_LIMITED],
    [500, ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED],
  ] as const)(
    "maps provider HTTP %i without exposing its body",
    async (status, code) => {
      const source = provider("responses");
      const bodySecret = `provider-body-${String(status)}-${TEST_KEY}`;
      const { fetch } = createFetchQueue([
        new Response(bodySecret, { status, headers: { "Content-Type": "text/plain" } }),
      ]);
      const session = createOpenAICompatibleProviderSession({
        provider: source,
        model: model(source),
        credential: createProviderCredential(TEST_KEY),
        instructions: "test",
        userPrompt: "test",
        tools: [toolDefinition()],
        limits: DEFAULT_AGENT_LIMITS,
        fetch,
      });
      let error: unknown;

      try {
        await session.next(undefined, new AbortController().signal);
      } catch (caught: unknown) {
        error = caught;
      }

      expect(error).toMatchObject({ code });
      expect(String(error)).not.toContain(TEST_KEY);
      expect(JSON.stringify(error)).not.toContain(TEST_KEY);
    },
  );

  it("normalizes fetch failures and rejects non-SSE or malformed streams", async () => {
    const source = provider("responses");
    const createSession = (fetch: typeof globalThis.fetch) =>
      createOpenAICompatibleProviderSession({
        provider: source,
        model: model(source),
        credential: createProviderCredential(TEST_KEY),
        instructions: "test",
        userPrompt: "test",
        tools: [toolDefinition()],
        limits: DEFAULT_AGENT_LIMITS,
        fetch,
      });
    const failedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new Error(`transport ${TEST_KEY}`));
    const nonSse = createFetchQueue([
      new Response("{}", { headers: { "Content-Type": "application/json" } }),
    ]).fetch;
    const malformed = createFetchQueue([sseResponse("data: not-json\n\n")]).fetch;

    for (const fetch of [failedFetch, nonSse, malformed]) {
      let error: unknown;

      try {
        await createSession(fetch).next(undefined, new AbortController().signal);
      } catch (caught: unknown) {
        error = caught;
      }

      expect(error).toMatchObject({
        code: ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED,
      });
      expect(String(error)).not.toContain(TEST_KEY);
      expect(JSON.stringify(error)).not.toContain(TEST_KEY);
    }
  });

  it("does not issue a provider request after cancellation", async () => {
    const source = provider("responses");
    const fetch = vi.fn<typeof globalThis.fetch>();
    const controller = new AbortController();
    controller.abort();
    const session = createOpenAICompatibleProviderSession({
      provider: source,
      model: model(source),
      credential: createProviderCredential(TEST_KEY),
      instructions: "test",
      userPrompt: "test",
      tools: [toolDefinition()],
      limits: DEFAULT_AGENT_LIMITS,
      fetch,
    });

    await expect(session.next(undefined, controller.signal)).rejects.toMatchObject({
      code: ERROR_CODES.AGENT_CANCELLED,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects unknown model profile IDs before any network request", async () => {
    const source = provider("responses");
    const fetch = vi.fn<typeof globalThis.fetch>();

    await expect(
      probeProviderCapability({
        provider: source,
        modelProfileId: "unknown",
        limits: DEFAULT_AGENT_LIMITS,
        credential: createProviderCredential(TEST_KEY),
        fetch,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.MODEL_NOT_ALLOWED });
    expect(fetch).not.toHaveBeenCalled();
  });
});
