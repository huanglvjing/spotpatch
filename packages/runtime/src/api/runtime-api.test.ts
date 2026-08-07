import {
  SPOTPATCH_API_BASE,
  SPOTPATCH_ENDPOINTS,
  SPOTPATCH_TOKEN_HEADER,
  getAgentJobEndpoint,
  type AgentCapabilitySnapshot,
  type AgentJobEvent,
  type AgentJobResultResponse,
  type AgentJobSnapshot,
  type CodeContext,
} from "@spotpatch/shared";
import { describe, expect, it, vi } from "vitest";

import { createRuntimeApi } from "./runtime-api.js";

const codeContext = Object.freeze({
  relativePath: "src/App.tsx",
  language: "tsx",
  startLine: 1,
  endLine: 20,
  excerpt: "export function App() {}",
  boundary: "component",
}) satisfies CodeContext;

const jobId = "0123456789abcdefghijklmn";
const jobSnapshot = Object.freeze({
  jobId,
  status: "awaiting-review",
  providerProfileId: "relay",
  providerLabel: "Trusted Relay",
  modelProfileId: "coder",
  modelLabel: "Coding Model",
  phaseMessage: "Validated changes are ready for review.",
  createdAt: "2026-08-07T00:00:00.000Z",
  updatedAt: "2026-08-07T00:00:01.000Z",
  canCancel: true,
  canApply: true,
  canRevert: false,
}) satisfies AgentJobSnapshot;
const capability = Object.freeze({
  providerProfileId: "relay",
  providerLabel: "Trusted Relay",
  modelProfileId: "coder",
  modelLabel: "Coding Model",
  protocol: "responses",
  state: "agent-ready",
  authenticated: true,
  modelAvailable: true,
  toolCalling: true,
  toolResultContinuation: true,
  streaming: true,
  checkedAt: "2026-08-07T00:00:01.000Z",
}) satisfies AgentCapabilitySnapshot;
const jobResult = Object.freeze({
  snapshot: jobSnapshot,
  result: Object.freeze({
    jobId,
    summary: "Updated the component.",
    diff: "diff --git a/src/App.tsx b/src/App.tsx\n",
    files: Object.freeze([
      Object.freeze({
        relativePath: "src/App.tsx",
        kind: "modified",
        additions: 1,
        deletions: 1,
      }),
    ]),
    checks: Object.freeze([]),
  }),
}) satisfies AgentJobResultResponse;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("runtime API client", () => {
  it("uses shared endpoints and sends the token only in the request header", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ ok: true, data: codeContext }));
    const api = createRuntimeApi({
      apiBase: SPOTPATCH_API_BASE,
      fetch: fetchMock,
      sessionToken: "session-secret",
    });

    await expect(
      api.sourceContext({ fileId: "file-id", line: 4, column: 2, maxLines: 20 }),
    ).resolves.toEqual(codeContext);

    expect(fetchMock).toHaveBeenCalledWith(
      SPOTPATCH_ENDPOINTS.sourceContext,
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [SPOTPATCH_TOKEN_HEADER]: "session-secret",
        },
      }),
    );
    const requestBody = fetchMock.mock.calls[0]?.[1]?.body;
    expect(requestBody).toBeTypeOf("string");
    expect(requestBody).not.toContain("session-secret");
  });

  it("rejects non-success and malformed envelopes without exposing server text", async () => {
    const failureFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(
          { ok: false, error: { code: "INTERNAL_ERROR", message: "/private/path" } },
          500,
        ),
      );
    const malformedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ ok: true, data: { excerpt: 42 } }));
    const request = { fileId: "file-id", line: 1, column: 1, maxLines: 20 };

    await expect(
      createRuntimeApi({
        apiBase: SPOTPATCH_API_BASE,
        fetch: failureFetch,
        sessionToken: "token",
      }).sourceContext(request),
    ).rejects.not.toThrow("/private/path");
    await expect(
      createRuntimeApi({
        apiBase: SPOTPATCH_API_BASE,
        fetch: malformedFetch,
        sessionToken: "token",
      }).sourceContext(request),
    ).rejects.toThrow("SpotPatch local API request failed.");
  });

  it("aborts every unfinished request during cancellation", async () => {
    let observedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      observedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        observedSignal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    const api = createRuntimeApi({
      apiBase: SPOTPATCH_API_BASE,
      fetch: fetchMock,
      sessionToken: "token",
    });
    const pending = api.openEditor({ fileId: "file-id", line: 1, column: 1 });

    api.cancelPending();

    expect(observedSignal?.aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("validates Agent envelopes and never sends provider secrets from the browser", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: capability }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: jobSnapshot }, 202))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: jobResult }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: jobSnapshot }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: jobSnapshot }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: jobSnapshot }));
    const api = createRuntimeApi({
      apiBase: SPOTPATCH_API_BASE,
      fetch: fetchMock,
      sessionToken: "session-secret",
    });

    await expect(
      api.agentCapability({
        providerProfileId: "relay",
        modelProfileId: "coder",
      }),
    ).resolves.toEqual(capability);
    await expect(
      api.createAgentJob({
        annotation: {
          schemaVersion: 3,
          id: "annotation-id",
          locale: "en-US",
          page: {
            url: "http://localhost:5173/",
            pathname: "/",
            title: "Fixture",
            viewportWidth: 1_440,
            viewportHeight: 900,
            devicePixelRatio: 2,
          },
          targets: [
            {
              instruction: "Update this component.",
              source: { origin: "none", confidence: "unknown" },
              react: { supported: false, componentStack: [] },
              element: {
                tagName: "button",
                selector: "button",
                sanitizedHtml: "<button>Save</button>",
                rect: { x: 1, y: 2, width: 100, height: 40 },
              },
              styles: {
                classNames: [],
                matchedRules: [],
                computed: {},
                warnings: [],
              },
              code: {
                relativePath: "src/BrowserOnly.tsx",
                language: "tsx",
                startLine: 1,
                endLine: 1,
                excerpt: "browser excerpt must be reloaded",
                boundary: "nearby-lines",
              },
              warnings: [],
            },
          ],
          createdAt: "2026-08-07T00:00:00.000Z",
        },
        providerProfileId: "relay",
        modelProfileId: "coder",
        providerDataConsent: true,
      }),
    ).resolves.toEqual(jobSnapshot);
    await expect(api.agentResult(jobId)).resolves.toEqual(jobResult);
    await api.cancelAgentJob(jobId);
    await api.applyAgentJob(jobId);
    await api.revertAgentJob(jobId);

    const serializedRequests = JSON.stringify(fetchMock.mock.calls);
    const createBody = fetchMock.mock.calls[1]?.[1]?.body;
    expect(serializedRequests).toContain(SPOTPATCH_ENDPOINTS.agentCapability);
    expect(serializedRequests).toContain(getAgentJobEndpoint(jobId, "result"));
    expect(createBody).toBeTypeOf("string");
    expect(createBody).toContain('"providerDataConsent":true');
    expect(createBody).not.toContain("browser excerpt must be reloaded");
    expect(serializedRequests).not.toContain("baseURL");
    expect(serializedRequests).not.toContain("apiKey");
    expect(serializedRequests).not.toContain("provider-model-v1");
  });

  it("parses arbitrarily chunked UTF-8 NDJSON and rejects out-of-order events", async () => {
    const events: readonly AgentJobEvent[] = [
      Object.freeze({
        schemaVersion: 1,
        sequence: 1,
        jobId,
        status: "running",
        timestamp: "2026-08-07T00:00:01.000Z",
        type: "phase",
        data: Object.freeze({ message: "正在分析" }),
      }),
      Object.freeze({
        schemaVersion: 1,
        sequence: 2,
        jobId,
        status: "awaiting-review",
        timestamp: "2026-08-07T00:00:02.000Z",
        type: "snapshot",
        data: Object.freeze({ snapshot: jobSnapshot }),
      }),
    ];
    const bytes = new TextEncoder().encode(
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    );
    const split = bytes.findIndex((byte) => byte > 0x7f) + 1;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, split));
        controller.enqueue(bytes.slice(split));
        controller.close();
      },
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(stream, { status: 200 }));
    const api = createRuntimeApi({
      apiBase: SPOTPATCH_API_BASE,
      fetch: fetchMock,
      sessionToken: "token",
    });
    const received: AgentJobEvent[] = [];

    await api.agentEvents(jobId, (event) => received.push(event));
    expect(received).toEqual(events);
    expect(fetchMock).toHaveBeenCalledWith(
      getAgentJobEndpoint(jobId, "events"),
      expect.objectContaining({ method: "POST", body: "{}" }),
    );

    const invalidStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `${JSON.stringify(events[1])}\n${JSON.stringify(events[0])}\n`,
          ),
        );
        controller.close();
      },
    });
    const invalidApi = createRuntimeApi({
      apiBase: SPOTPATCH_API_BASE,
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(invalidStream, { status: 200 })),
      sessionToken: "token",
    });

    await expect(invalidApi.agentEvents(jobId, () => undefined)).rejects.toThrow(
      "SpotPatch local API request failed.",
    );
  });

  it("rejects response identities that do not match the requested profiles or job", async () => {
    const mismatchedCapability = createRuntimeApi({
      apiBase: SPOTPATCH_API_BASE,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          ok: true,
          data: { ...capability, modelProfileId: "unexpected" },
        }),
      ),
      sessionToken: "token",
    });

    await expect(
      mismatchedCapability.agentCapability({
        providerProfileId: "relay",
        modelProfileId: "coder",
      }),
    ).rejects.toThrow("SpotPatch local API request failed.");

    const mismatchedJob = createRuntimeApi({
      apiBase: SPOTPATCH_API_BASE,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          ok: true,
          data: { ...jobSnapshot, jobId: "zyxwvutsrqponmlkjihgfedc" },
        }),
      ),
      sessionToken: "token",
    });

    await expect(mismatchedJob.applyAgentJob(jobId)).rejects.toThrow(
      "SpotPatch local API request failed.",
    );
  });
});
