import {
  ERROR_CODES,
  EXTERNAL_HANDOFF_LIMITS,
  type ErrorCode,
} from "@spotpatch/shared";
import { describe, expect, it } from "vitest";

import { createActiveAdapterRegistry } from "./active-registry.js";

const cursorA = "cursoraaaaaaaaaaaaaaaaaaaa";
const cursorB = "cursorbbbbbbbbbbbbbbbbbbbb";
const connectorId = "connectorinstance0123456789";
const otherConnectorId = "otherconnectorinstance012345";

function expectErrorCode(action: () => unknown, code: ErrorCode): void {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toMatchObject({ code });
    return;
  }

  throw new Error(`Expected SpotPatch error ${code}.`);
}

function fixture() {
  let monotonic = 1_000;
  let wall = Date.parse("2026-08-23T00:00:00.000Z");
  let randomSequence = 0;
  const registry = createActiveAdapterRegistry({
    clock: { monotonicNow: () => monotonic, wallNow: () => wall },
    randomId: () => `leasetoken${String(++randomSequence).padStart(32, "0")}`,
  });

  return {
    registry,
    advance(milliseconds: number) {
      monotonic += milliseconds;
      wall += milliseconds;
    },
  };
}

describe("active Agent adapter registry", () => {
  it("claims one adapter with an atomic baseline and accepts consecutive tasks", () => {
    const { registry } = fixture();
    const claim = registry.claim("claude-channel", connectorId, cursorA);

    expect(claim).toMatchObject({
      baselineCursor: cursorA,
      heartbeatIntervalMs: EXTERNAL_HANDOFF_LIMITS.activeHeartbeatIntervalMs,
      activeAdapter: { kind: "claude-channel", state: "ready", canDispatch: true },
    });
    expect(registry.claim("claude-channel", connectorId, cursorB)).toMatchObject({
      leaseToken: claim.leaseToken,
      baselineCursor: cursorA,
    });
    expectErrorCode(
      () => registry.claim("codex-app-server", otherConnectorId, cursorA),
      ERROR_CODES.ACTIVE_ADAPTER_CONFLICT,
    );

    expect(registry.reserve(cursorA, 1)).toMatchObject({
      mode: "active",
      adapter: { state: "busy", canDispatch: false },
      dispatch: { revision: 1, phase: "queued" },
    });
    expectErrorCode(
      () => registry.report(claim.leaseToken, cursorA, "completed"),
      ERROR_CODES.ACTIVE_DISPATCH_INVALID,
    );
    expect(registry.snapshot(cursorA).dispatch?.phase).toBe("queued");

    registry.report(claim.leaseToken, cursorA, "dispatching");
    registry.report(claim.leaseToken, cursorA, "working");
    const completed = registry.report(claim.leaseToken, cursorA, "completed");
    expect(completed.activeAdapter).toMatchObject({
      state: "ready",
      canDispatch: true,
    });
    expect(registry.report(claim.leaseToken, cursorA, "completed")).toEqual(completed);

    expect(registry.reserve(cursorB, 2)).toMatchObject({
      mode: "active",
      dispatch: { revision: 2, phase: "queued" },
    });
    expect(registry.snapshot(cursorA).dispatch).toBeNull();
  });

  it("rejects wrong lease, cursor, and phase without changing state", () => {
    const { registry } = fixture();
    const claim = registry.claim("codex-app-server", connectorId, null);
    registry.reserve(cursorA, 1);
    const before = registry.snapshot(cursorA);

    expectErrorCode(
      () => registry.report("wrongleasetoken0123456789012", cursorA, "dispatching"),
      ERROR_CODES.ACTIVE_ADAPTER_LEASE_INVALID,
    );
    expectErrorCode(
      () => registry.report(claim.leaseToken, cursorB, "dispatching"),
      ERROR_CODES.ACTIVE_DISPATCH_INVALID,
    );
    expectErrorCode(
      () => registry.report(claim.leaseToken, cursorA, "working"),
      ERROR_CODES.ACTIVE_DISPATCH_INVALID,
    );
    expect(registry.snapshot(cursorA)).toEqual(before);
  });

  it("blocks on unknown delivery until the exact cursor is resolved", () => {
    const { registry } = fixture();
    const claim = registry.claim("claude-channel", connectorId, null);
    registry.reserve(cursorA, 1);
    registry.report(claim.leaseToken, cursorA, "dispatching");
    const released = registry.release(claim.leaseToken);

    expect(released).toMatchObject({
      activeAdapter: { state: "blocked", canDispatch: false },
      dispatch: { phase: "delivery-unknown" },
    });
    expect(registry.release(claim.leaseToken)).toEqual(released);
    expectErrorCode(
      () => registry.claim("claude-channel", connectorId, cursorA),
      ERROR_CODES.EXTERNAL_AGENT_BUSY,
    );
    expectErrorCode(
      () => registry.reserve(cursorB, 2),
      ERROR_CODES.EXTERNAL_AGENT_BUSY,
    );
    expectErrorCode(
      () => registry.resolveDelivery(cursorB),
      ERROR_CODES.ACTIVE_DISPATCH_INVALID,
    );

    expect(registry.resolveDelivery(cursorA)).toMatchObject({
      activeAdapter: null,
      dispatch: { phase: "delivery-unknown" },
    });
    expect(registry.reserve(cursorB, 2)).toEqual({ mode: "inbox" });
    expect(registry.snapshot(cursorB).dispatch).toBeNull();
  });

  it("fails queued work but blocks potentially delivered work when a lease expires", () => {
    const queued = fixture();
    const queuedClaim = queued.registry.claim("claude-channel", connectorId, null);
    queued.registry.reserve(cursorA, 1);
    queued.advance(EXTERNAL_HANDOFF_LIMITS.activeLeaseDurationMs);
    expect(queued.registry.snapshot(cursorA)).toMatchObject({
      activeAdapter: null,
      dispatch: { phase: "failed" },
    });
    expectErrorCode(
      () => queued.registry.heartbeat(queuedClaim.leaseToken),
      ERROR_CODES.ACTIVE_ADAPTER_LEASE_INVALID,
    );

    const started = fixture();
    const startedClaim = started.registry.claim("claude-channel", connectorId, null);
    started.registry.reserve(cursorA, 1);
    started.registry.report(startedClaim.leaseToken, cursorA, "dispatching");
    started.advance(EXTERNAL_HANDOFF_LIMITS.activeLeaseDurationMs);
    expect(started.registry.snapshot(cursorA)).toMatchObject({
      activeAdapter: { state: "blocked", canDispatch: false },
      dispatch: { phase: "delivery-unknown" },
    });
  });
});
