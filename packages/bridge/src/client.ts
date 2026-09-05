import { randomBytes } from "node:crypto";

import {
  ERROR_CODES,
  EXTERNAL_HANDOFF_LIMITS,
  EXTERNAL_HANDOFF_FRAMEWORKS,
  SpotPatchError,
  externalHandoffSnapshotSchema,
  externalHandoffSummarySchema,
  type ExternalHandoffSummary,
} from "@spotpatch/shared";
import {
  SPOTPATCH_BRIDGE_PATHS,
  bridgeActiveClaimResultSchema,
  bridgeActiveHeartbeatResultSchema,
  bridgeActiveReleaseResultSchema,
  bridgeActiveReportResultSchema,
  bridgeAckResultSchema,
  bridgeCurrentResultSchema,
  bridgeStatusSchema,
  bridgeWaitResultSchema,
  type BridgeStatus,
  type ExternalHandoffDescriptor,
} from "@spotpatch/shared/external-agent-node";
import { z } from "zod";

import type {
  ActiveAdapterKind,
  ActiveBridgeClient,
  ActiveBridgeLease,
  ActiveReportPhase,
} from "./active/types.js";
import { requestBroker } from "./broker-client.js";
import {
  discoverProjectDescriptors,
  removeStaleProjectDescriptor,
  type SecureExternalHandoffDescriptor,
} from "./discovery.js";

const sessionListItemSchema = z.strictObject({
  sessionId: z.string(),
  framework: z.enum(EXTERNAL_HANDOFF_FRAMEWORKS),
  current: externalHandoffSummarySchema.nullable(),
});
export const externalAgentSessionListSchema = z.array(sessionListItemSchema);
export const handoffDeliverySchema = z.strictObject({
  outcome: z.literal("handoff"),
  snapshot: externalHandoffSnapshotSchema,
  receiptRecorded: z.boolean(),
});
export const noCurrentHandoffDeliverySchema = z.strictObject({
  outcome: z.literal("not-found"),
  reason: z.enum(["empty", "expired"]),
});
export const currentHandoffDeliverySchema = z.discriminatedUnion("outcome", [
  handoffDeliverySchema,
  noCurrentHandoffDeliverySchema,
]);
export const handoffWaitDeliverySchema = z.discriminatedUnion("outcome", [
  handoffDeliverySchema,
  z.strictObject({ outcome: z.literal("timeout") }),
]);

export type ExternalAgentSessionListItem = z.infer<typeof sessionListItemSchema>;
export type HandoffDelivery = z.infer<typeof handoffDeliverySchema>;
export type CurrentHandoffDelivery = z.infer<typeof currentHandoffDeliverySchema>;
export type HandoffWaitDelivery = z.infer<typeof handoffWaitDeliverySchema>;

interface ActiveSession {
  readonly descriptor: ExternalHandoffDescriptor;
  readonly status: BridgeStatus;
}

export interface SpotPatchBridgeClient extends ActiveBridgeClient {
  readonly ack: (
    cursor: string,
    sessionId?: string,
    signal?: AbortSignal,
  ) => Promise<ExternalHandoffSummary>;
  readonly current: (
    sessionId?: string,
    cursor?: string,
    signal?: AbortSignal,
  ) => Promise<CurrentHandoffDelivery>;
  readonly sessions: () => Promise<readonly ExternalAgentSessionListItem[]>;
  readonly wait: (
    sessionId?: string,
    afterCursor?: string,
    timeoutMs?: number,
    signal?: AbortSignal,
  ) => Promise<HandoffWaitDelivery>;
}

async function activeSession(
  candidate: SecureExternalHandoffDescriptor,
): Promise<ActiveSession | undefined> {
  try {
    const status = await requestBroker(
      candidate.descriptor,
      SPOTPATCH_BRIDGE_PATHS.status,
      {},
      bridgeStatusSchema,
      undefined,
      EXTERNAL_HANDOFF_LIMITS.brokerDiscoveryTimeoutMs,
    );

    if (
      status.projectKey !== candidate.descriptor.projectKey ||
      status.sessionId !== candidate.descriptor.sessionId ||
      status.framework !== candidate.descriptor.framework
    ) {
      throw new SpotPatchError(ERROR_CODES.BRIDGE_UNAUTHORIZED);
    }

    return Object.freeze({ descriptor: candidate.descriptor, status });
  } catch (error: unknown) {
    if (
      error instanceof SpotPatchError &&
      (error.code === ERROR_CODES.SESSION_CLOSED ||
        error.code === ERROR_CODES.BRIDGE_UNAUTHORIZED)
    ) {
      await removeStaleProjectDescriptor(candidate);
      return undefined;
    }

    throw error;
  }
}

