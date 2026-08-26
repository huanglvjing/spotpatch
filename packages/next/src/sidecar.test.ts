import { createServer, type RequestListener, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { resolveOptions } from "@spotpatch/dev-server";
import { SPOTPATCH_ENDPOINTS, runtimeConfigSchema } from "@spotpatch/shared";

import { createNextSidecar, type NextSidecar } from "./sidecar.js";

const configurationSecret = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGH";
const internalSecret = "abcdefghijklmnopqrstuvwxyz012345ABCDEFGH";
const registryEpoch = "0123456789abcdefghijklmn";
const publicOrigin = "http://127.0.0.1:3000";

let sidecar: NextSidecar | undefined;
const publicServers: Server[] = [];

async function listenPublicServer(
  handler: RequestListener,
): Promise<Readonly<{ origin: string; server: Server }>> {
  const server = createServer(handler);
  publicServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("Expected a loopback HTTP server.");
  }

  return Object.freeze({
    origin: `http://127.0.0.1:${String(address.port)}`,
    server,
  });
}

afterEach(async () => {
  await sidecar?.close();
  sidecar = undefined;
  await Promise.all(
    publicServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error === undefined) resolve();
            else reject(error);
          });
        }),
    ),
  );
});

describe("Next Sidecar", () => {
  it("activates with a schema-normalized runtime configuration", async () => {
    sidecar = await createNextSidecar({
      configuration: {
        configurationSecret,
        onConfiguration: () => Promise.resolve(undefined),
      },
    });
    await sidecar.activate({
      appRoot: process.cwd(),
      bundler: "turbopack",
      credentials: Object.freeze({}),
      internalSecret,
      nextVersion: "16.3.0",
      options: resolveOptions(),
      projectRoot: process.cwd(),
      publicOrigin,
      registryEpoch,
      routerKind: "app",
    });
    const response = await fetch(
      new URL(SPOTPATCH_ENDPOINTS.bootstrap, sidecar.origin),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: publicOrigin,
          "Sec-Fetch-Site": "same-origin",
        },
        body: "{}",
      },
    );
    const payload = (await response.json()) as unknown;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(payload).toMatchObject({ ok: true });

    if (typeof payload !== "object" || payload === null || !("data" in payload)) {
      throw new TypeError("Expected a SpotPatch bootstrap payload.");
    }

    expect(runtimeConfigSchema.safeParse(payload.data).success).toBe(true);
  });

  it("verifies bootstrap through the host public origin", async () => {
    let publicHostOrigin = "";
    const publicHost = await listenPublicServer((request, response) => {
      void (async () => {
        if (sidecar === undefined) {
          response.writeHead(503).end();
          return;
        }

        const upstream = await fetch(new URL(request.url ?? "/", sidecar.origin), {
          method: request.method ?? "GET",
          headers: {
            "Content-Type": "application/json",
            Origin: publicHostOrigin,
            "Sec-Fetch-Site": "same-origin",
          },
          ...(request.method === "POST" ? { body: "{}" } : {}),
        });
        response.statusCode = upstream.status;
        response.setHeader(
          "Content-Type",
          upstream.headers.get("content-type") ?? "application/json",
        );
        response.setHeader(
          "Cache-Control",
          upstream.headers.get("cache-control") ?? "no-store",
        );
        response.end(await upstream.text());
      })().catch(() => {
        if (!response.writableEnded) response.writeHead(500).end();
      });
    });
    publicHostOrigin = publicHost.origin;
    sidecar = await createNextSidecar({
      configuration: {
        configurationSecret,
        onConfiguration: () => Promise.resolve(undefined),
      },
    });
    await sidecar.activate({
      appRoot: process.cwd(),
      bundler: "turbopack",
      credentials: Object.freeze({}),
      internalSecret,
      nextVersion: "16.3.0",
      options: resolveOptions(),
      projectRoot: process.cwd(),
      publicOrigin: publicHostOrigin,
      registryEpoch,
      routerKind: "app",
    });

    await expect(sidecar.checkPublicRoute()).resolves.toEqual({ ok: true });
  });

  it("reports a public Proxy redirect without following it", async () => {
    const publicHost = await listenPublicServer((_request, response) => {
      response.statusCode = 307;
      response.setHeader("Location", `/zh-CN${SPOTPATCH_ENDPOINTS.bootstrap}`);
      response.end();
    });
    sidecar = await createNextSidecar({
      configuration: {
        configurationSecret,
        onConfiguration: () => Promise.resolve(undefined),
      },
    });
    await sidecar.activate({
      appRoot: process.cwd(),
      bundler: "turbopack",
      credentials: Object.freeze({}),
      internalSecret,
      nextVersion: "16.3.0",
      options: resolveOptions(),
      projectRoot: process.cwd(),
      publicOrigin: publicHost.origin,
      registryEpoch,
      routerKind: "app",
    });

    await expect(sidecar.checkPublicRoute()).resolves.toEqual({
      finalUrl: `${publicHost.origin}/zh-CN${SPOTPATCH_ENDPOINTS.bootstrap}`,
      kind: "http",
      ok: false,
      status: 307,
    });
  });
});
