import { createServer, type Server } from "node:http";

import {
  ERROR_CODES,
  SPOTPATCH_ENDPOINTS,
  SPOTPATCH_TOKEN_HEADER,
  type ApiResponse,
  type ExternalAgentControlStatus,
} from "@spotpatch/shared";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { resolveOptions } from "../options.js";
import { createSourceRegistry } from "../registry/source-registry.js";
import type { SpotPatchSession } from "../session/session.js";
import {
  createSpotPatchMiddleware,
  type SpotPatchMiddleware,
} from "../server/middleware.js";
import type { ExternalAgentControlPort } from "./control-port.js";

const session = Object.freeze({
  id: "0123456789abcdef012345",
  token: "abcdefghijklmnopqrstuvwxyz012345",
}) satisfies SpotPatchSession;

const disconnectedStatus: ExternalAgentControlStatus = Object.freeze({
  schemaVersion: 1,
  sequence: 0,
  mode: "inbox",
  adapter: Object.freeze({
    kind: "codex",
    maturity: "experimental",
    availability: "unavailable",
  }),
  connectionState: "disconnected",
  authReadiness: "unknown",
  grantState: "missing",
  updatedAt: "2026-08-25T00:00:00.000Z",
});

let middleware: SpotPatchMiddleware | undefined;
let origin = "";
let server: Server | undefined;
let port: ExternalAgentControlPort;
let connectMock: Mock<ExternalAgentControlPort["connect"]>;
let getStatusMock: Mock<ExternalAgentControlPort["getStatus"]>;

beforeEach(async () => {
  connectMock = vi.fn(() => Promise.resolve(disconnectedStatus));
  getStatusMock = vi.fn(() => disconnectedStatus);
  port = {
    getStatus: getStatusMock,
    connect: connectMock,
    disconnect: vi.fn(() => Promise.resolve(disconnectedStatus)),
    cancel: vi.fn(() => Promise.resolve(disconnectedStatus)),
    getResult: vi.fn(() => undefined),
    subscribe: vi.fn(() => () => undefined),
    dispose: vi.fn(() => Promise.resolve()),
  };
  middleware = createSpotPatchMiddleware({
    externalAgentControl: port,
    options: resolveOptions({ externalAgent: true }),
    registry: createSourceRegistry(),
    root: process.cwd(),
    session,
  });
  server = createServer((request, response) => {
    middleware?.(request, response, () => {
      response.statusCode = 404;
      response.end();
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP test server address.");
  }
  origin = `http://127.0.0.1:${String(address.port)}`;
});

afterEach(async () => {
  middleware?.dispose();
  middleware = undefined;
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
  server = undefined;
});

function post(
  endpoint: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(`${origin}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      [SPOTPATCH_TOKEN_HEADER]: session.token,
    },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  });
}

describe("external Agent browser control", () => {
  it("returns the strict current status without exposing port internals", async () => {
    const response = await post(SPOTPATCH_ENDPOINTS.externalAgentControlStatus, {});
    const payload = (await response.json()) as ApiResponse<ExternalAgentControlStatus>;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(payload).toEqual({ ok: true, data: disconnectedStatus });
    expect(getStatusMock).toHaveBeenCalledOnce();
  });

  it("rejects non-fixed profiles before invoking the control port", async () => {
    const response = await post(SPOTPATCH_ENDPOINTS.externalAgentControlConnect, {
      requestId: "abcdefghijklmnopqrstuv",
      adapterKind: "codex",
      profile: "workspace-write",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: ERROR_CODES.INVALID_REQUEST },
    });
    expect(connectMock).not.toHaveBeenCalled();
  });

  it("emits an immediate bounded NDJSON status event", async () => {
    const controller = new AbortController();
    const response = await post(
      SPOTPATCH_ENDPOINTS.externalAgentEvents,
      { afterSequence: 0 },
      controller.signal,
    );
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error("Expected an event response body.");
    const first = await reader.read();
    const line = new TextDecoder().decode(first.value).trim();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(JSON.parse(line)).toEqual({ type: "status", data: disconnectedStatus });
    controller.abort();
    await reader.cancel().catch(() => undefined);
  });
});
