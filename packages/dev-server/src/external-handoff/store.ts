import { randomBytes } from "node:crypto";

import {
  ERROR_CODES,
  EXTERNAL_HANDOFF_LIMITS,
  EXTERNAL_HANDOFF_SNAPSHOT_SCHEMA_VERSION,
  SpotPatchError,
  type ExternalHandoffFramework,
  type ExternalHandoffPublishDelivery,
  type ExternalHandoffPublishResult,
  type ExternalHandoffSnapshot,
  type ExternalHandoffState,
  type ExternalHandoffSummary,
  type SpotAnnotation,
} from "@spotpatch/shared";
import type { BridgeWaitResult } from "@spotpatch/shared/external-agent-node";

import { SYSTEM_EXTERNAL_HANDOFF_CLOCK, type ExternalHandoffClock } from "./clock.js";

interface CurrentHandoff {
  readonly expiresAtMonotonic: number;
  readonly receipts: Set<string>;
  readonly snapshot: ExternalHandoffSnapshot;
  pickedUpAt?: string;
}

interface HandoffWaiter {
  readonly reject: (error: SpotPatchError) => void;
  readonly resolve: (result: BridgeWaitResult) => void;
}

interface IdempotencyRecord {
  readonly expiresAtMonotonic: number;
  readonly fingerprint: string;
  readonly result: ExternalHandoffPublishResult;
}

export interface PublishExternalHandoffInput {
  readonly annotation: SpotAnnotation;
  readonly fingerprint: string;
  readonly requestId: string;
  readonly reserve: (
    cursor: string,
    revision: number,
  ) => ExternalHandoffPublishDelivery;
}

export interface ExternalHandoffStore {
  readonly activeWaitCount: () => number;
  readonly ack: (cursor: string, connectorInstanceId: string) => ExternalHandoffSummary;
  readonly close: () => void;
  readonly current: (cursor?: string) => ExternalHandoffSnapshot;
  readonly currentCursor: () => string | null;
  readonly publish: (
    input: PublishExternalHandoffInput,
  ) => ExternalHandoffPublishResult;
  readonly replay: (
    requestId: string,
    fingerprint: string,
  ) => ExternalHandoffPublishResult | undefined;
  readonly status: (cursor?: string) => ExternalHandoffSummary;
  readonly wait: (
    afterCursor: string | undefined,
    timeoutMs: number,
    signal: AbortSignal,
  ) => Promise<BridgeWaitResult>;
}

export interface CreateExternalHandoffStoreOptions {
  readonly clock?: ExternalHandoffClock;
  readonly framework: ExternalHandoffFramework;
  readonly randomId?: () => string;
  readonly sessionId: string;
}

function defaultRandomId(): string {
  return randomBytes(24).toString("base64url");
}

function pageSummary(
  annotation: SpotAnnotation,
): Readonly<{ origin: string; pathname: string }> {
  let origin = "[unavailable]";

  try {
    const url = new URL(annotation.page.url);
    origin = url.origin === "null" ? "[unavailable]" : url.origin;
  } catch {
    // Invalid and non-standard origins are intentionally omitted from the summary.
  }

  return Object.freeze({ origin, pathname: annotation.page.pathname });
}

function summaryOf(
  current: CurrentHandoff,
  state: ExternalHandoffState,
): ExternalHandoffSummary {
  const snapshot = current.snapshot;
  return Object.freeze({
    sessionId: snapshot.session.id,
    framework: snapshot.session.framework,
    revision: snapshot.revision,
    cursor: snapshot.cursor,
    targetCount: snapshot.annotation.targets.length,
    page: pageSummary(snapshot.annotation),
    publishedAt: snapshot.publishedAt,
    expiresAt: snapshot.expiresAt,
    state,
    pickupCount: current.receipts.size,
    ...(current.pickedUpAt === undefined ? {} : { pickedUpAt: current.pickedUpAt }),
  });
}

function replayResult(record: IdempotencyRecord): ExternalHandoffPublishResult {
  return Object.freeze({ ...record.result, replayed: true });
}

