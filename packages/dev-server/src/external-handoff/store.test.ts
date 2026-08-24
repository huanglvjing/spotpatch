import {
  ERROR_CODES,
  EXTERNAL_HANDOFF_LIMITS,
  type ErrorCode,
  type SpotAnnotation,
} from "@spotpatch/shared";
import { describe, expect, it } from "vitest";

import { createExternalHandoffStore, type ExternalHandoffStore } from "./store.js";

function expectErrorCode(action: () => unknown, code: ErrorCode): void {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toMatchObject({ code });
    return;
  }

  throw new Error(`Expected SpotPatch error ${code}.`);
}

function annotation(instruction = "Update this component."): SpotAnnotation {
  return Object.freeze({
    schemaVersion: 3,
    id: "annotation-id",
    locale: "en-US",
    page: Object.freeze({
      url: "http://127.0.0.1:5173/settings?token=not-in-summary",
      pathname: "/settings",
      title: "Settings",
      viewportWidth: 1_440,
      viewportHeight: 900,
      devicePixelRatio: 2,
    }),
    targets: Object.freeze([
      Object.freeze({
        instruction,
        source: Object.freeze({ origin: "none", confidence: "unknown" }),
        react: Object.freeze({ supported: false, componentStack: Object.freeze([]) }),
        element: Object.freeze({
          tagName: "button",
          selector: "button",
          sanitizedHtml: "<button>Save</button>",
          rect: Object.freeze({ x: 0, y: 0, width: 100, height: 40 }),
        }),
        styles: Object.freeze({
          classNames: Object.freeze([]),
          matchedRules: Object.freeze([]),
          computed: Object.freeze({ display: "block" }),
          warnings: Object.freeze([]),
        }),
        warnings: Object.freeze([]),
      }),
    ]),
    createdAt: "2026-08-23T00:00:00.000Z",
  });
}

let requestSequence = 0;

function publish(
  store: ExternalHandoffStore,
  value: SpotAnnotation,
  fingerprint = `fingerprint-${String(requestSequence)}`,
) {
  requestSequence += 1;
  return store.publish({
    annotation: value,
    fingerprint,
    requestId: `request${String(requestSequence).padStart(32, "0")}`,
    reserve: () => Object.freeze({ mode: "inbox" }),
  }).handoff;
}

function publishResult(
  store: ExternalHandoffStore,
  value: SpotAnnotation,
  requestId: string,
  fingerprint: string,
) {
  return store.publish({
    annotation: value,
    fingerprint,
    requestId,
    reserve: () => Object.freeze({ mode: "inbox" }),
  });
}

