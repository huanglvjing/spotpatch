import { createHash } from "node:crypto";

import {
  CONTEXTUAL_ASK_LIMITS,
  DEFAULT_AGENT_LIMITS,
  spotAskTaskEnvelopeSchema,
  type AgentLimits,
  type AiProviderProtocol,
  type ResolvedAiModelProfile,
  type ResolvedOpenAICompatibleProviderOptions,
} from "@spotpatch/shared";
import { describe, expect, it, vi } from "vitest";

import { createProviderCredential } from "../provider/provider-credential.js";
import {
  createConfiguredKeyAskExecutor,
  createConfiguredKeyAskExecutorId,
} from "./configured-key-executor.js";
import { createConfiguredKeyAskPrompt } from "./configured-key-prompt.js";
import {
  CONFIGURED_KEY_ASK_TOOL_NAMES,
  CONFIGURED_KEY_ASK_TOOLS,
} from "./configured-key-tools.js";
import type {
  AskSourceGrantEntry,
  ContextualAskExecutorInput,
} from "./executor-port.js";

const TEST_KEY = "configured-key-secret-never-serialize";
const SOURCE_SECRET = "source-inline-secret-never-send";
const APP_CONTENT = [
  "export function Card() {",
  "  return <article>Selected card</article>;",
  "}",
].join("\n");
const STYLE_CONTENT = [
  ".card { color: red; }",
  `const apiKey = "${SOURCE_SECRET}";`,
].join("\n");

interface CapturedRequest {
  readonly authorization: string | null;
  readonly body: Readonly<Record<string, unknown>>;
  readonly url: string;
}

