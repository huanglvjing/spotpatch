// @vitest-environment jsdom

import {
  EXTERNAL_AGENT_CONTROL_LIMITS,
  SPOTPATCH_ENDPOINTS,
  SPOTPATCH_TOKEN_HEADER,
} from "@spotpatch/shared";
import { describe, expect, it, vi } from "vitest";

import {
  createExternalAgentControlClient,
  parseExternalAgentControlStatus,
  parseExternalAgentManagedResult,
} from "./external-agent-control-client.js";

const STATUS = Object.freeze({
  schemaVersion: 1,
  sequence: 7,
  mode: "managed",
  adapter: Object.freeze({
    kind: "codex",
    maturity: "experimental",
    availability: "available",
  }),
  connectionState: "ready",
  authReadiness: "authenticated",
  grantState: "valid",
  effectiveModel: "gpt-5.6-codex",
  updatedAt: "2026-08-25T00:00:00.000Z",
});

function envelope(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("external Agent control browser client", () => {
  it("accepts bounded model catalogs and rejects malformed catalogs", () => {
    expect(
      parseExternalAgentControlStatus({ ...STATUS, models: ["a", "b"] }).models,
    ).toEqual(["a", "b"]);
    for (const models of [
      [],
      ["a", "a"],
      [" a"],
      [1],
      ["x".repeat(EXTERNAL_AGENT_CONTROL_LIMITS.maximumModelCharacters + 1)],
      Array.from(
        { length: EXTERNAL_AGENT_CONTROL_LIMITS.maximumModels + 1 },
        (_, index) => String(index),
      ),
    ]) {
      expect(() => parseExternalAgentControlStatus({ ...STATUS, models })).toThrow(
        "Invalid external Agent control status",
      );
    }
  });
  it("strictly accepts the managed status and rejects response drift", () => {
    expect(parseExternalAgentControlStatus(STATUS)).toMatchObject({
      sequence: 7,
      connectionState: "ready",
      effectiveModel: "gpt-5.6-codex",
    });
    expect(() =>
      parseExternalAgentControlStatus({ ...STATUS, unexpected: true }),
    ).toThrow("Invalid external Agent control status");
    expect(() =>
      parseExternalAgentControlStatus({
        ...STATUS,
        updatedAt: "2026-02-31T00:00:00.000Z",
      }),
    ).toThrow("Invalid external Agent control status");
  });

  it("rejects unsafe result paths before rendering a diff", () => {
    expect(() =>
      parseExternalAgentManagedResult({
        revision: 2,
        diff: "diff",
        files: [{ path: "../outside.ts", additions: 1, deletions: 0 }],
        checks: [],
        timings: {},
        validationOutcome: "passed",
        expiresAt: "2026-08-25T00:15:00.000Z",
      }),
    ).toThrow("Invalid managed file summary");
  });

  it("authenticates and parses a bounded NDJSON event stream", async () => {
    const encoder = new TextEncoder();
    const lines = [
      JSON.stringify({ type: "status", data: STATUS }),
      JSON.stringify({
        type: "heartbeat",
        sequence: 7,
        emittedAt: "2026-08-25T00:00:01.000Z",
      }),
    ].join("\n");
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      expect(input).toBe(SPOTPATCH_ENDPOINTS.externalAgentEvents);
      expect(init?.headers).toMatchObject({
        [SPOTPATCH_TOKEN_HEADER]: "session-token",
      });
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              const bytes = encoder.encode(`${lines}\n`);
              controller.enqueue(bytes.slice(0, 17));
              controller.enqueue(bytes.slice(17));
              controller.close();
            },
          }),
          { status: 200 },
        ),
      );
    });
    const client = createExternalAgentControlClient(fetchMock, "session-token");
    const events: unknown[] = [];

    await client.events(6, new AbortController().signal, (event) => {
      events.push(event);
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "status", data: { sequence: 7 } });
    expect(events[1]).toMatchObject({ type: "heartbeat", sequence: 7 });
  });

  it("rejects an event record above the protocol limit", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new Uint8Array(
                  EXTERNAL_AGENT_CONTROL_LIMITS.maximumEventLineBytes + 1,
                ).fill(0x20),
              );
              controller.close();
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const client = createExternalAgentControlClient(fetchMock, "session-token");

    await expect(
      client.events(undefined, new AbortController().signal, () => undefined),
    ).rejects.toThrow("exceeds its limit");
  });

  it("reads a retained result through the bounded result endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      expect(input).toBe(SPOTPATCH_ENDPOINTS.externalAgentResult);
      return Promise.resolve(
        envelope({
          revision: 3,
          diff: "diff --git a/src/a.ts b/src/a.ts",
          files: [{ path: "src/a.ts", additions: 1, deletions: 0 }],
          checks: [{ id: "test", outcome: "passed", durationMs: 10, exitCode: 0 }],
          timings: { total: 20 },
          validationOutcome: "passed",
          expiresAt: "2026-08-25T00:15:00.000Z",
        }),
      );
    });
    const client = createExternalAgentControlClient(fetchMock, "session-token");

    await expect(client.result(3)).resolves.toMatchObject({
      revision: 3,
      validationOutcome: "passed",
    });
  });
});
