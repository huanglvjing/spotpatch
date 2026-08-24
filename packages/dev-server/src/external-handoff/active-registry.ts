import { randomBytes } from "node:crypto";

import {
  ERROR_CODES,
  EXTERNAL_HANDOFF_LIMITS,
  SpotPatchError,
  type ActiveAdapterSummary,
  type DispatchSummary,
  type ExternalHandoffActiveAdapterKind,
  type ExternalHandoffDispatchPhase,
  type ExternalHandoffPublishDelivery,
  type ExternalHandoffReportableDispatchPhase,
} from "@spotpatch/shared";
import type {
  BridgeActiveClaimResult,
  BridgeActiveStateResult,
} from "@spotpatch/shared/external-agent-node";

import { SYSTEM_EXTERNAL_HANDOFF_CLOCK, type ExternalHandoffClock } from "./clock.js";

interface ActiveLease {
  readonly adapterKind: ExternalHandoffActiveAdapterKind;
  readonly baselineCursor: string | null;
  readonly connectedAt: string;
  readonly connectorInstanceId: string;
  readonly token: string;
  expiresAtMonotonic: number;
  updatedAt: string;
}

interface ActiveDispatch {
  readonly adapterKind: ExternalHandoffActiveAdapterKind;
  readonly cursor: string;
  readonly deadlineMonotonic: number;
  readonly revision: number;
  phase: ExternalHandoffDispatchPhase;
  updatedAt: string;
}

interface BlockedAdapter {
  readonly adapterKind: ExternalHandoffActiveAdapterKind;
  readonly connectedAt: string;
  readonly updatedAt: string;
}

export interface ActiveRegistrySnapshot {
  readonly activeAdapter: ActiveAdapterSummary | null;
  readonly dispatch: DispatchSummary | null;
}

export interface ActiveAdapterRegistry {
  readonly assertPublishable: () => void;
  readonly claim: (
    adapterKind: ExternalHandoffActiveAdapterKind,
    connectorInstanceId: string,
    baselineCursor: string | null,
  ) => BridgeActiveClaimResult;
  readonly close: () => void;
  readonly heartbeat: (leaseToken: string) => BridgeActiveStateResult;
  readonly release: (leaseToken: string) => BridgeActiveStateResult;
  readonly report: (
    leaseToken: string,
    cursor: string,
    phase: ExternalHandoffReportableDispatchPhase,
  ) => BridgeActiveStateResult;
  readonly reserve: (
    cursor: string,
    revision: number,
  ) => ExternalHandoffPublishDelivery;
  readonly resolveDelivery: (cursor: string) => ActiveRegistrySnapshot;
  readonly snapshot: (cursor?: string) => ActiveRegistrySnapshot;
}

export interface CreateActiveAdapterRegistryOptions {
  readonly clock?: ExternalHandoffClock;
  readonly randomId?: () => string;
}

const ALLOWED_TRANSITIONS = Object.freeze({
  queued: ["dispatching", "failed"],
  dispatching: ["dispatched", "working", "failed", "delivery-unknown"],
  dispatched: ["working", "failed", "delivery-unknown"],
  working: ["completed", "failed", "delivery-unknown"],
  completed: [],
  failed: [],
  "delivery-unknown": [],
} as const) satisfies Readonly<
  Record<ExternalHandoffDispatchPhase, readonly ExternalHandoffDispatchPhase[]>
>;

const TERMINAL_PHASES = new Set<ExternalHandoffDispatchPhase>([
  "completed",
  "failed",
  "delivery-unknown",
]);

function defaultRandomId(): string {
  return randomBytes(32).toString("base64url");
}

function requirePresent<T>(value: T | null): T {
  if (value === null) throw new SpotPatchError(ERROR_CODES.INTERNAL_ERROR);
  return value;
}