function sseResponse(events: readonly unknown[]): Response {
  return new Response(
    `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
}

function responsesToolTurn(
  responseId: string,
  calls: readonly Readonly<{
    id: string;
    name: string;
    arguments: Readonly<Record<string, unknown>>;
  }>[],
): Response {
  const items = calls.map((call) => ({
    type: "function_call",
    call_id: call.id,
    name: call.name,
    arguments: JSON.stringify(call.arguments),
  }));
  return sseResponse([
    { type: "response.created", response: { id: responseId } },
    ...items.map((item) => ({ type: "response.output_item.done", item })),
    {
      type: "response.completed",
      response: { id: responseId, status: "completed", output: items },
    },
  ]);
}

function responsesTextTurn(responseId: string, text: string): Response {
  return sseResponse([
    { type: "response.created", response: { id: responseId } },
    { type: "response.output_text.delta", delta: text },
    {
      type: "response.completed",
      response: {
        id: responseId,
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text }],
          },
        ],
      },
    },
  ]);
}

function chatToolTurn(
  calls: readonly Readonly<{
    id: string;
    name: string;
    arguments: Readonly<Record<string, unknown>>;
  }>[],
): Response {
  return sseResponse([
    {
      choices: [
        {
          delta: {
            tool_calls: calls.map((call, index) => ({
              index,
              id: call.id,
              function: {
                name: call.name,
                arguments: JSON.stringify(call.arguments),
              },
            })),
          },
          finish_reason: null,
        },
      ],
    },
    { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
  ]);
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function fetchQueue(responses: readonly Response[]) {
  const queue = [...responses];
  const requests: CapturedRequest[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation((request, init) => {
    const response = queue.shift();
    if (response === undefined) throw new Error("Unexpected Provider request.");
    if (typeof init?.body !== "string") throw new Error("Expected JSON body.");
    requests.push(
      Object.freeze({
        authorization: new Headers(init.headers).get("authorization"),
        body: JSON.parse(init.body) as Readonly<Record<string, unknown>>,
        url: requestUrl(request),
      }),
    );
    return Promise.resolve(response);
  });
  return { fetch, requests };
}

function provider(protocol: AiProviderProtocol): Readonly<{
  provider: ResolvedOpenAICompatibleProviderOptions;
  model: ResolvedAiModelProfile;
}> {
  const model = Object.freeze({
    id: "ask-model",
    label: "Ask model",
    model: "provider-ask-model",
  });
  return Object.freeze({
    model,
    provider: Object.freeze({
      id: "ask-provider",
      type: "openai-compatible",
      label: "Ask relay",
      protocol,
      authentication: "bearer",
      baseURL: "https://relay.example.test/v1",
      apiKeyEnv: "SPOTPATCH_TEST_KEY",
      models: Object.freeze({ "ask-model": model }),
      defaultModel: "ask-model",
    }),
  });
}

function source(
  handleId: string,
  relativePath: string,
  content: string,
): AskSourceGrantEntry {
  return Object.freeze({
    handleId,
    fileId: `file_${handleId}`,
    relativePath,
    label: relativePath.split("/").at(-1) ?? relativePath,
    lineCount: content.split("\n").length,
    size: content.length,
    contentHash: createHash("sha256").update(content).digest("hex"),
    confidence: "exact",
    targetIds: Object.freeze(["target_card"]),
  });
}

function askInput(question = `这是什么组件？ apiKey="${SOURCE_SECRET}"`) {
  const app = source("source_app", "src/Card.tsx", APP_CONTENT);
  const style = source("source_style", "src/Card.css", STYLE_CONTENT);
  const contents = new Map([
    [app.handleId, APP_CONTENT],
    [style.handleId, STYLE_CONTENT],
  ]);
  const reads: string[] = [];
  const input: ContextualAskExecutorInput = {
    jobId: "job_ask",
    envelope: spotAskTaskEnvelopeSchema.parse({
      schemaVersion: 1,
      taskId: "task_ask",
      createdAt: "2026-09-01T00:00:00.000Z",
      task: { kind: "ask", question },
      selection: {
        schemaVersion: 1,
        selectionId: "selection_card",
        locale: "zh-CN",
        createdAt: "2026-09-01T00:00:00.000Z",
        targets: [
          {
            targetId: "target_card",
            page: {
              url: "http://localhost:3000/card?token=page-secret",
              pathname: "/card",
              title: "Card fixture",
              viewportWidth: 1280,
              viewportHeight: 720,
              devicePixelRatio: 1,
            },
            source: {
              fileId: app.fileId,
              relativePath: app.relativePath,
              line: 1,
              column: 1,
              origin: "jsx-host",
              confidence: "exact",
            },
            react: { supported: true, componentStack: ["Card"] },
            element: {
              tagName: "article",
              selector: ".card",
              sanitizedHtml: '<article class="card">Selected card</article>',
              rect: { x: 0, y: 0, width: 200, height: 80 },
            },
            styles: {
              classNames: ["card"],
              matchedRules: [],
              computed: { color: "red" },
              warnings: [],
            },
            code: {
              relativePath: app.relativePath,
              language: "tsx",
              startLine: 1,
              endLine: 3,
              excerpt: APP_CONTENT,
              boundary: "component",
            },
            warnings: [],
          },
        ],
      },
    }),
    grant: Object.freeze({
      contextHash: createHash("sha256").update("context").digest("hex"),
      truncated: false,
      sources: Object.freeze([app, style]),
    }),
    snapshot: Object.freeze({
      manifest: () => Object.freeze([app, style]),
      read(
        handleId: string,
        range: Readonly<{ startLine?: number; endLine?: number }> = {},
      ) {
        const content = contents.get(handleId);
        const entry = [app, style].find((candidate) => candidate.handleId === handleId);
        if (content === undefined || entry === undefined) throw new Error("denied");
        const startLine = range.startLine ?? 1;
        const endLine = range.endLine ?? entry.lineCount;
        reads.push(`${handleId}:${String(startLine)}:${String(endLine)}`);
        return {
          handleId,
          startLine,
          endLine,
          content: content
            .split("\n")
            .slice(startLine - 1, endLine)
            .join("\n"),
        };
      },
      search(query: string) {
        return [...contents].flatMap(([handleId, content]) =>
          content
            .split("\n")
            .flatMap((line, index) =>
              line.toLowerCase().includes(query.toLowerCase())
                ? [{ handleId, line: index + 1, preview: line }]
                : [],
            ),
        );
      },
    }),
  };
  return { input, reads };
}

function answerArguments(
  handleId: string,
  startLine: number,
  endLine: number,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    blocks: Object.freeze([
      Object.freeze({
        kind: "paragraph",
        text: "这是 Card 组件。",
        citations: Object.freeze([Object.freeze({ handleId, startLine, endLine })]),
      }),
    ]),
    warnings: Object.freeze([]),
  });
}

function executorFor(
  protocol: AiProviderProtocol,
  fetch: typeof globalThis.fetch,
  limits: Readonly<AgentLimits> = DEFAULT_AGENT_LIMITS,
) {
  const resolved = provider(protocol);
  return createConfiguredKeyAskExecutor({
    ...resolved,
    credential: createProviderCredential(TEST_KEY),
    limits,
    fetch,
  });
}

function toolCall(
  id: string,
  name: string,
  arguments_: Readonly<Record<string, unknown>>,
) {
  return Object.freeze({ id, name, arguments: arguments_ });
}

describe("Configured Key Contextual Ask executor", () => {
  it.each(["responses", "chat-completions"] as const)(
    "runs batched immutable reads and one cited submission over %s",
    async (protocol) => {
      const firstCalls = [
        toolCall("list_1", "list_sources", {}),
        toolCall("read_app", "read_source", {
          sourceId: "source_app",
          startLine: 1,
          endLine: 2,
        }),
        toolCall("read_1", "read_source", {
          sourceId: "source_style",
          startLine: 1,
          endLine: 2,
        }),
      ];
      const submit = [
        toolCall("submit_1", "submit_answer", answerArguments("source_style", 1, 1)),
      ];
      const capture = fetchQueue(
        protocol === "responses"
          ? [
              responsesToolTurn("response_1", firstCalls),
              responsesToolTurn("response_2", submit),
            ]
          : [chatToolTurn(firstCalls), chatToolTurn(submit)],
      );
      const { input, reads } = askInput();
      const prompt = createConfiguredKeyAskPrompt(input);
      const answer = await executorFor(protocol, capture.fetch).execute(
        input,
        new AbortController().signal,
      );

      expect(answer.blocks[0]).toMatchObject({ text: "这是 Card 组件。" });
      expect(reads).toEqual(["source_app:1:2", "source_style:1:2"]);
      expect(capture.requests).toHaveLength(2);
      expect(capture.requests[0]?.authorization).toBe(`Bearer ${TEST_KEY}`);
      const serialized = JSON.stringify(capture.requests.map(({ body }) => body));
      expect(serialized).not.toContain(TEST_KEY);
      expect(serialized).not.toContain(SOURCE_SECRET);
      expect(serialized).not.toContain("page-secret");
      expect(serialized).not.toContain("apply_patch");
      expect(serialized).toContain("[redacted]");
      if (protocol === "responses") {
        expect(capture.requests[0]?.body.input).toEqual([
          { role: "user", content: prompt.normalizedPreview },
        ]);
        expect(capture.requests.every(({ body }) => body.store === false)).toBe(true);
      } else {
        expect(capture.requests[0]?.body.messages).toEqual(
          expect.arrayContaining([{ role: "user", content: prompt.normalizedPreview }]),
        );
      }
    },
  );

  it("allows zero extra reads when the selected code excerpt supports the citation", async () => {
    const capture = fetchQueue([
      responsesToolTurn("response_1", [
        toolCall("submit_1", "submit_answer", answerArguments("source_app", 1, 3)),
      ]),
    ]);
    const { input, reads } = askInput();

    await expect(
      executorFor("responses", capture.fetch).execute(
        input,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ blocks: [{ kind: "paragraph" }] });
    expect(reads).toEqual([]);
  });

  it("does not pre-authorize citations for code excerpts trimmed from a crowded prompt", () => {
    const { input } = askInput();
    const baseTarget = input.envelope.selection.targets[0];
    if (baseTarget?.code === undefined) {
      throw new Error("Expected code-backed target fixture.");
    }
    const baseCode = baseTarget.code;
    const targetIds = Array.from(
      { length: 20 },
      (_, index) => `target_${String(index + 1)}`,
    );
    const targets = targetIds.map((targetId) => ({
      ...baseTarget,
      targetId,
      code: { ...baseCode, excerpt: "x".repeat(16_000) },
    }));
    const crowded: ContextualAskExecutorInput = {
      ...input,
      envelope: {
        ...input.envelope,
        selection: { ...input.envelope.selection, targets },
      },
      grant: {
        ...input.grant,
        sources: input.grant.sources.map((entry) => ({
          ...entry,
          targetIds,
        })),
      },
    };

    const prompt = createConfiguredKeyAskPrompt(crowded);

    expect(prompt.initialObservedRanges).toEqual([]);
    expect(prompt.normalizedPreview.length).toBeLessThanOrEqual(
      Math.floor((CONTEXTUAL_ASK_LIMITS.maximumRequestBodyBytes * 3) / 4),
    );
  });

  it.each([
    [responsesTextTurn("response_text", "uncited final text"), "ASK_ANSWER_INVALID"],
    [
      responsesToolTurn("response_write", [
        toolCall("write_1", "apply_patch", { patch: "forbidden" }),
      ]),
      "ASK_WRITE_ATTEMPTED",
    ],
    [
      responsesToolTurn("response_mixed", [
        toolCall("read_1", "read_source", {
          sourceId: "source_style",
          startLine: 1,
          endLine: 1,
        }),
        toolCall("submit_1", "submit_answer", answerArguments("source_app", 1, 1)),
      ]),
      "ASK_ANSWER_INVALID",
    ],
    [
      responsesToolTurn("response_duplicate_submit", [
        toolCall("submit_1", "submit_answer", answerArguments("source_app", 1, 1)),
        toolCall("submit_2", "submit_answer", answerArguments("source_app", 2, 2)),
      ]),
      "ASK_ANSWER_INVALID",
    ],
    [
      responsesToolTurn("response_forged", [
        toolCall("submit_1", "submit_answer", answerArguments("source_forged", 1, 1)),
      ]),
      "ASK_SOURCE_SCOPE_DENIED",
    ],
    [
      responsesToolTurn("response_args", [
        toolCall("read_1", "read_source", {
          sourceId: "source_style",
          startLine: "1",
          endLine: 1,
        }),
      ]),
      "ASK_ANSWER_INVALID",
    ],
  ] as const)("fails closed for an invalid Provider turn", async (response, code) => {
    const capture = fetchQueue([response]);
    const { input } = askInput();

    await expect(
      executorFor("responses", capture.fetch).execute(
        input,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code });
  });

  it("returns a bounded retryable line error without expanding source scope", async () => {
    const capture = fetchQueue([
      responsesToolTurn("response_invalid_line", [
        toolCall("read_bad", "read_source", {
          sourceId: "source_style",
          startLine: 1,
          endLine: 99,
        }),
      ]),
      responsesToolTurn("response_read", [
        toolCall("read_good", "read_source", {
          sourceId: "source_style",
          startLine: 1,
          endLine: 1,
        }),
      ]),
      responsesToolTurn("response_submit", [
        toolCall("submit_1", "submit_answer", answerArguments("source_style", 1, 1)),
      ]),
    ]);
    const { input, reads } = askInput();

    await executorFor("responses", capture.fetch).execute(
      input,
      new AbortController().signal,
    );

    expect(reads).toEqual(["source_style:1:1"]);
    expect(JSON.stringify(capture.requests[1]?.body)).toContain("invalid-line-range");
  });

  it("enforces the configured Ask tool-call budget before executing a batch", async () => {
    const capture = fetchQueue([
      responsesToolTurn("response_limit", [
        toolCall("list_1", "list_sources", {}),
        toolCall("read_1", "read_source", {
          sourceId: "source_style",
          startLine: 1,
          endLine: 1,
        }),
      ]),
    ]);
    const { input, reads } = askInput();

    await expect(
      executorFor("responses", capture.fetch, {
        ...DEFAULT_AGENT_LIMITS,
        maxToolCalls: 1,
      }).execute(input, new AbortController().signal),
    ).rejects.toMatchObject({ code: "ASK_LIMIT_EXCEEDED" });
    expect(reads).toEqual([]);
  });

  it("fails without a repair turn after reaching the Ask model-turn budget", async () => {
    const capture = fetchQueue([
      responsesToolTurn("response_turn_limit", [
        toolCall("read_1", "read_source", {
          sourceId: "source_style",
          startLine: 1,
          endLine: 1,
        }),
      ]),
    ]);
    const { input, reads } = askInput();

    await expect(
      executorFor("responses", capture.fetch, {
        ...DEFAULT_AGENT_LIMITS,
        maxTurns: 1,
      }).execute(input, new AbortController().signal),
    ).rejects.toMatchObject({ code: "ASK_LIMIT_EXCEEDED" });
    expect(reads).toEqual(["source_style:1:1"]);
    expect(capture.requests).toHaveLength(1);
  });

  it("cancels before any Provider request and never produces a fallback", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const controller = new AbortController();
    controller.abort();
    const { input } = askInput();

    await expect(
      executorFor("responses", fetch).execute(input, controller.signal),
    ).rejects.toMatchObject({ code: "ASK_CANCELLED" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("aborts a Provider request at the bounded Ask job timeout", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      (_request, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              reject(new DOMException("aborted", "AbortError"));
            },
            { once: true },
          );
        }),
    );
    const { input } = askInput();

    await expect(
      executorFor("responses", fetch, {
        ...DEFAULT_AGENT_LIMITS,
        jobTimeoutMs: 10,
      }).execute(input, new AbortController().signal),
    ).rejects.toMatchObject({ code: "ASK_EXECUTOR_UNAVAILABLE" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects Provider events arriving after an explicit terminal event", async () => {
    const complete = {
      type: "response.completed",
      response: { id: "late", status: "completed", output: [] },
    };
    const capture = fetchQueue([
      sseResponse([
        { type: "response.created", response: { id: "late" } },
        complete,
        { type: "response.output_text.delta", delta: "late text" },
      ]),
    ]);
    const { input } = askInput();

    await expect(
      executorFor("responses", capture.fetch).execute(
        input,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "ASK_ANSWER_INVALID" });
  });

  it.each(["responses", "chat-completions"] as const)(
    "proves and caches the Ask-specific read/continue/submit fixture over %s",
    async (protocol) => {
      const read = [
        toolCall("probe_read", "read_source", {
          sourceId: "ask_capability_source",
          startLine: 1,
          endLine: 1,
        }),
      ];
      const submit = [
        toolCall(
          "probe_submit",
          "submit_answer",
          answerArguments("ask_capability_source", 1, 1),
        ),
      ];
      const capture = fetchQueue(
        protocol === "responses"
          ? [
              responsesToolTurn("probe_response_1", read),
              responsesToolTurn("probe_response_2", submit),
            ]
          : [chatToolTurn(read), chatToolTurn(submit)],
      );
      const executor = executorFor(protocol, capture.fetch);
      const [first, concurrent] = await Promise.all([
        executor.capability(new AbortController().signal),
        executor.capability(new AbortController().signal),
      ]);
      const second = await executor.capability(new AbortController().signal);

      expect(concurrent).toEqual(first);
      expect(first).toEqual(second);
      expect(first).toMatchObject({
        executorId: createConfiguredKeyAskExecutorId(
          provider(protocol).provider,
          provider(protocol).model,
        ),
        kind: "configured-key",
        state: "ready",
        readOnlyProven: true,
        providerDataConsentRequired: true,
      });
      expect(capture.requests).toHaveLength(2);
    },
  );

  it("does not let one cancelled capability waiter poison a concurrent waiter", async () => {
    let releaseFirstTurn: (() => void) | undefined;
    const firstTurnReady = new Promise<void>((resolve) => {
      releaseFirstTurn = resolve;
    });
    const responses = [
      responsesToolTurn("probe_response_1", [
        toolCall("probe_read", "read_source", {
          sourceId: "ask_capability_source",
          startLine: 1,
          endLine: 1,
        }),
      ]),
      responsesToolTurn("probe_response_2", [
        toolCall(
          "probe_submit",
          "submit_answer",
          answerArguments("ask_capability_source", 1, 1),
        ),
      ]),
    ];
    let requestIndex = 0;
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => {
      const response = responses[requestIndex];
      requestIndex += 1;
      if (response === undefined) throw new Error("Unexpected Provider request.");
      if (requestIndex === 1) await firstTurnReady;
      return response;
    });
    const executor = executorFor("responses", fetch);
    const cancelled = new AbortController();
    const surviving = new AbortController();

    const first = executor.capability(cancelled.signal);
    const second = executor.capability(surviving.signal);
    cancelled.abort();
    releaseFirstTurn?.();

    await expect(first).rejects.toMatchObject({ code: "ASK_CANCELLED" });
    await expect(second).resolves.toMatchObject({ state: "ready" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("caches a redacted unavailable capability after Provider authentication fails", async () => {
    const capture = fetchQueue([
      new Response(`authentication failed: ${TEST_KEY}`, { status: 401 }),
    ]);
    const executor = executorFor("responses", capture.fetch);

    const first = await executor.capability(new AbortController().signal);
    const second = await executor.capability(new AbortController().signal);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      state: "unavailable",
      errorCode: "ASK_EXECUTOR_UNAVAILABLE",
      readOnlyProven: true,
    });
    expect(JSON.stringify(first)).not.toContain(TEST_KEY);
    expect(capture.requests).toHaveLength(1);
  });

  it("publishes only the fixed four-tool read-only surface", () => {
    expect(CONFIGURED_KEY_ASK_TOOLS.map((tool) => tool.name)).toEqual(
      Object.values(CONFIGURED_KEY_ASK_TOOL_NAMES),
    );
    expect(JSON.stringify(CONFIGURED_KEY_ASK_TOOLS)).not.toMatch(
      /apply|replace|write|command|shell|git|network/iu,
    );
  });
});
