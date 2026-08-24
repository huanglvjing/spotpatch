import { ERROR_CODES, SpotPatchError } from "@spotpatch/shared";
import { describe, expect, it, vi } from "vitest";

import type { HandoffWaitDelivery, SpotPatchBridgeClient } from "../client.js";
import { createActiveEventPump } from "./event-pump.js";
import {
  ActiveDeliveryUnknownError,
  type ActiveBridgeClient,
  type ActiveBridgeLease,
  type AgentAdapter,
  type AgentHandoffSnapshot,
} from "./types.js";

const SESSION_ID = "0123456789abcdef012345";
const BASELINE_CURSOR = "baseline_cursor_0123456789";
const HANDOFF_CURSOR = "handoff_cursor_01234567890";
const LEASE_TOKEN = "lease_token_0123456789012";

type PumpClient = ActiveBridgeClient & Pick<SpotPatchBridgeClient, "wait">;

function snapshot(cursor = HANDOFF_CURSOR): AgentHandoffSnapshot {
  const page = {
    url: "http://127.0.0.1:5173/catalog",
    pathname: "/catalog",
    title: "Catalog",
    viewportWidth: 1_440,
    viewportHeight: 900,
    devicePixelRatio: 2,
  };
  return {
    schemaVersion: 1,
    cursor,
    session: { id: SESSION_ID, framework: "vite" },
    revision: 2,
    publishedAt: "2026-08-23T00:00:00.000Z",
    expiresAt: "2026-08-23T00:15:00.000Z",
    annotation: {
      schemaVersion: 3,
      id: "active-pump-test",
      locale: "en-US",
      page,
      targets: [
        {
          instruction: "Make the card black.",
          source: { origin: "jsx-host", confidence: "exact" },
          react: { supported: true, componentStack: ["Card"] },
          element: {
            tagName: "a",
            selector: "a.card",
            sanitizedHtml: '<a class="card">Card</a>',
            rect: { x: 0, y: 0, width: 100, height: 40 },
          },
          styles: {
            classNames: ["card"],
            matchedRules: [],
            computed: { display: "block" },
            warnings: [],
          },
          warnings: [],
        },
      ],
      createdAt: "2026-08-23T00:00:00.000Z",
    },
  };
}

function lease(index = 0): ActiveBridgeLease {
  return Object.freeze({
    adapterKind: "claude-channel" as const,
    baselineCursor: `${BASELINE_CURSOR}${String(index)}`,
    heartbeatIntervalMs: 60_000,
    leaseToken: `${LEASE_TOKEN}${String(index)}`,
    sessionId: SESSION_ID,
  });
}

function waitUntilAbort(signal?: AbortSignal): Promise<HandoffWaitDelivery> {
  return new Promise((_, reject) => {
    const fail = (): void => {
      reject(new SpotPatchError(ERROR_CODES.SESSION_CLOSED));
    };
    if (signal?.aborted === true) fail();
    else signal?.addEventListener("abort", fail, { once: true });
  });
}

function fakeClient(
  firstDelivery: HandoffWaitDelivery,
  reports: string[],
  afterCursors: (string | undefined)[],
): PumpClient {
  let waits = 0;
  return {
    activeClaim() {
      return Promise.resolve(lease());
    },
    activeHeartbeat() {
      return Promise.resolve();
    },
    activeRelease() {
      return Promise.resolve();
    },
    activeReport(_lease, _cursor, phase) {
      reports.push(phase);
      return Promise.resolve();
    },
    async wait(_sessionId, afterCursor, _timeoutMs, signal) {
      afterCursors.push(afterCursor);
      waits += 1;
      return waits === 1 ? firstDelivery : waitUntilAbort(signal);
    },
  };
}

