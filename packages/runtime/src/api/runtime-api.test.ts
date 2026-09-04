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
  type ComponentDataFlowReport,
  type PageDataFlowReport,
} from "@spotpatch/shared";
import { describe, expect, it, vi } from "vitest";
import {
  getAskJobEndpoint,
  type AskJobCreateRequest,
  type AskJobEvent,
  type AskJobSnapshot,
  type ContextualAskCapability,
} from "@spotpatch/shared/contextual-ask-browser";

import { RuntimeApiError, createRuntimeApi } from "./runtime-api.js";
import { createContextualAskApi } from "./contextual-ask-api.js";

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

const dataFlowReport = Object.freeze({
  schemaVersion: 1,
  reportId: "report_component",
  baseline: Object.freeze({
    registryEpoch: "registry_1",
    analyzerVersion: "1",
    adapterSetHash: "builtin",
    analyzedSourceVersions: Object.freeze(["source_current"]),
  }),
  capability: Object.freeze({
    enabled: true,
    staticAnalysis: "available",
    runtimeObservation: "dispatch-only",
    responseShape: "consumed-fields-only",
    aiAssistance: "disabled",
    reasons: Object.freeze([]),
  }),
  component: Object.freeze({
    componentSourceId: "component_login",
    displayName: "Login",
    source: Object.freeze({
      fileId: "file_login",
      displayPath: "src/Login.tsx",
      line: 1,
      column: 1,
      sourceVersion: "source_current",
    }),
  }),
  dependencies: Object.freeze([]),
  evidence: Object.freeze([]),
  diagnostics: Object.freeze([]),
  completeness: Object.freeze({
    complete: true,
    visitedModules: 1,
    visitedCallsites: 0,
    frontierCount: 0,
  }),
}) satisfies ComponentDataFlowReport;

