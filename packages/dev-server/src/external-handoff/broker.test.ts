import { request as httpRequest } from "node:http";

import {
  ERROR_CODES,
  EXTERNAL_HANDOFF_LIMITS,
  type ApiResponse,
  type SpotAnnotation,
} from "@spotpatch/shared";
import {
  SPOTPATCH_BRIDGE_PATHS,
  SPOTPATCH_BRIDGE_TOKEN_HEADER,
} from "@spotpatch/shared/external-agent-node";
import { afterEach, describe, expect, it } from "vitest";

import { createExternalHandoffBroker, type ExternalHandoffBroker } from "./broker.js";
import { createActiveAdapterRegistry } from "./active-registry.js";
import { createExternalHandoffStore } from "./store.js";

let broker: ExternalHandoffBroker | undefined;

afterEach(async () => {
  await broker?.close();
  broker = undefined;
});

function annotation(): SpotAnnotation {
  return {
    schemaVersion: 3,
    id: "annotation-id",
    locale: "en-US",
    page: {
      url: "http://127.0.0.1:5173/",
      pathname: "/",
      title: "Fixture",
      viewportWidth: 100,
      viewportHeight: 100,
      devicePixelRatio: 1,
    },
    targets: [
      {
        instruction: "Update it.",
        source: { origin: "none", confidence: "unknown" },
        react: { supported: false, componentStack: [] },
        element: {
          tagName: "div",
          selector: "div",
          sanitizedHtml: "<div></div>",
          rect: { x: 0, y: 0, width: 1, height: 1 },
        },
        styles: { classNames: [], matchedRules: [], computed: {}, warnings: [] },
        warnings: [],
      },
    ],
    createdAt: "2026-08-23T00:00:00.000Z",
  };
}

let requestSequence = 0;

function publish(store: ReturnType<typeof createExternalHandoffStore>) {
  requestSequence += 1;
  return store.publish({
    annotation: annotation(),
    fingerprint: `fingerprint-${String(requestSequence)}`,
    requestId: `request${String(requestSequence).padStart(32, "0")}`,
    reserve: () => Object.freeze({ mode: "inbox" }),
  }).handoff;
}

async function post(
  endpoint: string,
  token: string,
  body: unknown,
  host?: string,
): Promise<Response> {
  if (broker === undefined) throw new Error("Broker is not started.");
  return fetch(`${broker.endpoint}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [SPOTPATCH_BRIDGE_TOKEN_HEADER]: token,
      ...(host === undefined ? {} : { Host: host }),
    },
    body: JSON.stringify(body),
  });
}

async function postWithHost(
  endpoint: string,
  token: string,
  host: string,
): Promise<number | undefined> {
  if (broker === undefined) throw new Error("Broker is not started.");
  const url = new URL(endpoint, broker.endpoint);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      url,
      {
        method: "POST",
        headers: {
          Host: host,
          "Content-Type": "application/json",
          "Content-Length": "2",
          [SPOTPATCH_BRIDGE_TOKEN_HEADER]: token,
        },
      },
      (response) => {
        response.resume();
        response.once("end", () => {
          resolve(response.statusCode);
        });
      },
    );
    request.once("error", reject);
    request.end("{}");
  });
}

describe("external handoff loopback broker", () => {
  it("requires its separate token and exact Host before returning a snapshot", async () => {
    const store = createExternalHandoffStore({
      framework: "vite",
      sessionId: "0123456789abcdef012345",
    });
    const summary = publish(store);
    broker = await createExternalHandoffBroker({
      activeRegistry: createActiveAdapterRegistry(),
      framework: "vite",
      projectKey: "a".repeat(64),
      sessionId: "0123456789abcdef012345",
      store,
    });
    expect(broker.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:[1-9][0-9]+$/u);

    const accepted = await post(SPOTPATCH_BRIDGE_PATHS.current, broker.bridgeToken, {
      cursor: summary.cursor,
    });
    const rejectedToken = await post(
      SPOTPATCH_BRIDGE_PATHS.current,
      "x".repeat(43),
      {},
    );
    const rejectedHost = await postWithHost(
      SPOTPATCH_BRIDGE_PATHS.status,
      broker.bridgeToken,
      "localhost",
    );
    expect(accepted.status).toBe(200);
    await expect(accepted.json()).resolves.toMatchObject({
      ok: true,
      data: { outcome: "handoff", snapshot: { revision: 1 } },
    });
    expect(rejectedToken.status).toBe(401);
    expect(rejectedHost).toBe(401);
    await expect(rejectedToken.json()).resolves.toMatchObject({
      ok: false,
      error: { code: ERROR_CODES.BRIDGE_UNAUTHORIZED },
    });
    store.close();
  });

  it("supports status, wait timeout, and idempotent ack through one strict API", async () => {
    const store = createExternalHandoffStore({
      framework: "next",
      sessionId: "0123456789abcdef012345",
    });
    const summary = publish(store);
    broker = await createExternalHandoffBroker({
      activeRegistry: createActiveAdapterRegistry(),
      framework: "next",
      projectKey: "b".repeat(64),
      sessionId: "0123456789abcdef012345",
      store,
    });
    const token = broker.bridgeToken;
    const status = await post(SPOTPATCH_BRIDGE_PATHS.status, token, {});
    const wait = await post(SPOTPATCH_BRIDGE_PATHS.wait, token, {
      afterCursor: summary.cursor,
      timeoutMs: 1,
    });
    const ack = await post(SPOTPATCH_BRIDGE_PATHS.ack, token, {
      cursor: summary.cursor,
      connectorInstanceId: "connectorinstance0123456789",
    });
    const duplicate = await post(SPOTPATCH_BRIDGE_PATHS.ack, token, {
      cursor: summary.cursor,
      connectorInstanceId: "connectorinstance0123456789",
    });

    expect((await status.json()) as ApiResponse<unknown>).toMatchObject({
      ok: true,
      data: { projectKey: "b".repeat(64), current: { revision: 1 } },
    });
    await expect(wait.json()).resolves.toMatchObject({
      ok: true,
      data: { outcome: "timeout" },
    });
    await expect(ack.json()).resolves.toMatchObject({
      ok: true,
      data: { summary: { pickupCount: 1 } },
    });
    await expect(duplicate.json()).resolves.toMatchObject({
      ok: true,
      data: { summary: { pickupCount: 1 } },
    });
    store.close();
  });

  it("bounds concurrent waits and returns an explicit retry interval", async () => {
    const store = createExternalHandoffStore({
      framework: "vite",
      sessionId: "0123456789abcdef012345",
    });
    const controllers = Array.from(
      { length: EXTERNAL_HANDOFF_LIMITS.maximumWaiters },
      () => new AbortController(),
    );
    const pending = controllers.map((controller) =>
      store.wait(undefined, EXTERNAL_HANDOFF_LIMITS.maximumWaitMs, controller.signal),
    );
    broker = await createExternalHandoffBroker({
      activeRegistry: createActiveAdapterRegistry(),
      framework: "vite",
      projectKey: "c".repeat(64),
      sessionId: "0123456789abcdef012345",
      store,
    });

    const response = await post(SPOTPATCH_BRIDGE_PATHS.wait, broker.bridgeToken, {
      timeoutMs: 1,
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("1");
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: ERROR_CODES.BRIDGE_BUSY },
    });

    store.close();
    await Promise.allSettled(pending);
  });
});
