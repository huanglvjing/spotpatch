import {
  ERROR_CODES,
  SpotPatchError,
  type externalHandoffSnapshotSchema,
  type ExternalHandoffActiveAdapterKind,
  type ExternalHandoffReportableDispatchPhase,
} from "@spotpatch/shared";
import type { z } from "zod";

export type ActiveAdapterKind = ExternalHandoffActiveAdapterKind;
export type ActiveReportPhase = ExternalHandoffReportableDispatchPhase;
export type AgentDeliveryPhase = Exclude<ActiveReportPhase, "dispatching">;
/* Schema inference preserves the exact validated Broker wire representation. */
export type AgentHandoffSnapshot = z.infer<typeof externalHandoffSnapshotSchema>;

/**
 * Lease data is connector-private. It must never be included in MCP output,
 * Channel metadata, diagnostics, or browser-facing state.
 */
export interface ActiveBridgeLease {
  readonly adapterKind: ActiveAdapterKind;
  readonly baselineCursor: string | undefined;
  readonly heartbeatIntervalMs: number;
  readonly leaseToken: string;
  readonly sessionId: string;
}

/**
 * The event pump deliberately depends on a narrow structural interface. The
 * production BridgeClient and deterministic test doubles both implement it.
 */
export interface ActiveBridgeClient {
  readonly activeClaim: (
    adapterKind: ActiveAdapterKind,
    sessionId?: string,
    signal?: AbortSignal,
  ) => Promise<ActiveBridgeLease>;
  readonly activeHeartbeat: (
    lease: ActiveBridgeLease,
    signal?: AbortSignal,
  ) => Promise<void>;
  readonly activeRelease: (
    lease: ActiveBridgeLease,
    signal?: AbortSignal,
  ) => Promise<void>;
  readonly activeReport: (
    lease: ActiveBridgeLease,
    cursor: string,
    phase: ActiveReportPhase,
    signal?: AbortSignal,
  ) => Promise<void>;
}

export interface AgentDeliveryLifecycle {
  /** The sole state-writing path available to a vendor adapter. */
  readonly report: (phase: AgentDeliveryPhase) => Promise<void>;
}

export interface AgentAdapter {
  readonly kind: ActiveAdapterKind;
  readonly close: () => Promise<void>;
  /** Resolves only after a proved completed/failed terminal report. */
  readonly deliver: (
    handoff: AgentHandoffSnapshot,
    lifecycle: AgentDeliveryLifecycle,
    signal: AbortSignal,
  ) => Promise<void>;
}

export class ActiveDeliveryUnknownError extends Error {
  public constructor(message = "Active Agent delivery could not be proved.") {
    super(message);
    this.name = "ActiveDeliveryUnknownError";
  }
}

export class ActiveAdapterProtocolError extends SpotPatchError {
  public constructor(message = "Active Agent adapter protocol was violated.") {
    super(ERROR_CODES.ACTIVE_DISPATCH_INVALID);
    this.name = "ActiveAdapterProtocolError";
    this.message = message;
  }
}