describe("external handoff store", () => {
  it("publishes one immutable current snapshot and records idempotent pickups", () => {
    let monotonic = 1_000;
    let wall = Date.parse("2026-08-23T00:00:00.000Z");
    const store = createExternalHandoffStore({
      framework: "vite",
      sessionId: "0123456789abcdef012345",
      clock: { monotonicNow: () => monotonic, wallNow: () => wall },
    });
    const published = publish(store, annotation());

    expect(published).toMatchObject({
      framework: "vite",
      revision: 1,
      targetCount: 1,
      page: { origin: "http://127.0.0.1:5173", pathname: "/settings" },
      state: "available",
      pickupCount: 0,
    });
    expect(JSON.stringify(published)).not.toContain("token=not-in-summary");
    expect(Object.isFrozen(store.current())).toBe(true);

    wall += 100;
    const firstAck = store.ack(published.cursor, "connectorinstance0123456789");
    const duplicateAck = store.ack(published.cursor, "connectorinstance0123456789");
    expect(firstAck.pickupCount).toBe(1);
    expect(duplicateAck.pickupCount).toBe(1);

    monotonic += 15 * 60 * 1_000;
    expectErrorCode(() => store.current(published.cursor), ERROR_CODES.HANDOFF_EXPIRED);
  });

  it("supersedes only the old summary and wakes all bounded waiters once", async () => {
    const store = createExternalHandoffStore({
      framework: "next",
      sessionId: "0123456789abcdef012345",
    });
    const first = publish(store, annotation("First revision"));
    const signal = new AbortController().signal;
    const pendingA = store.wait(first.cursor, 5_000, signal);
    const pendingB = store.wait(first.cursor, 5_000, signal);
    expect(store.activeWaitCount()).toBe(2);
    const second = publish(store, annotation("Second revision"));

    await expect(pendingA).resolves.toMatchObject({
      outcome: "handoff",
      snapshot: { revision: 2 },
    });
    await expect(pendingB).resolves.toMatchObject({
      outcome: "handoff",
      snapshot: { revision: 2 },
    });
    expect(store.status(first.cursor).state).toBe("superseded");
    expect(store.status(second.cursor).state).toBe("available");
    expect(store.activeWaitCount()).toBe(0);
  });

  it("returns normal wait timeout and releases cancelled or closed waits", async () => {
    const store = createExternalHandoffStore({
      framework: "vite",
      sessionId: "0123456789abcdef012345",
    });
    await expect(
      store.wait(undefined, 1, new AbortController().signal),
    ).resolves.toEqual({
      outcome: "timeout",
    });

    const controller = new AbortController();
    const cancelled = store.wait(undefined, 5_000, controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: ERROR_CODES.SESSION_CLOSED });

    const closed = store.wait(undefined, 5_000, new AbortController().signal);
    store.close();
    await expect(closed).rejects.toMatchObject({ code: ERROR_CODES.SESSION_CLOSED });
    expectErrorCode(() => publish(store, annotation()), ERROR_CODES.SESSION_CLOSED);
  });

  it("rejects oversized snapshots before advancing the revision", () => {
    const store = createExternalHandoffStore({
      framework: "vite",
      sessionId: "0123456789abcdef012345",
    });
    expectErrorCode(
      () => publish(store, annotation("x".repeat(300_000))),
      ERROR_CODES.HANDOFF_RESPONSE_TOO_LARGE,
    );
    expect(publish(store, annotation()).revision).toBe(1);
  });

  it("replays the immutable first result and rejects request ID conflicts", () => {
    const store = createExternalHandoffStore({
      framework: "vite",
      sessionId: "0123456789abcdef012345",
    });
    const requestId = "fixedrequest012345678901234567890123";
    const first = publishResult(store, annotation(), requestId, "same-fingerprint");
    const replayed = publishResult(store, annotation(), requestId, "same-fingerprint");

    expect(first).toMatchObject({ replayed: false, handoff: { revision: 1 } });
    expect(replayed).toEqual({ ...first, replayed: true });
    expectErrorCode(
      () => publishResult(store, annotation("Different"), requestId, "different-hash"),
      ERROR_CODES.HANDOFF_VALIDATION_FAILED,
    );
    expect(store.status().revision).toBe(1);
  });

  it("fails closed instead of evicting valid idempotency records", () => {
    const store = createExternalHandoffStore({
      framework: "next",
      sessionId: "0123456789abcdef012345",
    });

    for (
      let index = 0;
      index < EXTERNAL_HANDOFF_LIMITS.maximumRequestIdRecords;
      index += 1
    ) {
      publishResult(
        store,
        annotation(String(index)),
        `capacityrequest${String(index).padStart(24, "0")}`,
        `fingerprint-${String(index)}`,
      );
    }

    const firstReplay = publishResult(
      store,
      annotation("0"),
      "capacityrequest000000000000000000000000",
      "fingerprint-0",
    );
    expect(firstReplay).toMatchObject({ replayed: true, handoff: { revision: 1 } });
    expectErrorCode(
      () =>
        publishResult(
          store,
          annotation("overflow"),
          "capacityoverflow012345678901234567",
          "overflow",
        ),
      ERROR_CODES.EXTERNAL_HANDOFF_UNAVAILABLE,
    );
    expect(store.status().revision).toBe(
      EXTERNAL_HANDOFF_LIMITS.maximumRequestIdRecords,
    );
  });
});