export function createActiveAdapterRegistry(
  options: CreateActiveAdapterRegistryOptions = {},
): ActiveAdapterRegistry {
  const clock = options.clock ?? SYSTEM_EXTERNAL_HANDOFF_CLOCK;
  const randomId = options.randomId ?? defaultRandomId;
  let blocked: BlockedAdapter | undefined;
  let closed = false;
  let dispatch: ActiveDispatch | undefined;
  let lastReleasedToken: string | undefined;
  let lease: ActiveLease | undefined;

  const nowIso = (): string => new Date(clock.wallNow()).toISOString();

  const requireOpen = (): void => {
    if (closed) throw new SpotPatchError(ERROR_CODES.SESSION_CLOSED);
  };

  const dispatchSummary = (): DispatchSummary | null =>
    dispatch === undefined
      ? null
      : Object.freeze({
          adapterKind: dispatch.adapterKind,
          revision: dispatch.revision,
          phase: dispatch.phase,
          updatedAt: dispatch.updatedAt,
        });

  const activeSummary = (): ActiveAdapterSummary | null => {
    if (blocked !== undefined) {
      return Object.freeze({
        kind: blocked.adapterKind,
        state: "blocked",
        canDispatch: false,
        connectedAt: blocked.connectedAt,
        updatedAt: blocked.updatedAt,
      });
    }

    if (lease === undefined) return null;
    const busy = dispatch !== undefined && !TERMINAL_PHASES.has(dispatch.phase);
    return Object.freeze({
      kind: lease.adapterKind,
      state: busy ? "busy" : "ready",
      canDispatch: !busy,
      connectedAt: lease.connectedAt,
      updatedAt: lease.updatedAt,
    });
  };

  const state = (cursor?: string): ActiveRegistrySnapshot =>
    Object.freeze({
      activeAdapter: activeSummary(),
      dispatch:
        cursor === undefined || dispatch?.cursor === cursor ? dispatchSummary() : null,
    });

  const enterUnknown = (activeLease: ActiveLease): void => {
    if (dispatch === undefined) return;
    const updatedAt = nowIso();
    dispatch.phase = "delivery-unknown";
    dispatch.updatedAt = updatedAt;
    blocked = Object.freeze({
      adapterKind: activeLease.adapterKind,
      connectedAt: activeLease.connectedAt,
      updatedAt,
    });
  };

  const endLease = (activeLease: ActiveLease): void => {
    if (dispatch?.phase === "queued") {
      dispatch.phase = "failed";
      dispatch.updatedAt = nowIso();
    } else if (
      dispatch?.phase === "dispatching" ||
      dispatch?.phase === "dispatched" ||
      dispatch?.phase === "working"
    ) {
      enterUnknown(activeLease);
    }

    lastReleasedToken = activeLease.token;
    lease = undefined;
  };

  const sweep = (): void => {
    if (lease === undefined) return;
    const monotonicNow = clock.monotonicNow();

    if (
      monotonicNow >= lease.expiresAtMonotonic ||
      (dispatch !== undefined &&
        !TERMINAL_PHASES.has(dispatch.phase) &&
        monotonicNow >= dispatch.deadlineMonotonic)
    ) {
      endLease(lease);
    }
  };

  const assertPublishable = (): void => {
    requireOpen();
    sweep();

    if (
      blocked !== undefined ||
      (lease !== undefined &&
        dispatch !== undefined &&
        !TERMINAL_PHASES.has(dispatch.phase))
    ) {
      throw new SpotPatchError(ERROR_CODES.EXTERNAL_AGENT_BUSY);
    }
  };

  const requireLease = (leaseToken: string): ActiveLease => {
    requireOpen();
    sweep();

    if (lease?.token !== leaseToken) {
      throw new SpotPatchError(ERROR_CODES.ACTIVE_ADAPTER_LEASE_INVALID);
    }

    return lease;
  };

  return Object.freeze({
    assertPublishable,

    claim(
      adapterKind: ExternalHandoffActiveAdapterKind,
      connectorInstanceId: string,
      baselineCursor: string | null,
    ) {
      requireOpen();
      sweep();

      if (blocked !== undefined) {
        throw new SpotPatchError(ERROR_CODES.EXTERNAL_AGENT_BUSY);
      }
      if (lease !== undefined) {
        if (
          lease.adapterKind === adapterKind &&
          lease.connectorInstanceId === connectorInstanceId
        ) {
          lease.expiresAtMonotonic =
            clock.monotonicNow() + EXTERNAL_HANDOFF_LIMITS.activeLeaseDurationMs;
          lease.updatedAt = nowIso();
          return Object.freeze({
            leaseToken: lease.token,
            heartbeatIntervalMs: EXTERNAL_HANDOFF_LIMITS.activeHeartbeatIntervalMs,
            baselineCursor: lease.baselineCursor,
            activeAdapter: requirePresent(activeSummary()),
          });
        }
        throw new SpotPatchError(ERROR_CODES.ACTIVE_ADAPTER_CONFLICT);
      }

      const timestamp = nowIso();
      lease = {
        adapterKind,
        baselineCursor,
        connectedAt: timestamp,
        connectorInstanceId,
        token: randomId(),
        expiresAtMonotonic:
          clock.monotonicNow() + EXTERNAL_HANDOFF_LIMITS.activeLeaseDurationMs,
        updatedAt: timestamp,
      };
      lastReleasedToken = undefined;
      return Object.freeze({
        leaseToken: lease.token,
        heartbeatIntervalMs: EXTERNAL_HANDOFF_LIMITS.activeHeartbeatIntervalMs,
        baselineCursor,
        activeAdapter: requirePresent(activeSummary()),
      });
    },

    heartbeat(leaseToken: string) {
      const activeLease = requireLease(leaseToken);
      activeLease.expiresAtMonotonic =
        clock.monotonicNow() + EXTERNAL_HANDOFF_LIMITS.activeLeaseDurationMs;
      activeLease.updatedAt = nowIso();
      return state();
    },

    report(
      leaseToken: string,
      cursor: string,
      phase: ExternalHandoffReportableDispatchPhase,
    ) {
      const activeLease = requireLease(leaseToken);

      if (
        dispatch?.cursor !== cursor ||
        dispatch.adapterKind !== activeLease.adapterKind
      ) {
        throw new SpotPatchError(ERROR_CODES.ACTIVE_DISPATCH_INVALID);
      }
      if (dispatch.phase === phase) return state(cursor);
      const allowed: readonly ExternalHandoffDispatchPhase[] =
        ALLOWED_TRANSITIONS[dispatch.phase];
      if (!allowed.includes(phase)) {
        throw new SpotPatchError(ERROR_CODES.ACTIVE_DISPATCH_INVALID);
      }

      const updatedAt = nowIso();
      dispatch.phase = phase;
      dispatch.updatedAt = updatedAt;
      activeLease.updatedAt = updatedAt;

      if (phase === "delivery-unknown") {
        blocked = Object.freeze({
          adapterKind: activeLease.adapterKind,
          connectedAt: activeLease.connectedAt,
          updatedAt,
        });
        lastReleasedToken = activeLease.token;
        lease = undefined;
      }

      return state(cursor);
    },

    release(leaseToken: string) {
      requireOpen();
      sweep();

      if (lease === undefined && lastReleasedToken === leaseToken) return state();
      const activeLease = lease;
      if (activeLease?.token !== leaseToken) {
        throw new SpotPatchError(ERROR_CODES.ACTIVE_ADAPTER_LEASE_INVALID);
      }

      endLease(activeLease);
      return state();
    },

    reserve(cursor: string, revision: number) {
      assertPublishable();
      if (lease === undefined) return Object.freeze({ mode: "inbox" });

      const updatedAt = nowIso();
      dispatch = {
        adapterKind: lease.adapterKind,
        cursor,
        deadlineMonotonic:
          clock.monotonicNow() + EXTERNAL_HANDOFF_LIMITS.activeDispatchTimeoutMs,
        revision,
        phase: "queued",
        updatedAt,
      };
      lease.updatedAt = updatedAt;
      return Object.freeze({
        mode: "active",
        adapter: requirePresent(activeSummary()),
        dispatch: requirePresent(dispatchSummary()),
      });
    },

    resolveDelivery(cursor: string) {
      requireOpen();
      sweep();

      const activeDispatch = dispatch;
      if (
        blocked === undefined ||
        activeDispatch?.cursor !== cursor ||
        activeDispatch.phase !== "delivery-unknown"
      ) {
        throw new SpotPatchError(ERROR_CODES.ACTIVE_DISPATCH_INVALID);
      }

      blocked = undefined;
      return state(cursor);
    },

    snapshot(cursor?: string) {
      requireOpen();
      sweep();
      return state(cursor);
    },

    close() {
      if (closed) return;
      closed = true;
      blocked = undefined;
      dispatch = undefined;
      lease = undefined;
      lastReleasedToken = undefined;
    },
  });
}
