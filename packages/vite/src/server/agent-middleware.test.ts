import { createServer, type Server } from "node:http";

import {
  ERROR_CODES,
  SPOTPATCH_ENDPOINTS,
  SPOTPATCH_TOKEN_HEADER,
  getAgentJobEndpoint,
  type AgentCapabilitySnapshot,
  type AgentJobEvent,
  type AgentJobResult,
  type ApiResponse,
  type ResolvedAiOptions,
} from "@spotpatch/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAgentJobManager, type AgentJobManager } from "../agent/job-manager.js";
import { resolveOptions } from "../options.js";
import { createSourceRegistry } from "../registry/source-registry.js";
import type { SpotPatchSession } from "../session/session.js";
import { createSpotPatchMiddleware } from "./middleware.js";

const session = Object.freeze({
  token: "0123456789abcdef0123456789abcdef",
}) satisfies SpotPatchSession;

const annotation = Object.freeze({
  schemaVersion: 3,
  id: "annotation-id",
  locale: "en-US",
  page: Object.freeze({
    url: "http://localhost:5173/",
    pathname: "/",
    title: "Fixture",
    viewportWidth: 1_440,
    viewportHeight: 900,
    devicePixelRatio: 2,
  }),
  targets: Object.freeze([
    Object.freeze({
      instruction: "Clarify the selected action.",
      source: Object.freeze({
        origin: "none",
        confidence: "unknown",
      }),
      react: Object.freeze({
        supported: true,
        componentName: "App",
        componentStack: Object.freeze(["App"]),
      }),
      element: Object.freeze({
        tagName: "button",
        selector: "button.primary",
        sanitizedHtml: '<button class="primary">Save</button>',
        rect: Object.freeze({ x: 10, y: 20, width: 100, height: 40 }),
      }),
      styles: Object.freeze({
        classNames: Object.freeze(["primary"]),
        matchedRules: Object.freeze([]),
        computed: Object.freeze({ display: "block" }),
        warnings: Object.freeze([]),
      }),
      warnings: Object.freeze([]),
    }),
  ]),
  createdAt: "2026-08-07T00:00:00.000Z",
});

interface TestServer {
  readonly origin: string;
  readonly server: Server;
}

let testServer: TestServer | undefined;
let manager: AgentJobManager | undefined;

function resolveAiOptions(): ResolvedAiOptions {
  const ai = resolveOptions({
    ai: {
      providers: {
        relay: {
          type: "openai-compatible",
          label: "Trusted Relay",
          protocol: "responses",
          baseURL: "https://relay.example/v1",
          apiKeyEnv: "SPOTPATCH_TEST_API_KEY",
          models: {
            coder: { label: "Coding Model", model: "provider-model-v1" },
          },
          defaultModel: "coder",
        },
      },
      defaultProvider: "relay",
    },
  }).ai;

  if (ai === false) {
    throw new Error("Expected AI configuration.");
  }

  return ai;
}

function capability(): AgentCapabilitySnapshot {
  return Object.freeze({
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
  });
}

function result(jobId: string): AgentJobResult {
  return Object.freeze({
    jobId,
    summary: "Updated the selected action.",
    diff: "diff --git a/src/App.tsx b/src/App.tsx\n",
    files: Object.freeze([
      Object.freeze({
        relativePath: "src/App.tsx",
        kind: "modified" as const,
        additions: 1,
        deletions: 1,
      }),
    ]),
    checks: Object.freeze([]),
  });
}

