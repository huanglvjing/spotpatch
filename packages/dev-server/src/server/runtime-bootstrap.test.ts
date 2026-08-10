import { createServer, type Server } from "node:http";

import {
  ERROR_CODES,
  SPOTPATCH_API_BASE,
  SPOTPATCH_ENDPOINTS,
  type SpotPatchRuntimeConfig,
} from "@spotpatch/shared";
import { afterEach, describe, expect, it } from "vitest";

import { resolveOptions } from "../options.js";
import { createSourceRegistry } from "../registry/source-registry.js";
import type { SpotPatchSession } from "../session/session.js";
import { createSpotPatchMiddleware } from "./middleware.js";

const publicOrigin = "http://127.0.0.1:3000";
const session = Object.freeze({
  id: "0123456789abcdef012345",
  token: "0123456789abcdef012345",
}) satisfies SpotPatchSession;
const runtimeConfig = Object.freeze({
  apiBase: SPOTPATCH_API_BASE,
  ai: Object.freeze({ enabled: false }),
  budget: resolveOptions().budget,
  bundler: "turbopack",
  debug: false,
  editor: "auto",
  framework: "next",
  frameworkVersion: "16.3.0",
  locale: "auto",
  maxTargets: 8,
  redact: true,
  routerKind: "app",
  sessionId: session.id,
  sessionToken: session.token,
  shortcut: "Mod+Shift+S",
  spotPatchVersion: "0.1.0",
}) satisfies SpotPatchRuntimeConfig;

interface TestServer {
  readonly origin: string;
  readonly server: Server;
}

let testServer: TestServer | undefined;

async function startServer(): Promise<TestServer> {
  const middleware = createSpotPatchMiddleware({
    bootstrap: { expectedOrigin: publicOrigin, runtimeConfig },
    options: resolveOptions(),
    registry: createSourceRegistry(),
    root: process.cwd(),
    session,
  });
  const server = createServer((request, response) => {
    middleware(request, response, () => {
      response.statusCode = 404;
      response.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP test server address.");
  }

  return Object.freeze({
    origin: `http://127.0.0.1:${String(address.port)}`,
    server,
  });
}

async function closeServer(server: Server): Promise<void> {
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

async function bootstrap(
  body: string,
  headers: Readonly<Record<string, string>>,
): Promise<Response> {
  if (testServer === undefined) {
    throw new Error("The bootstrap test server is unavailable.");
  }

  return fetch(`${testServer.origin}${SPOTPATCH_ENDPOINTS.bootstrap}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body,
  });
}

afterEach(async () => {
  if (testServer !== undefined) {
    await closeServer(testServer.server);
    testServer = undefined;
  }
});

describe("Runtime bootstrap", () => {
  it("returns a strict no-store config to a same-origin browser request", async () => {
    testServer = await startServer();
    const response = await bootstrap("{}", {
      Origin: publicOrigin,
      "Sec-Fetch-Site": "same-origin",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: runtimeConfig,
    });
  });

  it.each([
    [{ Origin: publicOrigin }, ERROR_CODES.ORIGIN_NOT_ALLOWED],
    [
      { Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" },
      ERROR_CODES.ORIGIN_NOT_ALLOWED,
    ],
  ] as const)("rejects untrusted browser metadata", async (headers, code) => {
    testServer = await startServer();
    const response = await bootstrap("{}", headers);

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toContain(code);
  });

  it("rejects non-empty and non-JSON bootstrap bodies", async () => {
    testServer = await startServer();
    const headers = {
      Origin: publicOrigin,
      "Sec-Fetch-Site": "same-origin",
    };
    const injected = await bootstrap('{"root":"/private/project"}', headers);
    const malformed = await bootstrap("not-json", headers);

    expect(injected.status).toBe(400);
    expect(malformed.status).toBe(400);
  });
});
