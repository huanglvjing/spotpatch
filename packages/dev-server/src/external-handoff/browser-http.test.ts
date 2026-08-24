import { createServer, type Server } from "node:http";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ERROR_CODES,
  SPOTPATCH_ENDPOINTS,
  SPOTPATCH_TOKEN_HEADER,
  type ApiResponse,
  type ExternalHandoffPublishResult,
} from "@spotpatch/shared";
import {
  SPOTPATCH_BRIDGE_PATHS,
  SPOTPATCH_BRIDGE_TOKEN_HEADER,
  externalHandoffDescriptorSchema,
  resolveExternalHandoffRuntimeDirectory,
  type BridgeActiveClaimResult,
  type ExternalHandoffDescriptor,
} from "@spotpatch/shared/external-agent-node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveOptions } from "../options.js";
import { createSourceRegistry } from "../registry/source-registry.js";
import type { SpotPatchSession } from "../session/session.js";
import { createSpotPatchMiddleware } from "../server/middleware.js";
import {
  createExternalHandoffService,
  type ExternalHandoffService,
} from "./service.js";

const session = Object.freeze({
  id: "0123456789abcdef012345",
  token: "abcdefghijklmnopqrstuvwxyz012345",
}) satisfies SpotPatchSession;

let root = "";
let runtimeRoot = "";
let origin = "";
let server: Server | undefined;
let service: ExternalHandoffService | undefined;
let fileId = "";

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "spotpatch-handoff-browser-"));
  runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "spotpatch-handoff-runtime-"));
  await chmod(runtimeRoot, 0o700);
  vi.stubEnv("XDG_RUNTIME_DIR", runtimeRoot);
  await mkdir(path.join(root, "src"));
  const sourcePath = path.join(root, "src", "App.tsx");
  await writeFile(
    sourcePath,
    [
      "export function App(): JSX.Element {",
      "  return (",
      "    <button>Current source</button>",
      "  );",
      "}",
    ].join("\n"),
  );
  const registry = createSourceRegistry();
  fileId = registry.register(sourcePath);
  service = createExternalHandoffService({
    framework: "vite",
    root,
    sessionId: session.id,
  });
  await service.start();
  const middleware = createSpotPatchMiddleware({
    externalHandoffService: service,
    options: resolveOptions({ externalAgent: true }),
    registry,
    root,
    session,
  });
  server = createServer((request, response) => {
    middleware(request, response, () => {
      response.statusCode = 404;
      response.end();
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Missing server.");
  origin = `http://127.0.0.1:${String(address.port)}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) =>
    server?.close(() => {
      resolve();
    }),
  );
  server = undefined;
  await service?.close();
  service = undefined;
  vi.unstubAllEnvs();
  await Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(runtimeRoot, { recursive: true, force: true }),
  ]);
});

function annotation() {
  return {
    schemaVersion: 3,
    id: "annotation-id",
    locale: "en-US",
    page: {
      url: `${origin}/settings?token=private`,
      pathname: "/settings",
      title: "Settings token=private",
      viewportWidth: 1_440,
      viewportHeight: 900,
      devicePixelRatio: 2,
    },
    targets: [
      {
        instruction: "Change the button label.",
        page: {
          url: `${origin}/settings?api_key=private`,
          pathname: "/settings?token=private",
          title: "Target secret=private",
          viewportWidth: 1_440,
          viewportHeight: 900,
          devicePixelRatio: 2,
        },
        source: {
          fileId,
          relativePath: "src/App.tsx",
          line: 3,
          column: 5,
          origin: "jsx-host",
          confidence: "exact",
        },
        react: { supported: true, componentName: "App", componentStack: ["App"] },
        element: {
          tagName: "button",
          selector: "button",
          sanitizedHtml: "<button>Current source</button>",
          rect: { x: 0, y: 0, width: 100, height: 40 },
        },
        styles: {
          classNames: [],
          matchedRules: [],
          computed: { display: "block" },
          warnings: [],
        },
        code: {
          relativePath: "src/App.tsx",
          language: "tsx",
          startLine: 1,
          endLine: 1,
          excerpt: "forged browser source",
          boundary: "nearby-lines",
        },
        warnings: [],
      },
    ],
    createdAt: "2026-08-23T00:00:00.000Z",
  };
}

function browserPost(endpoint: string, body: unknown): Promise<Response> {
  return fetch(`${origin}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      [SPOTPATCH_TOKEN_HEADER]: session.token,
    },
    body: JSON.stringify(body),
  });
}

