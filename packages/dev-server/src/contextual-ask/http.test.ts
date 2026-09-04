import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ContextualAskExecutor } from "@spotpatch/agent";
import {
  SPOTPATCH_ENDPOINTS,
  SPOTPATCH_TOKEN_HEADER,
  getAskJobEndpoint,
} from "@spotpatch/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveOptions } from "../options.js";
import { createSourceRegistry } from "../registry/source-registry.js";
import type { SpotPatchSession } from "../session/session.js";
import { createSpotPatchMiddleware } from "../server/middleware.js";
import { createWorkspaceActivityCoordinator } from "../workspace/activity-coordinator.js";
import { createContextualAskManager, type ContextualAskManager } from "./manager.js";

const session = Object.freeze({
  id: "0123456789abcdef0123456789abcdef",
  token: "0123456789abcdef0123456789abcdef",
}) satisfies SpotPatchSession;
const roots: string[] = [];
const servers: Server[] = [];
const managers: ContextualAskManager[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map(async (manager) => manager.close()));
  await Promise.all(
    servers.splice(0).map(
      async (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error === undefined) resolve();
            else reject(error);
          });
        }),
    ),
  );
  await Promise.all(
    roots.splice(0).map(async (root) => rm(root, { recursive: true, force: true })),
  );
});

async function start(
  contextualAskManager: ContextualAskManager | undefined,
  root: string,
  registry = createSourceRegistry(),
): Promise<string> {
  const middleware = createSpotPatchMiddleware({
    ...(contextualAskManager === undefined ? {} : { contextualAskManager }),
    options: resolveOptions({ contextualAsk: true }),
    registry,
    root,
    session,
  });
  const server = createServer((request, response) => {
    middleware(request, response, () => {
      response.statusCode = 404;
      response.end();
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No port.");
  return `http://127.0.0.1:${String(address.port)}`;
}

function authorizedFetch(origin: string, endpoint: string, body?: unknown) {
  return fetch(`${origin}${endpoint}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: origin,
      [SPOTPATCH_TOKEN_HEADER]: session.token,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function createRequest(fileId: string) {
  return {
    schemaVersion: 1,
    requestId: "request-http",
    executorId: "fake-key",
    providerDataConsent: true,
    envelope: {
      schemaVersion: 1,
      taskId: "task-http",
      createdAt: "2026-09-01T00:00:00.000Z",
      task: { kind: "ask", question: "这个按钮是什么？" },
      selection: {
        schemaVersion: 1,
        selectionId: "selection-http",
        locale: "zh-CN",
        createdAt: "2026-09-01T00:00:00.000Z",
        targets: [
          {
            targetId: "target-http",
            page: {
              url: "http://localhost:3000/",
              pathname: "/",
              title: "Fixture",
              viewportWidth: 1280,
              viewportHeight: 720,
              devicePixelRatio: 1,
            },
            source: {
              fileId,
              relativePath: "src/App.tsx",
              origin: "jsx-host",
              confidence: "exact",
            },
            react: { supported: true, componentStack: ["App"] },
            element: {
              tagName: "button",
              selector: "button",
              sanitizedHtml: "<button>Save</button>",
              rect: { x: 0, y: 0, width: 100, height: 40 },
            },
            styles: { classNames: [], matchedRules: [], computed: {}, warnings: [] },
            warnings: [],
          },
        ],
      },
    },
  };
}

describe("Contextual Ask HTTP", () => {
  it("returns the dedicated disabled error through the shared middleware", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spotpatch-ask-http-"));
    roots.push(root);
    const origin = await start(undefined, root);
    const response = await authorizedFetch(origin, SPOTPATCH_ENDPOINTS.askCapability);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "ASK_DISABLED" },
    });
  });

  it("blocks an empty selection before execution and serves result/event endpoints", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spotpatch-ask-http-"));
    roots.push(root);
    await mkdir(path.join(root, "src"));
    const sourcePath = path.join(root, "src/App.tsx");
    await writeFile(sourcePath, "export const App = () => <button>Save</button>;\n");
    const registry = createSourceRegistry();
    const fileId = registry.register(sourcePath);
    const execute = vi.fn<ContextualAskExecutor["execute"]>((input) => {
      const source = input.grant.sources[0];
      return Promise.resolve({
        blocks: [
          {
            kind: "paragraph",
            text: "这是保存按钮。",
            citations: [{ handleId: source?.handleId ?? "", startLine: 1, endLine: 1 }],
          },
        ],
        warnings: [],
      });
    });
    const executor: ContextualAskExecutor = {
      executorId: "fake-key",
      capability: () =>
        Promise.resolve({
          executorId: "fake-key",
          kind: "configured-key",
          label: "Fake Key",
          requestedModelLabel: "fake",
          effectiveModelLabel: "fake",
          state: "ready",
          providerDataConsentRequired: true,
          readOnlyProven: true,
        }),
      execute,
    };
    const manager = createContextualAskManager({
      enabled: true,
      executors: [executor],
      coordinator: createWorkspaceActivityCoordinator(),
      registry,
      root,
    });
    managers.push(manager);
    const origin = await start(manager, root, registry);
    const valid = createRequest(fileId);
    const invalid = {
      ...valid,
      envelope: {
        ...valid.envelope,
        selection: { ...valid.envelope.selection, targets: [] },
      },
    };
    const invalidResponse = await authorizedFetch(
      origin,
      SPOTPATCH_ENDPOINTS.askJobs,
      invalid,
    );
    expect(invalidResponse.status).toBe(422);
    await expect(invalidResponse.json()).resolves.toMatchObject({
      error: { code: "ASK_SELECTION_REQUIRED" },
    });
    expect(execute).not.toHaveBeenCalled();

    const consentResponse = await authorizedFetch(origin, SPOTPATCH_ENDPOINTS.askJobs, {
      ...valid,
      providerDataConsent: false,
    });
    expect(consentResponse.status).toBe(403);
    await expect(consentResponse.json()).resolves.toMatchObject({
      error: { code: "ASK_CONSENT_REQUIRED" },
    });
    expect(execute).not.toHaveBeenCalled();

    const createResponse = await authorizedFetch(
      origin,
      SPOTPATCH_ENDPOINTS.askJobs,
      valid,
    );
    expect(createResponse.status).toBe(202);
    const created = (await createResponse.json()) as {
      data: { jobId: string };
    };
    const resultResponse = await authorizedFetch(
      origin,
      getAskJobEndpoint(created.data.jobId, "result"),
    );
    expect(resultResponse.status).toBe(200);
    await expect(resultResponse.json()).resolves.toMatchObject({
      data: {
        snapshot: { status: "answered" },
        result: { sources: [{ relativePath: "src/App.tsx" }] },
      },
    });
    const eventsResponse = await authorizedFetch(
      origin,
      getAskJobEndpoint(created.data.jobId, "events", { afterSequence: 0 }),
    );
    expect(eventsResponse.status).toBe(200);
    expect(eventsResponse.headers.get("content-type")).toContain(
      "application/x-ndjson",
    );
    const events = (await eventsResponse.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { sequence: number });
    expect(events.length).toBeGreaterThan(3);
    expect(events.map((event) => event.sequence)).toEqual(
      [...events].map((event) => event.sequence).sort((left, right) => left - right),
    );
    const lastSequence = events.at(-1)?.sequence ?? 0;
    const emptyReplay = await authorizedFetch(
      origin,
      getAskJobEndpoint(created.data.jobId, "events", {
        afterSequence: lastSequence,
      }),
    );
    expect(emptyReplay.status).toBe(200);
    await expect(emptyReplay.text()).resolves.toBe("");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