async function discoverActive(cwd: string): Promise<readonly ActiveSession[]> {
  const candidates = await discoverProjectDescriptors(cwd);
  const probed = await Promise.all(candidates.map(activeSession));
  const active = probed.filter((value): value is ActiveSession => value !== undefined);

  if (active.length === 0) {
    throw new SpotPatchError(ERROR_CODES.SESSION_NOT_FOUND);
  }

  return Object.freeze(active);
}

function selectSession(
  sessions: readonly ActiveSession[],
  sessionId?: string,
): ActiveSession {
  if (sessionId !== undefined) {
    const selected = sessions.find((session) => session.status.sessionId === sessionId);
    if (selected === undefined) throw new SpotPatchError(ERROR_CODES.SESSION_NOT_FOUND);
    return selected;
  }

  if (sessions.length === 1 && sessions[0] !== undefined) return sessions[0];
  const withCurrent = sessions
    .filter((session) => session.status.current !== null)
    .sort((left, right) =>
      (right.status.current?.publishedAt ?? "").localeCompare(
        left.status.current?.publishedAt ?? "",
      ),
    );
  const first = withCurrent[0];
  const second = withCurrent[1];

  if (
    first !== undefined &&
    (second === undefined ||
      first.status.current?.publishedAt !== second.status.current?.publishedAt)
  ) {
    return first;
  }

  throw new SpotPatchError(ERROR_CODES.SESSION_AMBIGUOUS);
}

function selectActiveSession(
  sessions: readonly ActiveSession[],
  sessionId?: string,
): ActiveSession {
  if (sessionId !== undefined) {
    const selected = sessions.find((session) => session.status.sessionId === sessionId);
    if (selected === undefined) throw new SpotPatchError(ERROR_CODES.SESSION_NOT_FOUND);
    return selected;
  }

  if (sessions.length === 1 && sessions[0] !== undefined) return sessions[0];
  throw new SpotPatchError(ERROR_CODES.SESSION_AMBIGUOUS);
}

