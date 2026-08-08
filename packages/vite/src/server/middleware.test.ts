import { createServer, type Server } from "node:http";
import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  ERROR_CODES,
  SPOTPATCH_ENDPOINTS,
  SPOTPATCH_TOKEN_HEADER,
  type ApiResponse,
  type CodeContext,
} from "@spotpatch/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveOptions } from "../options.js";
import {
  createSourceRegistry,
  type SourceRegistry,
} from "../registry/source-registry.js";
import type { SpotPatchSession } from "../session/session.js";
import { MAX_REQUEST_BODY_BYTES, MAX_SOURCE_FILE_BYTES } from "./constants.js";
import type { EditorLauncher } from "./editor.js";
import { createSpotPatchMiddleware } from "./middleware.js";

const session = Object.freeze({
  token: "0123456789abcdef0123456789abcdef",
}) satisfies SpotPatchSession;

interface TestServer {
  readonly origin: string;
  readonly server: Server;
}

let root = "";
let externalRoot = "";
let registry: SourceRegistry;
let fileId = "";
let testServer: TestServer | undefined;

async function startServer(editorLauncher?: EditorLauncher): Promise<TestServer> {
  const middleware = createSpotPatchMiddleware({
    options: resolveOptions(),
    registry,
    root,
    session,
    ...(editorLauncher === undefined ? {} : { editorLauncher }),
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
    throw new Error("Expected a TCP test server address.");
  }

  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    server,
  };
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

async function post(
  endpoint: string,
  body: unknown,
  headerOverrides: Readonly<Record<string, string>> = {},
): Promise<Response> {
  if (testServer === undefined) {
    throw new Error("Test server has not started.");
  }

  return fetch(`${testServer.origin}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: testServer.origin,
      [SPOTPATCH_TOKEN_HEADER]: session.token,
      ...headerOverrides,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "spotpatch-root-"));
  externalRoot = await mkdtemp(path.join(tmpdir(), "spotpatch-external-"));
  const sourcePath = path.join(root, "Example.tsx");
  const source = Array.from(
    { length: 120 },
    (_, index) => `export const line${String(index + 1)} = ${String(index + 1)};`,
  ).join("\n");
  await writeFile(sourcePath, source, "utf8");
  registry = createSourceRegistry();
  fileId = registry.register(sourcePath);
  testServer = await startServer();
});

afterEach(async () => {
  if (testServer !== undefined) {
    await stopServer(testServer.server);
    testServer = undefined;
  }

  await Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(externalRoot, { recursive: true, force: true }),
  ]);
});

describe("SpotPatch server middleware", () => {
  it("returns a clamped source excerpt in a no-store envelope", async () => {
    const response = await post(SPOTPATCH_ENDPOINTS.sourceContext, {
      fileId,
      line: 60,
      column: 1,
      maxLines: 10_000,
    });
    const payload = (await response.json()) as ApiResponse<CodeContext>;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(payload).toMatchObject({
      ok: true,
      data: {
        relativePath: "Example.tsx",
        language: "tsx",
        startLine: 20,
        endLine: 99,
        boundary: "nearby-lines",
      },
    });
    expect(payload.ok && payload.data.excerpt.split("\n")).toHaveLength(80);
  });

  it.each([
    { kind: "extra", label: "extra field" },
    { kind: "coordinate", label: "invalid coordinate" },
    { kind: "line", label: "line outside file" },
  ] as const)("rejects an invalid request: $kind ($label)", async ({ kind }) => {
    const body = {
      fileId,
      line: kind === "coordinate" ? 0 : kind === "line" ? 999 : 1,
      column: 1,
      maxLines: 80,
      ...(kind === "extra" ? { extra: true } : {}),
    };
    const response = await post(SPOTPATCH_ENDPOINTS.sourceContext, body);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: ERROR_CODES.INVALID_REQUEST },
    });
  });

  it("rejects missing credentials and foreign origins", async () => {
    const missingToken = await post(
      SPOTPATCH_ENDPOINTS.sourceContext,
      { fileId, line: 1, column: 1, maxLines: 80 },
      { [SPOTPATCH_TOKEN_HEADER]: "" },
    );
    const foreignOrigin = await post(
      SPOTPATCH_ENDPOINTS.sourceContext,
      { fileId, line: 1, column: 1, maxLines: 80 },
      { Origin: "https://evil.example" },
    );

    expect(missingToken.status).toBe(401);
    expect(foreignOrigin.status).toBe(403);
  });

  it("rejects non-JSON and oversized request bodies", async () => {
    if (testServer === undefined) {
      throw new Error("Test server has not started.");
    }

    const nonJson = await fetch(
      `${testServer.origin}${SPOTPATCH_ENDPOINTS.sourceContext}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          Origin: testServer.origin,
          [SPOTPATCH_TOKEN_HEADER]: session.token,
        },
        body: "not json",
      },
    );
    const oversized = await post(SPOTPATCH_ENDPOINTS.sourceContext, {
      padding: "x".repeat(MAX_REQUEST_BODY_BYTES),
    });

    expect(nonJson.status).toBe(400);
    expect(oversized.status).toBe(400);
  });

  it("does not serve unknown, deleted, or oversized registry entries", async () => {
    const deletedPath = path.join(root, "Deleted.tsx");
    await writeFile(deletedPath, "export const Deleted = () => <div />;", "utf8");
    const deletedId = registry.register(deletedPath);
    await rm(deletedPath);

    const largePath = path.join(root, "Large.tsx");
    await writeFile(largePath, "x".repeat(MAX_SOURCE_FILE_BYTES + 1), "utf8");
    const largeId = registry.register(largePath);

    const unknown = await post(SPOTPATCH_ENDPOINTS.sourceContext, {
      fileId: "not-registered",
      line: 1,
      column: 1,
      maxLines: 80,
    });
    const deleted = await post(SPOTPATCH_ENDPOINTS.sourceContext, {
      fileId: deletedId,
      line: 1,
      column: 1,
      maxLines: 80,
    });
    const oversized = await post(SPOTPATCH_ENDPOINTS.sourceContext, {
      fileId: largeId,
      line: 1,
      column: 1,
      maxLines: 80,
    });

    expect(unknown.status).toBe(404);
    expect(deleted.status).toBe(404);
    expect(oversized.status).toBe(413);
  });

  it("rejects a registered symlink that escapes the real project root", async () => {
    const externalPath = path.join(externalRoot, "Secret.tsx");
    const linkPath = path.join(root, "Linked.tsx");
    await writeFile(externalPath, "export const secret = 'never expose';", "utf8");

    try {
      await symlink(externalPath, linkPath, "file");
    } catch (error: unknown) {
      if (
        process.platform === "win32" &&
        error instanceof Error &&
        "code" in error &&
        error.code === "EPERM"
      ) {
        return;
      }

      throw error;
    }

    const linkedId = registry.register(linkPath);
    const response = await post(SPOTPATCH_ENDPOINTS.sourceContext, {
      fileId: linkedId,
      line: 1,
      column: 1,
      maxLines: 80,
    });
    const payload = await response.text();

    expect(response.status).toBe(403);
    expect(payload).toContain(ERROR_CODES.SOURCE_OUTSIDE_ROOT);
    expect(payload).not.toContain(externalPath);
    expect(payload).not.toContain("never expose");
  });

  it("passes only the registered file, coordinates, and configured editor", async () => {
    if (testServer === undefined) {
      throw new Error("Test server has not started.");
    }

    await stopServer(testServer.server);
    const launcher = vi.fn<EditorLauncher>().mockResolvedValue(undefined);
    testServer = await startServer(launcher);

    const response = await post(SPOTPATCH_ENDPOINTS.openEditor, {
      fileId,
      line: 36,
      column: 5,
    });

    expect(response.status).toBe(200);
    expect(launcher).toHaveBeenCalledOnce();
    expect(launcher.mock.calls[0]?.[0]).toBe(
      `${await realpath(path.join(root, "Example.tsx"))}:36:5`,
    );
    expect(launcher.mock.calls[0]?.[1]).toBe("auto");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { editor: "auto" },
    });

    const injectedArguments = await post(SPOTPATCH_ENDPOINTS.openEditor, {
      fileId,
      line: 36,
      column: 5,
      editor: "malicious-command",
    });

    expect(injectedArguments.status).toBe(400);
    expect(launcher).toHaveBeenCalledOnce();
  });

  it("returns a sanitized editor failure", async () => {
    if (testServer === undefined) {
      throw new Error("Test server has not started.");
    }

    await stopServer(testServer.server);
    testServer = await startServer(() =>
      Promise.reject(new Error(`failed for ${path.join(root, "Example.tsx")}`)),
    );

    const response = await post(SPOTPATCH_ENDPOINTS.openEditor, {
      fileId,
      line: 1,
      column: 1,
    });
    const payload = await response.text();

    expect(response.status).toBe(500);
    expect(payload).toContain(ERROR_CODES.EDITOR_OPEN_FAILED);
    expect(payload).not.toContain(root);
    expect(payload).not.toContain("failed for");
  });

  it("delegates requests outside the private API namespace", async () => {
    if (testServer === undefined) {
      throw new Error("Test server has not started.");
    }

    const response = await fetch(`${testServer.origin}/application-route`);

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("not found");
  });
});