export function createExternalHandoffStore(
  options: CreateExternalHandoffStoreOptions,
): ExternalHandoffStore {
  const clock = options.clock ?? SYSTEM_EXTERNAL_HANDOFF_CLOCK;
  const randomId = options.randomId ?? defaultRandomId;
  const history: ExternalHandoffSummary[] = [];
  const idempotency = new Map<string, IdempotencyRecord>();
  const waiters = new Set<HandoffWaiter>();
  let closed = false;
  let current: CurrentHandoff | undefined;
  let revision = 0;

  const requireOpen = (): void => {
    if (closed) throw new SpotPatchError(ERROR_CODES.SESSION_CLOSED);
  };

  const archive = (state: "expired" | "superseded"): void => {
    if (current === undefined) return;
    history.unshift(summaryOf(current, state));
    history.length = Math.min(
      history.length,
      EXTERNAL_HANDOFF_LIMITS.maximumHistorySummaries,
    );
    current = undefined;
  };

  const sweep = (): void => {
    const monotonicNow = clock.monotonicNow();

    if (current !== undefined && monotonicNow >= current.expiresAtMonotonic) {
      archive("expired");
    }

    for (const [requestId, record] of idempotency) {
      if (monotonicNow >= record.expiresAtMonotonic) idempotency.delete(requestId);
    }
  };

  const knownSummary = (cursor: string): ExternalHandoffSummary | undefined => {
    sweep();

    if (current?.snapshot.cursor === cursor) {
      return summaryOf(current, "available");
    }

    return history.find((summary) => summary.cursor === cursor);
  };

  const readCurrent = (cursor?: string): ExternalHandoffSnapshot => {
    requireOpen();
    sweep();

    if (current === undefined) {
      const prior = cursor === undefined ? undefined : knownSummary(cursor);
      throw new SpotPatchError(
        prior?.state === "expired"
          ? ERROR_CODES.HANDOFF_EXPIRED
          : cursor === undefined
            ? ERROR_CODES.HANDOFF_NOT_FOUND
            : ERROR_CODES.HANDOFF_CURSOR_INVALID,
      );
    }

    if (cursor !== undefined && cursor !== current.snapshot.cursor) {
      const prior = knownSummary(cursor);
      throw new SpotPatchError(
        prior?.state === "expired"
          ? ERROR_CODES.HANDOFF_EXPIRED
          : ERROR_CODES.HANDOFF_CURSOR_INVALID,
      );
    }

    return current.snapshot;
  };

  const findReplay = (
    requestId: string,
    fingerprint: string,
  ): ExternalHandoffPublishResult | undefined => {
    requireOpen();
    sweep();
    const record = idempotency.get(requestId);

    if (record === undefined) return undefined;
    if (record.fingerprint !== fingerprint) {
      throw new SpotPatchError(ERROR_CODES.HANDOFF_VALIDATION_FAILED);
    }

    return replayResult(record);
  };

  const settleWaiters = (result: BridgeWaitResult): void => {
    const pending = [...waiters];
    waiters.clear();

    for (const waiter of pending) waiter.resolve(result);
  };

  return Object.freeze({
    activeWaitCount: () => waiters.size,

    replay: findReplay,

    publish(input: PublishExternalHandoffInput) {
      requireOpen();
      const replayed = findReplay(input.requestId, input.fingerprint);
      if (replayed !== undefined) return replayed;
      if (idempotency.size >= EXTERNAL_HANDOFF_LIMITS.maximumRequestIdRecords) {
        throw new SpotPatchError(ERROR_CODES.EXTERNAL_HANDOFF_UNAVAILABLE);
      }

      const nextRevision = revision + 1;
      const publishedAtMs = clock.wallNow();
      const publishedAtMonotonic = clock.monotonicNow();
      const snapshot = Object.freeze({
        schemaVersion: EXTERNAL_HANDOFF_SNAPSHOT_SCHEMA_VERSION,
        cursor: randomId(),
        session: Object.freeze({ id: options.sessionId, framework: options.framework }),
        revision: nextRevision,
        publishedAt: new Date(publishedAtMs).toISOString(),
        expiresAt: new Date(
          publishedAtMs + EXTERNAL_HANDOFF_LIMITS.handoffTtlMs,
        ).toISOString(),
        annotation: input.annotation,
      }) satisfies ExternalHandoffSnapshot;

      if (
        Buffer.byteLength(JSON.stringify(snapshot), "utf8") >
        EXTERNAL_HANDOFF_LIMITS.maximumSnapshotBytes
      ) {
        throw new SpotPatchError(ERROR_CODES.HANDOFF_RESPONSE_TOO_LARGE);
      }

      const delivery = input.reserve(snapshot.cursor, nextRevision);

      if (current !== undefined) archive("superseded");
      revision = nextRevision;
      current = {
        expiresAtMonotonic: publishedAtMonotonic + EXTERNAL_HANDOFF_LIMITS.handoffTtlMs,
        receipts: new Set<string>(),
        snapshot,
      };
      const result = Object.freeze({
        handoff: summaryOf(current, "available"),
        delivery,
        replayed: false,
      }) satisfies ExternalHandoffPublishResult;
      idempotency.set(
        input.requestId,
        Object.freeze({
          expiresAtMonotonic:
            publishedAtMonotonic + EXTERNAL_HANDOFF_LIMITS.requestIdTtlMs,
          fingerprint: input.fingerprint,
          result,
        }),
      );
      settleWaiters(Object.freeze({ outcome: "handoff", snapshot }));
      return result;
    },

    current: readCurrent,

    currentCursor() {
      requireOpen();
      sweep();
      return current?.snapshot.cursor ?? null;
    },

    status(cursor?: string) {
      requireOpen();
      sweep();

      if (cursor === undefined) {
        if (current === undefined) {
          throw new SpotPatchError(ERROR_CODES.HANDOFF_NOT_FOUND);
        }
        return summaryOf(current, "available");
      }

      const summary = knownSummary(cursor);
      if (summary === undefined) {
        throw new SpotPatchError(ERROR_CODES.HANDOFF_CURSOR_INVALID);
      }
      return summary;
    },

    ack(cursor: string, connectorInstanceId: string) {
      const snapshot = readCurrent(cursor);

      if (snapshot !== current?.snapshot) {
        throw new SpotPatchError(ERROR_CODES.HANDOFF_CURSOR_INVALID);
      }
      if (!current.receipts.has(connectorInstanceId)) {
        if (current.receipts.size >= EXTERNAL_HANDOFF_LIMITS.maximumConnectorReceipts) {
          throw new SpotPatchError(ERROR_CODES.BRIDGE_BUSY);
        }
        current.receipts.add(connectorInstanceId);
        current.pickedUpAt = new Date(clock.wallNow()).toISOString();
      }

      return summaryOf(current, "available");
    },

    async wait(
      afterCursor: string | undefined,
      timeoutMs: number,
      signal: AbortSignal,
    ) {
      requireOpen();
      sweep();

      if (afterCursor === undefined && current !== undefined) {
        return Object.freeze({ outcome: "handoff", snapshot: current.snapshot });
      }
      if (afterCursor !== undefined) {
        const known = knownSummary(afterCursor);
        if (known === undefined) {
          throw new SpotPatchError(ERROR_CODES.HANDOFF_CURSOR_INVALID);
        }
        if (current !== undefined && current.snapshot.cursor !== afterCursor) {
          return Object.freeze({ outcome: "handoff", snapshot: current.snapshot });
        }
      }
      if (waiters.size >= EXTERNAL_HANDOFF_LIMITS.maximumWaiters) {
        throw new SpotPatchError(ERROR_CODES.BRIDGE_BUSY);
      }
      if (signal.aborted) throw new SpotPatchError(ERROR_CODES.SESSION_CLOSED);

      return new Promise<BridgeWaitResult>((resolve, reject) => {
        let settled = false;
        const finish = (): boolean => {
          if (settled) return false;
          settled = true;
          waiters.delete(waiter);
          clearTimeout(timer);
          signal.removeEventListener("abort", abort);
          return true;
        };
        const waiter: HandoffWaiter = {
          reject(error) {
            if (finish()) reject(error);
          },
          resolve(result) {
            if (finish()) resolve(result);
          },
        };
        const abort = (): void => {
          waiter.reject(new SpotPatchError(ERROR_CODES.SESSION_CLOSED));
        };
        const timer = setTimeout(() => {
          waiter.resolve(Object.freeze({ outcome: "timeout" }));
        }, timeoutMs);
        timer.unref();
        signal.addEventListener("abort", abort, { once: true });
        waiters.add(waiter);
      });
    },

    close() {
      if (closed) return;
      closed = true;
      current = undefined;
      history.length = 0;
      idempotency.clear();
      const pending = [...waiters];
      waiters.clear();

      for (const waiter of pending) {
        waiter.reject(new SpotPatchError(ERROR_CODES.SESSION_CLOSED));
      }
    },
  });
}