async function startServer(
  agentManager: AgentJobManager | undefined,
): Promise<TestServer> {
  const options = resolveOptions({
    ai:
      agentManager === undefined
        ? false
        : {
            providers: {
              relay: {
                type: "openai-compatible",
                label: "Trusted Relay",
                protocol: "responses",
                baseURL: "https://relay.example/v1",
                apiKeyEnv: "SPOTPATCH_TEST_API_KEY",
                models: {
                  coder: {
                    label: "Coding Model",
                    model: "provider-model-v1",
                  },
                },
                defaultModel: "coder",
              },
            },
            defaultProvider: "relay",
          },
  });
  const middleware = createSpotPatchMiddleware({
    ...(agentManager === undefined ? {} : { agentManager }),
    options,
    registry: createSourceRegistry(),
    root: "/project",
    session,
  });
  const server = createServer((request, response) => {
    middleware(request, response, () => {
      response.statusCode = 404;
      response.end("not found");
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP server address.");
  }

  return Object.freeze({
    origin: `http://127.0.0.1:${String(address.port)}`,
    server,
  });
}

async function stopServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

async function request(
  endpoint: string,
  method: "GET" | "POST",
  body?: unknown,
  headers: Readonly<Record<string, string>> = {},
): Promise<Response> {
  if (testServer === undefined) {
    throw new Error("Test server is unavailable.");
  }

  return fetch(`${testServer.origin}${endpoint}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      Origin: testServer.origin,
      [SPOTPATCH_TOKEN_HEADER]: session.token,
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

afterEach(async () => {
  if (testServer !== undefined) {
    await stopServer(testServer.server);
    testServer = undefined;
  }

  if (manager !== undefined) {
    await manager.close();
    manager = undefined;
  }
});

describe("Agent HTTP middleware", () => {
  it("serves capability, job, NDJSON result, Apply, and Revert without private config", async () => {
    const applyChange = vi.fn(() => Promise.resolve());
    const revertChange = vi.fn(() => Promise.resolve());
    const probeCapability = vi.fn(() => Promise.resolve(capability()));
    manager = createAgentJobManager({
      ai: resolveAiOptions(),
      root: "/project",
      environment: { SPOTPATCH_TEST_API_KEY: "sk-private" },
      dependencies: {
        applyChange,
        createJobId: () => "0123456789abcdefghijklmn",
        executeChange: ({ jobId }) =>
          Promise.resolve(
            Object.freeze({
              kind: "prepared-agent-change" as const,
              result: result(jobId),
              validationPassed: true,
              autoApplyEligible: false,
            }),
          ),
        inspectWorkspace: () =>
          Promise.resolve(
            Object.freeze({
              state: "ready" as const,
              checkedAt: "2026-08-08T00:00:00.000Z",
              changes: Object.freeze({
                staged: 0,
                unstaged: 0,
                untracked: 0,
                conflicted: 0,
                total: 0,
              }),
              canIncludeLocalChanges: false,
            }),
          ),
        probeCapability,
        revertChange,
      },
    });
    testServer = await startServer(manager);

    const capabilityResponse = await request(
      SPOTPATCH_ENDPOINTS.agentCapability,
      "POST",
      { providerProfileId: "relay", modelProfileId: "coder" },
    );
    expect(capabilityResponse.status).toBe(200);

    const workspaceResponse = await request(
      SPOTPATCH_ENDPOINTS.agentWorkspaceHealth,
      "POST",
      {},
    );
    expect(workspaceResponse.status).toBe(200);
    await expect(workspaceResponse.json()).resolves.toMatchObject({
      ok: true,
      data: { state: "ready", canIncludeLocalChanges: false },
    });

    const createResponse = await request(SPOTPATCH_ENDPOINTS.agentJobs, "POST", {
      annotation,
      providerProfileId: "relay",
      modelProfileId: "coder",
      providerDataConsent: true,
    });
    const created = (await createResponse.json()) as ApiResponse<{
      readonly jobId: string;
    }>;
    expect(createResponse.status).toBe(202);

    if (!created.ok) {
      throw new Error("Expected Agent job creation to succeed.");
    }

    await vi.waitFor(() => {
      expect(manager?.result(created.data.jobId).snapshot.status).toBe(
        "awaiting-review",
      );
    });

    const eventsResponse = await request(
      getAgentJobEndpoint(created.data.jobId, "events"),
      "POST",
      {},
    );
    const events = (await eventsResponse.text())
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as AgentJobEvent);
    expect(eventsResponse.status).toBe(200);
    expect(eventsResponse.headers.get("content-type")).toContain(
      "application/x-ndjson",
    );
    expect(events.some((event) => event.type === "result-ready")).toBe(true);

    const resultResponse = await request(
      getAgentJobEndpoint(created.data.jobId, "result"),
      "POST",
      {},
    );
    const resultText = await resultResponse.text();
    expect(resultText).toContain("src/App.tsx");
    expect(resultText).not.toContain("relay.example");
    expect(resultText).not.toContain("sk-private");

    const applyResponse = await request(
      getAgentJobEndpoint(created.data.jobId, "apply"),
      "POST",
      {},
    );
    expect(applyResponse.status).toBe(200);
    await expect(applyResponse.json()).resolves.toMatchObject({
      ok: true,
      data: { status: "applied" },
    });

    const revertResponse = await request(
      getAgentJobEndpoint(created.data.jobId, "revert"),
      "POST",
      {},
    );
    expect(revertResponse.status).toBe(200);
    await expect(revertResponse.json()).resolves.toMatchObject({
      ok: true,
      data: { status: "reverted" },
    });
    expect(probeCapability).toHaveBeenCalledOnce();
    expect(applyChange).toHaveBeenCalledOnce();
    expect(revertChange).toHaveBeenCalledOnce();
  });

  it("rejects missing consent, injected config, wrong methods, and missing token", async () => {
    manager = createAgentJobManager({
      ai: resolveAiOptions(),
      root: "/project",
      environment: { SPOTPATCH_TEST_API_KEY: "sk-private" },
    });
    testServer = await startServer(manager);

    const noConsent = await request(SPOTPATCH_ENDPOINTS.agentJobs, "POST", {
      annotation,
      providerProfileId: "relay",
      modelProfileId: "coder",
    });
    const injected = await request(SPOTPATCH_ENDPOINTS.agentJobs, "POST", {
      annotation,
      providerProfileId: "relay",
      modelProfileId: "coder",
      providerDataConsent: true,
      baseURL: "https://attacker.example/v1",
    });
    const wrongMethod = await request(SPOTPATCH_ENDPOINTS.agentCapability, "GET");
    const missingToken = await request(
      SPOTPATCH_ENDPOINTS.agentCapability,
      "POST",
      { providerProfileId: "relay", modelProfileId: "coder" },
      { [SPOTPATCH_TOKEN_HEADER]: "" },
    );

    expect(noConsent.status).toBe(400);
    expect(injected.status).toBe(400);
    expect(wrongMethod.status).toBe(400);
    expect(missingToken.status).toBe(401);
  });

  it("returns AI_DISABLED without constructing an Agent manager", async () => {
    testServer = await startServer(undefined);
    const response = await request(SPOTPATCH_ENDPOINTS.agentCapability, "POST", {
      providerProfileId: "relay",
      modelProfileId: "coder",
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: ERROR_CODES.AI_DISABLED },
    });
  });
});