const pageDataFlowReport = Object.freeze({
  schemaVersion: dataFlowReport.schemaVersion,
  reportId: "report_page",
  baseline: dataFlowReport.baseline,
  capability: dataFlowReport.capability,
  dependencies: dataFlowReport.dependencies,
  evidence: dataFlowReport.evidence,
  diagnostics: dataFlowReport.diagnostics,
  completeness: dataFlowReport.completeness,
}) satisfies PageDataFlowReport;

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

  it("loads, validates, and freezes component and page data-flow reports", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: dataFlowReport }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: pageDataFlowReport }));
    const api = createRuntimeApi({
      apiBase: SPOTPATCH_API_BASE,
      dataFlowReportMaxBytes: 128 * 1_024,
      fetch: fetchMock,
      sessionToken: "token",
    });
    const component = await api.componentDataFlowReport({
      schemaVersion: 1,
      componentSourceId: "component_login",
      sourceVersion: "source_current",
    });
    const page = await api.pageDataFlowReport({
      schemaVersion: 1,
      targets: [
        {
          schemaVersion: 1,
          componentSourceId: "component_login",
          sourceVersion: "source_current",
        },
      ],
    });

    expect(fetchMock.mock.calls.map(([endpoint]) => endpoint)).toEqual([
      SPOTPATCH_ENDPOINTS.dataFlowComponentReport,
      SPOTPATCH_ENDPOINTS.dataFlowPageReport,
    ]);
    expect(component).toEqual(dataFlowReport);
    expect(page).toEqual(pageDataFlowReport);
    expect(Object.isFrozen(component.component.source)).toBe(true);
    expect(Object.isFrozen(page.baseline)).toBe(true);
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

  it("accepts only a bounded editor launch acknowledgement", async () => {
    const successFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ ok: true, data: { editor: "cursor" } }));
    const malformedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ ok: true, data: { editor: "malicious-command" } }),
      );
    const request = { fileId: "file-id", line: 12, column: 4 };

    await expect(
      createRuntimeApi({
        apiBase: SPOTPATCH_API_BASE,
        fetch: successFetch,
        sessionToken: "token",
      }).openEditor(request),
    ).resolves.toEqual({ editor: "cursor" });
    await expect(
      createRuntimeApi({
        apiBase: SPOTPATCH_API_BASE,
        fetch: malformedFetch,
        sessionToken: "token",
      }).openEditor(request),
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
        trustedFastModeConsent: true,
        workingTreeMode: "require-clean",
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
    expect(createBody).toContain('"trustedFastModeConsent":true');
    expect(createBody).not.toContain("browser excerpt must be reloaded");
    expect(serializedRequests).not.toContain("baseURL");
    expect(serializedRequests).not.toContain("apiKey");
    expect(serializedRequests).not.toContain("provider-model-v1");
  });

  it("validates the bounded local workspace health response", async () => {
    const health = Object.freeze({
      state: "consent-required" as const,
      checkedAt: "2026-08-08T00:00:00.000Z",
      changes: Object.freeze({
        staged: 1,
        unstaged: 1,
        untracked: 2,
        conflicted: 0,
        total: 3,
      }),
      canIncludeLocalChanges: true,
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ ok: true, data: health }));
    const api = createRuntimeApi({
      apiBase: SPOTPATCH_API_BASE,
      fetch: fetchMock,
      sessionToken: "token",
    });

    await expect(api.agentWorkspaceHealth()).resolves.toEqual(health);
    expect(fetchMock).toHaveBeenCalledWith(
      SPOTPATCH_ENDPOINTS.agentWorkspaceHealth,
      expect.objectContaining({ method: "POST", body: "{}" }),
    );
  });

  it("rejects a workspace health response with inconsistent state", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        ok: true,
        data: {
          state: "ready",
          checkedAt: "2026-08-08T00:00:00.000Z",
          changes: {
            staged: 1,
            unstaged: 0,
            untracked: 0,
            conflicted: 0,
            total: 1,
          },
          canIncludeLocalChanges: true,
        },
      }),
    );
    const api = createRuntimeApi({
      apiBase: SPOTPATCH_API_BASE,
      fetch: fetchMock,
      sessionToken: "token",
    });

    await expect(api.agentWorkspaceHealth()).rejects.toBeInstanceOf(RuntimeApiError);
  });

  it("parses arbitrarily chunked UTF-8 NDJSON and rejects out-of-order events", async () => {
    const events: readonly AgentJobEvent[] = [
      Object.freeze({
        schemaVersion: 2,
        sequence: 1,
        jobId,
        status: "running",
        timestamp: "2026-08-07T00:00:01.000Z",
        type: "phase",
        data: Object.freeze({ message: "正在分析" }),
      }),
      Object.freeze({
        schemaVersion: 2,
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

  it("validates the read-only Ask lifecycle, GET event replay, and sourced result", async () => {
    const askJobId = "ask_job_1";
    const askCapability: ContextualAskCapability = {
      schemaVersion: 1,
      enabled: true,
      executors: [
        {
          executorId: "configured-key-relay-coder",
          kind: "configured-key",
          label: "Trusted Relay",
          requestedModelLabel: "Coder",
          effectiveModelLabel: "Coder",
          state: "ready",
          providerDataConsentRequired: true,
          readOnlyProven: true,
        },
      ],
      safety: {
        selectionRequired: true,
        singleTurn: true,
        writesAllowed: false,
        historyStored: false,
      },
      checkedAt: "2026-09-02T00:00:00.000Z",
    };
    const queued: AskJobSnapshot = {
      schemaVersion: 1,
      jobId: askJobId,
      selectionId: "selection_1",
      status: "queued",
      executor: {
        executorId: "configured-key-relay-coder",
        kind: "configured-key",
        label: "Trusted Relay",
        modelLabel: "Coder",
      },
      createdAt: "2026-09-02T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z",
      canCancel: true,
    };
    const answered: AskJobSnapshot = {
      ...queued,
      status: "answered",
      updatedAt: "2026-09-02T00:00:02.000Z",
      canCancel: false,
    };
    const events: readonly AskJobEvent[] = [
      {
        schemaVersion: 1,
        sequence: 1,
        jobId: askJobId,
        status: "running",
        timestamp: "2026-09-02T00:00:01.000Z",
        type: "read-activity",
        activity: {
          kind: "source",
          sourceId: "source_1",
          relativePath: "src/Form.tsx",
        },
        state: "started",
      },
      {
        schemaVersion: 1,
        sequence: 2,
        jobId: askJobId,
        status: "answered",
        timestamp: "2026-09-02T00:00:02.000Z",
        type: "answer-ready",
      },
    ];
    const result = {
      snapshot: answered,
      result: {
        schemaVersion: 1,
        jobId: askJobId,
        selectionId: "selection_1",
        contextHash: "a".repeat(64),
        executor: answered.executor,
        blocks: [
          {
            kind: "paragraph" as const,
            text: "The selected component submits the form.",
            sourceIds: ["source_1"],
          },
        ],
        sources: [
          {
            sourceId: "source_1",
            label: "Submit handler",
            relativePath: "src/Form.tsx",
            fileId: "file_form",
            startLine: 12,
            endLine: 24,
            confidence: "exact" as const,
            targetIds: ["target_1"],
            contentHash: "b".repeat(64),
          },
        ],
        warnings: [],
        createdAt: "2026-09-02T00:00:02.000Z",
        expiresAt: "2026-09-02T00:05:02.000Z",
      },
    };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
          ),
        );
        controller.close();
      },
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: askCapability }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: queued }, 202))
      .mockResolvedValueOnce(new Response(stream, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: result }));
    const api = createContextualAskApi({
      fetch: fetchMock,
      sessionToken: "session-secret",
    });
    const request: AskJobCreateRequest = {
      schemaVersion: 1,
      requestId: "request_1",
      executorId: "configured-key-relay-coder",
      providerDataConsent: true,
      envelope: {
        schemaVersion: 1,
        taskId: "task_1",
        selection: {
          schemaVersion: 1,
          selectionId: "selection_1",
          locale: "en-US",
          targets: [
            {
              targetId: "target_1",
              page: {
                url: "http://localhost:4173/",
                pathname: "/",
                title: "Fixture",
                viewportWidth: 1440,
                viewportHeight: 900,
                devicePixelRatio: 2,
              },
              source: {
                origin: "jsx-host",
                confidence: "exact",
                fileId: "file_form",
                relativePath: "src/Form.tsx",
                line: 12,
                column: 1,
              },
              react: { supported: false, componentStack: [] },
              element: {
                tagName: "button",
                selector: "button[type=submit]",
                sanitizedHtml: '<button type="submit">Save</button>',
                rect: { x: 1, y: 2, width: 100, height: 40 },
              },
              styles: {
                classNames: [],
                matchedRules: [],
                computed: {},
                warnings: [],
              },
              warnings: [],
            },
          ],
          createdAt: "2026-09-02T00:00:00.000Z",
        },
        task: { kind: "ask", question: "What does this component do?" },
        createdAt: "2026-09-02T00:00:00.000Z",
      },
    };

    await expect(api.capability()).resolves.toEqual(askCapability);
    await expect(api.createJob(request)).resolves.toEqual(queued);
    const received: AskJobEvent[] = [];
    await api.events(askJobId, 0, (event) => received.push(event));
    await expect(api.result(askJobId)).resolves.toEqual(result);
    expect(received).toEqual(events);
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      getAskJobEndpoint(askJobId, "events", { afterSequence: 0 }),
      expect.objectContaining({ method: "GET" }),
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("apiKey");
  });
});
