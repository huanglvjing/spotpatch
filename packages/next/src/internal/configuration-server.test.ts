import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NEXT_INTERNAL_CONFIGURATION_PATH,
  NEXT_IPC_PROTOCOL_VERSION,
} from "./constants.js";
import { createConfigurationRequestHandler } from "./configuration-server.js";
import type { NextConfigureAck } from "./ipc.js";

const configurationSecret = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGH";
const nonce = "0123456789abcdefghijklmn";
const requestId = "zyxwvutsrqponmlkjihgfedc";
const acknowledgement = Object.freeze({
  nonce,
  ok: true,
  protocolVersion: NEXT_IPC_PROTOCOL_VERSION,
  requestId,
  type: "spotpatch:next:configure-ack",
}) satisfies NextConfigureAck;

interface TestServer {
  readonly origin: string;
  readonly server: Server;
}

let testServer: TestServer | undefined;

async function startServer(
  onConfiguration: (value: unknown) => Promise<NextConfigureAck | undefined>,
): Promise<TestServer> {
  const handler = createConfigurationRequestHandler({
    configurationSecret,
    onConfiguration,
  });
  const server = createServer(handler);

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

async function configure(
  body: string,
  headers: Readonly<Record<string, string>> = {},
): Promise<Response> {
  if (testServer === undefined) {
    throw new Error("The configuration test server is unavailable.");
  }

  return fetch(`${testServer.origin}${NEXT_INTERNAL_CONFIGURATION_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-SpotPatch-Configuration": configurationSecret,
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

describe("Next configuration server", () => {
  it("accepts an authenticated loopback request and returns a no-store ack", async () => {
    const onConfiguration = vi.fn(() => Promise.resolve(acknowledgement));
    testServer = await startServer(onConfiguration);
    const payload = { nonce, requestId };
    const response = await configure(JSON.stringify(payload));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(acknowledgement);
    expect(onConfiguration).toHaveBeenCalledOnce();
    expect(onConfiguration).toHaveBeenCalledWith(payload);
  });

  it.each([
    { Origin: "http://127.0.0.1:3000" },
    { "X-SpotPatch-Configuration": "wrong-secret-value" },
  ])("rejects browser-origin and unauthenticated requests", async (headers) => {
    const onConfiguration = vi.fn(() => Promise.resolve(acknowledgement));
    testServer = await startServer(onConfiguration);
    const response = await configure("{}", headers);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ ok: false });
    expect(onConfiguration).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON before invoking the configuration owner", async () => {
    const onConfiguration = vi.fn(() => Promise.resolve(acknowledgement));
    testServer = await startServer(onConfiguration);
    const response = await configure("not-json");

    expect(response.status).toBe(400);
    expect(onConfiguration).not.toHaveBeenCalled();
  });

  it("rejects weak configuration secrets at construction time", () => {
    expect(() =>
      createConfigurationRequestHandler({
        configurationSecret: "short",
        onConfiguration: () => Promise.resolve(acknowledgement),
      }),
    ).toThrow(TypeError);
  });
});