export function createSpotPatchBridgeClient(
  cwd = process.cwd(),
): SpotPatchBridgeClient {
  const connectorInstanceId = randomBytes(24).toString("base64url");
  const leaseDescriptors = new WeakMap<ActiveBridgeLease, ExternalHandoffDescriptor>();
  let activeLease: ActiveBridgeLease | undefined;
  let claimPending = false;

  const descriptorForLease = (lease: ActiveBridgeLease): ExternalHandoffDescriptor => {
    const descriptor = leaseDescriptors.get(lease);
    if (descriptor === undefined) {
      throw new SpotPatchError(ERROR_CODES.ACTIVE_ADAPTER_LEASE_INVALID);
    }

    return descriptor;
  };

  const recordReceipt = async (
    descriptor: ExternalHandoffDescriptor,
    cursor: string,
    signal?: AbortSignal,
  ): Promise<boolean> => {
    try {
      await requestBroker(
        descriptor,
        SPOTPATCH_BRIDGE_PATHS.ack,
        { cursor, connectorInstanceId },
        bridgeAckResultSchema,
        signal,
      );
      return true;
    } catch {
      return false;
    }
  };

  const client: SpotPatchBridgeClient = {
    async activeClaim(
      adapterKind: ActiveAdapterKind,
      sessionId?: string,
      signal?: AbortSignal,
    ) {
      if (claimPending || activeLease !== undefined) {
        throw new SpotPatchError(ERROR_CODES.ACTIVE_ADAPTER_CONFLICT);
      }
      claimPending = true;

      try {
        const selected = selectActiveSession(await discoverActive(cwd), sessionId);
        const result = await requestBroker(
          selected.descriptor,
          SPOTPATCH_BRIDGE_PATHS.activeClaim,
          { adapterKind, connectorInstanceId },
          bridgeActiveClaimResultSchema,
          signal,
        );

        if (
          result.activeAdapter.kind !== adapterKind ||
          result.activeAdapter.state === "blocked"
        ) {
          throw new SpotPatchError(ERROR_CODES.BRIDGE_PROTOCOL_MISMATCH);
        }

        const lease: ActiveBridgeLease = Object.freeze({
          adapterKind,
          baselineCursor: result.baselineCursor ?? undefined,
          heartbeatIntervalMs: result.heartbeatIntervalMs,
          leaseToken: result.leaseToken,
          sessionId: selected.status.sessionId,
        });
        leaseDescriptors.set(lease, selected.descriptor);
        activeLease = lease;
        return lease;
      } finally {
        claimPending = false;
      }
    },

    async activeHeartbeat(lease: ActiveBridgeLease, signal?: AbortSignal) {
      const result = await requestBroker(
        descriptorForLease(lease),
        SPOTPATCH_BRIDGE_PATHS.activeHeartbeat,
        { leaseToken: lease.leaseToken },
        bridgeActiveHeartbeatResultSchema,
        signal,
      );

      if (
        result.activeAdapter?.kind !== lease.adapterKind ||
        result.activeAdapter.state === "blocked"
      ) {
        throw new SpotPatchError(ERROR_CODES.BRIDGE_PROTOCOL_MISMATCH);
      }
    },

    async activeReport(
      lease: ActiveBridgeLease,
      cursor: string,
      phase: ActiveReportPhase,
      signal?: AbortSignal,
    ) {
      const result = await requestBroker(
        descriptorForLease(lease),
        SPOTPATCH_BRIDGE_PATHS.activeReport,
        { leaseToken: lease.leaseToken, cursor, phase },
        bridgeActiveReportResultSchema,
        signal,
      );

      if (
        result.dispatch?.adapterKind !== lease.adapterKind ||
        result.dispatch.phase !== phase
      ) {
        throw new SpotPatchError(ERROR_CODES.BRIDGE_PROTOCOL_MISMATCH);
      }
    },

    async activeRelease(lease: ActiveBridgeLease, signal?: AbortSignal) {
      try {
        await requestBroker(
          descriptorForLease(lease),
          SPOTPATCH_BRIDGE_PATHS.activeRelease,
          { leaseToken: lease.leaseToken },
          bridgeActiveReleaseResultSchema,
          signal,
        );
      } finally {
        if (activeLease === lease) activeLease = undefined;
      }
    },

    async sessions() {
      let active: readonly ActiveSession[];

      try {
        active = await discoverActive(cwd);
      } catch (error: unknown) {
        if (
          error instanceof SpotPatchError &&
          error.code === ERROR_CODES.SESSION_NOT_FOUND
        ) {
          return Object.freeze([]);
        }

        throw error;
      }

      return Object.freeze(
        active
          .map(({ status }) =>
            Object.freeze({
              sessionId: status.sessionId,
              framework: status.framework,
              current: status.current,
            }),
          )
          .sort((left, right) => left.sessionId.localeCompare(right.sessionId)),
      );
    },

    async current(sessionId?: string, cursor?: string, signal?: AbortSignal) {
      const selected = selectSession(await discoverActive(cwd), sessionId);
      let result;

      try {
        result = await requestBroker(
          selected.descriptor,
          SPOTPATCH_BRIDGE_PATHS.current,
          cursor === undefined ? {} : { cursor },
          bridgeCurrentResultSchema,
          signal,
        );
      } catch (error: unknown) {
        if (error instanceof SpotPatchError) {
          if (error.code === ERROR_CODES.HANDOFF_NOT_FOUND) {
            return Object.freeze({ outcome: "not-found", reason: "empty" });
          }

          if (error.code === ERROR_CODES.HANDOFF_EXPIRED) {
            return Object.freeze({ outcome: "not-found", reason: "expired" });
          }
        }

        throw error;
      }

      const receiptRecorded = await recordReceipt(
        selected.descriptor,
        result.snapshot.cursor,
        signal,
      );
      return Object.freeze({
        outcome: "handoff",
        snapshot: result.snapshot,
        receiptRecorded,
      });
    },

    async wait(
      sessionId?: string,
      afterCursor?: string,
      timeoutMs?: number,
      signal?: AbortSignal,
    ) {
      const selected = selectSession(await discoverActive(cwd), sessionId);
      const result = await requestBroker(
        selected.descriptor,
        SPOTPATCH_BRIDGE_PATHS.wait,
        {
          ...(afterCursor === undefined ? {} : { afterCursor }),
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
        },
        bridgeWaitResultSchema,
        signal,
        (timeoutMs ?? EXTERNAL_HANDOFF_LIMITS.defaultWaitMs) +
          EXTERNAL_HANDOFF_LIMITS.brokerWaitGraceMs,
      );

      if (result.outcome === "timeout") return Object.freeze({ outcome: "timeout" });
      const receiptRecorded = await recordReceipt(
        selected.descriptor,
        result.snapshot.cursor,
        signal,
      );
      return Object.freeze({
        outcome: "handoff",
        snapshot: result.snapshot,
        receiptRecorded,
      });
    },

    async ack(cursor: string, sessionId?: string, signal?: AbortSignal) {
      const selected = selectSession(await discoverActive(cwd), sessionId);
      const result = await requestBroker(
        selected.descriptor,
        SPOTPATCH_BRIDGE_PATHS.ack,
        { cursor, connectorInstanceId },
        bridgeAckResultSchema,
        signal,
      );
      return result.summary;
    },
  };

  return Object.freeze(client);
}