describe("active event pump", () => {
  it("starts after the atomic baseline and returns to waiting after a terminal delivery", async () => {
    const reports: string[] = [];
    const afterCursors: (string | undefined)[] = [];
    const events: unknown[] = [];
    const adapter: AgentAdapter = {
      kind: "claude-channel",
      close: vi.fn(() => Promise.resolve()),
      async deliver(_handoff, lifecycle) {
        await lifecycle.report("dispatched");
        await lifecycle.report("working");
        await lifecycle.report("completed");
      },
    };
    const pump = createActiveEventPump({
      adapter,
      client: fakeClient(
        { outcome: "handoff", receiptRecorded: true, snapshot: snapshot() },
        reports,
        afterCursors,
      ),
      onEvent: (event) => events.push(event),
    });
    const running = pump.run();

    await vi.waitFor(() => {
      expect(afterCursors).toEqual([`${BASELINE_CURSOR}0`, HANDOFF_CURSOR]);
    });
    expect(reports).toEqual(["dispatching", "dispatched", "working", "completed"]);
    expect(events).toEqual([
      { adapterKind: "claude-channel", type: "ready" },
      {
        adapterKind: "claude-channel",
        phase: "dispatching",
        revision: 2,
        type: "dispatch",
      },
      {
        adapterKind: "claude-channel",
        phase: "dispatched",
        revision: 2,
        type: "dispatch",
      },
      {
        adapterKind: "claude-channel",
        phase: "working",
        revision: 2,
        type: "dispatch",
      },
      {
        adapterKind: "claude-channel",
        phase: "completed",
        revision: 2,
        type: "dispatch",
      },
    ]);

    await pump.close();
    await expect(running).resolves.toBeUndefined();
    expect(adapter.close).toHaveBeenCalledOnce();
  });

  it("fails a task before vendor delivery when automatic pickup receipt fails", async () => {
    const reports: string[] = [];
    const afterCursors: (string | undefined)[] = [];
    const adapter: AgentAdapter = {
      kind: "claude-channel",
      close: vi.fn(() => Promise.resolve()),
      deliver: vi.fn(() => Promise.resolve()),
    };
    const pump = createActiveEventPump({
      adapter,
      client: fakeClient(
        { outcome: "handoff", receiptRecorded: false, snapshot: snapshot() },
        reports,
        afterCursors,
      ),
    });
    const running = pump.run();

    await vi.waitFor(() => {
      expect(afterCursors).toHaveLength(2);
    });
    expect(reports).toEqual(["failed"]);
    expect(adapter.deliver).not.toHaveBeenCalled();

    await pump.close();
    await expect(running).resolves.toBeUndefined();
  });

  it("does not let a diagnostic observer change delivery state", async () => {
    const reports: string[] = [];
    const controller = new AbortController();
    const adapter: AgentAdapter = {
      kind: "claude-channel",
      close: vi.fn(() => Promise.resolve()),
      async deliver(_handoff, lifecycle) {
        await lifecycle.report("dispatched");
        await lifecycle.report("working");
        await lifecycle.report("completed");
        controller.abort();
      },
    };
    const pump = createActiveEventPump({
      adapter,
      client: fakeClient(
        { outcome: "handoff", receiptRecorded: true, snapshot: snapshot() },
        reports,
        [],
      ),
      onEvent() {
        throw new Error("observer failure");
      },
    });

    await expect(pump.run(controller.signal)).resolves.toBeUndefined();
    expect(reports).toEqual(["dispatching", "dispatched", "working", "completed"]);
    await pump.close();
    expect(adapter.close).toHaveBeenCalledOnce();
  });

  it("blocks instead of retrying when an adapter fails after delivery begins", async () => {
    const reports: string[] = [];
    const adapter: AgentAdapter = {
      kind: "claude-channel",
      close: vi.fn(() => Promise.resolve()),
      async deliver(_handoff, lifecycle) {
        await lifecycle.report("dispatched");
        throw new Error("transport lost");
      },
    };
    const client = fakeClient(
      { outcome: "handoff", receiptRecorded: true, snapshot: snapshot() },
      reports,
      [],
    );

    await expect(
      createActiveEventPump({ adapter, client }).run(),
    ).rejects.toBeInstanceOf(ActiveDeliveryUnknownError);
    expect(reports).toEqual(["dispatching", "dispatched", "delivery-unknown"]);
    expect(adapter.close).toHaveBeenCalledOnce();
  });

  it("reclaims a fresh baseline after Broker saturation and a stale cursor", async () => {
    let claims = 0;
    let waits = 0;
    let releases = 0;
    const adapter: AgentAdapter = {
      kind: "claude-channel",
      close: vi.fn(() => Promise.resolve()),
      deliver: vi.fn(() => Promise.resolve()),
    };
    const client: PumpClient = {
      activeClaim() {
        claims += 1;
        return Promise.resolve(lease(claims));
      },
      activeHeartbeat() {
        return Promise.resolve();
      },
      activeRelease() {
        releases += 1;
        return Promise.resolve();
      },
      activeReport() {
        return Promise.resolve();
      },
      async wait(_sessionId, _afterCursor, _timeoutMs, signal) {
        waits += 1;
        if (waits === 1) {
          throw new SpotPatchError(ERROR_CODES.BRIDGE_BUSY);
        }
        if (waits === 2) {
          throw new SpotPatchError(ERROR_CODES.HANDOFF_CURSOR_INVALID);
        }

        return waitUntilAbort(signal);
      },
    };
    const pump = createActiveEventPump({
      adapter,
      client,
      random: () => 0,
      retryBaseMs: 1,
      retryMaxMs: 1,
    });
    const running = pump.run();

    await vi.waitFor(() => {
      expect(claims).toBe(3);
      expect(waits).toBe(3);
    });
    expect(adapter.deliver).not.toHaveBeenCalled();

    await pump.close();
    await expect(running).resolves.toBeUndefined();
    expect(releases).toBe(3);
  });

  it.each([ERROR_CODES.SESSION_NOT_FOUND, ERROR_CODES.SESSION_CLOSED])(
    "stops when the exact development Session cannot be reused (%s)",
    async (code) => {
      const activeClaim = vi.fn(() => Promise.reject(new SpotPatchError(code)));
      const adapter: AgentAdapter = {
        kind: "codex-app-server",
        close: vi.fn(() => Promise.resolve()),
        deliver: vi.fn(() => Promise.resolve()),
      };
      const client = {
        activeClaim,
        activeHeartbeat: vi.fn(),
        activeRelease: vi.fn(),
        activeReport: vi.fn(),
        wait: vi.fn(),
      } satisfies PumpClient;

      await expect(
        createActiveEventPump({
          adapter,
          client,
          random: () => 0,
          retryBaseMs: 1,
          retryMaxMs: 1,
          sessionId: SESSION_ID,
        }).run(),
      ).rejects.toMatchObject({ code });
      expect(activeClaim).toHaveBeenCalledOnce();
      expect(adapter.close).toHaveBeenCalledOnce();
    },
  );
});