async function readDescriptor(): Promise<ExternalHandoffDescriptor> {
  const directory = await resolveExternalHandoffRuntimeDirectory(false);
  const entries = await readdir(directory);
  return externalHandoffDescriptorSchema.parse(
    JSON.parse(await readFile(path.join(directory, entries[0] ?? "missing"), "utf8")),
  );
}

function bridgePost(
  descriptor: ExternalHandoffDescriptor,
  endpoint: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${descriptor.endpoint}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [SPOTPATCH_BRIDGE_TOKEN_HEADER]: descriptor.bridgeToken,
    },
    body: JSON.stringify(body),
  });
}

describe("external handoff browser API", () => {
  it("publishes only a server-authorized snapshot and returns summaries to the page", async () => {
    const capability = await browserPost(
      SPOTPATCH_ENDPOINTS.externalHandoffCapability,
      {},
    );
    const published = await browserPost(SPOTPATCH_ENDPOINTS.externalHandoffPublish, {
      requestId: "publishrequest012345678901234567890123",
      annotation: annotation(),
    });
    const publishedPayload =
      (await published.json()) as ApiResponse<ExternalHandoffPublishResult>;
    expect(capability.status).toBe(200);
    await expect(capability.json()).resolves.toMatchObject({
      ok: true,
      data: { enabled: true, brokerReady: true },
    });
    expect(published.status).toBe(201);
    expect(publishedPayload).toMatchObject({
      ok: true,
      data: {
        handoff: { revision: 1, targetCount: 1, pickupCount: 0 },
        delivery: { mode: "inbox" },
        replayed: false,
      },
    });
    expect(JSON.stringify(publishedPayload)).not.toContain("Change the button label");
    expect(JSON.stringify(publishedPayload)).not.toContain("private");

    const descriptor = await readDescriptor();
    const snapshotResponse = await bridgePost(
      descriptor,
      SPOTPATCH_BRIDGE_PATHS.current,
      {},
    );
    const snapshot = (await snapshotResponse.json()) as unknown;
    expect(snapshot).toMatchObject({
      ok: true,
      data: {
        snapshot: {
          annotation: {
            targets: [{ code: { relativePath: "src/App.tsx" } }],
          },
        },
      },
    });
    expect(JSON.stringify(snapshot)).toContain("Current source");
    expect(JSON.stringify(snapshot)).not.toContain("forged browser source");
    expect(JSON.stringify(snapshot)).not.toContain("private");
    expect(JSON.stringify(snapshot)).toContain("%5Bredacted%5D");

    const cursor = publishedPayload.ok
      ? publishedPayload.data.handoff.cursor
      : "missing";
    const status = await browserPost(SPOTPATCH_ENDPOINTS.externalHandoffStatus, {
      cursor,
    });
    await expect(status.json()).resolves.toMatchObject({
      ok: true,
      data: { handoff: { cursor, state: "available" } },
    });
  });

  it("rejects stale source identity without advancing the revision", async () => {
    const response = await browserPost(SPOTPATCH_ENDPOINTS.externalHandoffPublish, {
      requestId: "stalerequest01234567890123456789012345",
      annotation: {
        ...annotation(),
        targets: [
          {
            ...annotation().targets[0],
            source: {
              ...annotation().targets[0]?.source,
              relativePath: "src/Forged.tsx",
            },
          },
        ],
      },
    });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: ERROR_CODES.HANDOFF_VALIDATION_FAILED },
    });
    const status = await browserPost(SPOTPATCH_ENDPOINTS.externalHandoffStatus, {});
    expect(status.status).toBe(404);
  });

  it("dispatches two consecutive clicks through one ready active adapter", async () => {
    const descriptor = await readDescriptor();
    const claimResponse = await bridgePost(
      descriptor,
      SPOTPATCH_BRIDGE_PATHS.activeClaim,
      {
        adapterKind: "claude-channel",
        connectorInstanceId: "connectorinstance0123456789",
      },
    );
    const claimPayload =
      (await claimResponse.json()) as ApiResponse<BridgeActiveClaimResult>;
    if (!claimPayload.ok) throw new Error("Active adapter claim failed.");
    expect(claimPayload.data.baselineCursor).toBeNull();

    const firstResponse = await browserPost(
      SPOTPATCH_ENDPOINTS.externalHandoffPublish,
      {
        requestId: "activefirstrequest0123456789012345678",
        annotation: annotation(),
      },
    );
    const firstPayload =
      (await firstResponse.json()) as ApiResponse<ExternalHandoffPublishResult>;
    if (!firstPayload.ok) throw new Error("Active publish failed.");
    expect(firstPayload.data).toMatchObject({
      handoff: { revision: 1 },
      delivery: {
        mode: "active",
        adapter: { state: "busy", canDispatch: false },
        dispatch: { phase: "queued" },
      },
    });

    for (const phase of ["dispatching", "working", "completed"] as const) {
      const response = await bridgePost(
        descriptor,
        SPOTPATCH_BRIDGE_PATHS.activeReport,
        {
          leaseToken: claimPayload.data.leaseToken,
          cursor: firstPayload.data.handoff.cursor,
          phase,
        },
      );
      expect(response.status).toBe(200);
    }

    const completed = await browserPost(SPOTPATCH_ENDPOINTS.externalHandoffStatus, {});
    await expect(completed.json()).resolves.toMatchObject({
      ok: true,
      data: {
        handoff: { revision: 1 },
        activeAdapter: { state: "ready", canDispatch: true },
        dispatch: { phase: "completed" },
      },
    });

    const second = await browserPost(SPOTPATCH_ENDPOINTS.externalHandoffPublish, {
      requestId: "activesecondrequest012345678901234567",
      annotation: annotation(),
    });
    expect(second.status).toBe(201);
    await expect(second.json()).resolves.toMatchObject({
      ok: true,
      data: {
        handoff: { revision: 2 },
        delivery: { mode: "active", dispatch: { phase: "queued" } },
      },
    });
  });

  it("requires explicit exact-cursor resolution after unknown delivery", async () => {
    const descriptor = await readDescriptor();
    const claimResponse = await bridgePost(
      descriptor,
      SPOTPATCH_BRIDGE_PATHS.activeClaim,
      {
        adapterKind: "codex-app-server",
        connectorInstanceId: "connectorinstance0123456789",
      },
    );
    const claimPayload =
      (await claimResponse.json()) as ApiResponse<BridgeActiveClaimResult>;
    if (!claimPayload.ok) throw new Error("Active adapter claim failed.");
    const firstResponse = await browserPost(
      SPOTPATCH_ENDPOINTS.externalHandoffPublish,
      {
        requestId: "unknownfirstrequest012345678901234567",
        annotation: annotation(),
      },
    );
    const firstPayload =
      (await firstResponse.json()) as ApiResponse<ExternalHandoffPublishResult>;
    if (!firstPayload.ok) throw new Error("Active publish failed.");
    const cursor = firstPayload.data.handoff.cursor;

    await bridgePost(descriptor, SPOTPATCH_BRIDGE_PATHS.activeReport, {
      leaseToken: claimPayload.data.leaseToken,
      cursor,
      phase: "dispatching",
    });
    await bridgePost(descriptor, SPOTPATCH_BRIDGE_PATHS.activeRelease, {
      leaseToken: claimPayload.data.leaseToken,
    });

    const blockedRequest = {
      requestId: "unknownblockedrequest0123456789012345",
      annotation: annotation(),
    };
    const blocked = await browserPost(
      SPOTPATCH_ENDPOINTS.externalHandoffPublish,
      blockedRequest,
    );
    expect(blocked.status).toBe(409);
    await expect(blocked.json()).resolves.toMatchObject({
      ok: false,
      error: { code: ERROR_CODES.EXTERNAL_AGENT_BUSY },
    });

    const invalid = await browserPost(
      SPOTPATCH_ENDPOINTS.externalHandoffResolveDelivery,
      { cursor, confirmation: "yes" },
    );
    expect(invalid.status).toBe(400);
    const resolved = await browserPost(
      SPOTPATCH_ENDPOINTS.externalHandoffResolveDelivery,
      { cursor, confirmation: "workspace-reviewed" },
    );
    await expect(resolved.json()).resolves.toMatchObject({
      ok: true,
      data: {
        handoff: { cursor, revision: 1 },
        activeAdapter: null,
        dispatch: { phase: "delivery-unknown" },
      },
    });

    const inbox = await browserPost(
      SPOTPATCH_ENDPOINTS.externalHandoffPublish,
      blockedRequest,
    );
    expect(inbox.status).toBe(201);
    await expect(inbox.json()).resolves.toMatchObject({
      ok: true,
      data: { handoff: { revision: 2 }, delivery: { mode: "inbox" } },
    });
  });
});
