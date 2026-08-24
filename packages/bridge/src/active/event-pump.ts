import {
  ERROR_CODES,
  EXTERNAL_HANDOFF_LIMITS,
  SpotPatchError,
} from "@spotpatch/shared";

import type { SpotPatchBridgeClient } from "../client.js";
import {
  ActiveAdapterProtocolError,
  ActiveDeliveryUnknownError,
  type ActiveBridgeClient,
  type ActiveBridgeLease,
  type AgentAdapter,
  type AgentDeliveryLifecycle,
  type AgentDeliveryPhase,
} from "./types.js";

const DEFAULT_RETRY_BASE_MS = 100;
const DEFAULT_RETRY_MAX_MS = 5_000;

export interface ActiveEventPumpOptions {
  readonly adapter: AgentAdapter;
  readonly client: ActiveBridgeClient & Pick<SpotPatchBridgeClient, "wait">;
  readonly onEvent?: ((event: ActiveEventPumpEvent) => void) | undefined;
  readonly random?: (() => number) | undefined;
  readonly retryBaseMs?: number | undefined;
  readonly retryMaxMs?: number | undefined;
  readonly sessionId?: string | undefined;
  readonly waitTimeoutMs?: number | undefined;
}

export type ActiveEventPumpEvent =
  | Readonly<{
      adapterKind: AgentAdapter["kind"];
      type: "ready";
    }>
  | Readonly<{
      adapterKind: AgentAdapter["kind"];
      phase: CurrentDeliveryPhase;
      revision: number;
      type: "dispatch";
    }>;

export interface ActiveEventPump {
  readonly close: () => Promise<void>;
  readonly run: (signal?: AbortSignal) => Promise<void>;
}

type CurrentDeliveryPhase = "dispatching" | AgentDeliveryPhase;

function emitEvent(
  observer: ActiveEventPumpOptions["onEvent"],
  event: ActiveEventPumpEvent,
): void {
  try {
    observer?.(event);
  } catch {
    // Diagnostics cannot change delivery state or connector lifecycle.
  }
}

function abortError(): Error {
  const error = new Error("The active event pump was aborted.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);

  return new Promise<void>((resolve, reject) => {
    const finish = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    };
    const abort = (): void => {
      finish();
      reject(abortError());
    };
    const timeout = setTimeout(() => {
      finish();
      resolve();
    }, milliseconds);
    timeout.unref();
    signal.addEventListener("abort", abort, { once: true });
  });
}

function combinedSignal(signals: readonly AbortSignal[]): AbortSignal {
  return AbortSignal.any([...signals]);
}

function isRecoverableBeforeDelivery(error: unknown): boolean {
  return (
    error instanceof SpotPatchError &&
    (error.code === ERROR_CODES.HANDOFF_CURSOR_INVALID ||
      error.code === ERROR_CODES.BRIDGE_BUSY ||
      error.code === ERROR_CODES.ACTIVE_ADAPTER_LEASE_INVALID)
  );
}

function isTerminal(phase: CurrentDeliveryPhase): phase is "completed" | "failed" {
  return phase === "completed" || phase === "failed";
}

function transitionAllowed(
  current: CurrentDeliveryPhase,
  next: AgentDeliveryPhase,
): boolean {
  if (current === next) return true;

  switch (current) {
    case "dispatching":
      return (
        next === "dispatched" ||
        next === "working" ||
        next === "failed" ||
        next === "delivery-unknown"
      );
    case "dispatched":
      return next === "working" || next === "failed" || next === "delivery-unknown";
    case "working":
      return next === "completed" || next === "failed" || next === "delivery-unknown";
    case "completed":
    case "failed":
    case "delivery-unknown":
      return false;
  }
}

class DeliveryLifecycle implements AgentDeliveryLifecycle {
  readonly #client: ActiveBridgeClient;
  readonly #cursor: string;
  readonly #lease: ActiveBridgeLease;
  readonly #observer: ActiveEventPumpOptions["onEvent"];
  readonly #revision: number;
  readonly #signal: AbortSignal;
  #phase: CurrentDeliveryPhase = "dispatching";
  #reports: Promise<void> = Promise.resolve();

  public constructor(
    client: ActiveBridgeClient,
    lease: ActiveBridgeLease,
    cursor: string,
    revision: number,
    signal: AbortSignal,
    observer: ActiveEventPumpOptions["onEvent"],
  ) {
    this.#client = client;
    this.#lease = lease;
    this.#cursor = cursor;
    this.#revision = revision;
    this.#signal = signal;
    this.#observer = observer;
  }

  public get phase(): CurrentDeliveryPhase {
    return this.#phase;
  }

  public report(phase: AgentDeliveryPhase): Promise<void> {
    const operation = this.#reports.then(async () => {
      throwIfAborted(this.#signal);

      if (phase === this.#phase) return;
      if (!transitionAllowed(this.#phase, phase)) {
        throw new ActiveAdapterProtocolError(
          `Invalid active delivery transition ${this.#phase} -> ${phase}.`,
        );
      }

      await this.#client.activeReport(this.#lease, this.#cursor, phase, this.#signal);
      this.#phase = phase;
      emitEvent(this.#observer, {
        adapterKind: this.#lease.adapterKind,
        phase,
        revision: this.#revision,
        type: "dispatch",
      });
    });
    this.#reports = operation.catch(() => undefined);
    return operation;
  }
}

interface LeaseRunState {
  adapterStarted: boolean;
  activePhase: CurrentDeliveryPhase | undefined;
}

async function heartbeatLease(
  client: ActiveBridgeClient,
  lease: ActiveBridgeLease,
  signal: AbortSignal,
): Promise<never> {
  for (;;) {
    await abortableDelay(lease.heartbeatIntervalMs, signal);
    await client.activeHeartbeat(lease, signal);
  }
}

async function bestEffortRelease(
  client: ActiveBridgeClient,
  lease: ActiveBridgeLease,
): Promise<void> {
  const releaseController = new AbortController();
  const timeout = setTimeout(() => {
    releaseController.abort();
  }, 2_000);
  timeout.unref();

  try {
    await client.activeRelease(lease, releaseController.signal);
  } catch {
    // Expiry and a stopped Broker are already represented by server-side lease cleanup.
  } finally {
    clearTimeout(timeout);
  }
}

async function consumeLease(
  options: ActiveEventPumpOptions,
  lease: ActiveBridgeLease,
  signal: AbortSignal,
  state: LeaseRunState,
): Promise<never> {
  let afterCursor = lease.baselineCursor;

  for (;;) {
    const delivery = await options.client.wait(
      lease.sessionId,
      afterCursor,
      options.waitTimeoutMs ?? EXTERNAL_HANDOFF_LIMITS.defaultWaitMs,
      signal,
    );
    if (delivery.outcome === "timeout") continue;

    const { cursor, revision } = delivery.snapshot;
    if (!delivery.receiptRecorded) {
      await options.client.activeReport(lease, cursor, "failed", signal);
      emitEvent(options.onEvent, {
        adapterKind: lease.adapterKind,
        phase: "failed",
        revision,
        type: "dispatch",
      });
      afterCursor = cursor;
      continue;
    }

    await options.client.activeReport(lease, cursor, "dispatching", signal);
    emitEvent(options.onEvent, {
      adapterKind: lease.adapterKind,
      phase: "dispatching",
      revision,
      type: "dispatch",
    });
    const lifecycle = new DeliveryLifecycle(
      options.client,
      lease,
      cursor,
      revision,
      signal,
      options.onEvent,
    );
    state.activePhase = lifecycle.phase;
    state.adapterStarted = true;

    try {
      await options.adapter.deliver(delivery.snapshot, lifecycle, signal);
      state.activePhase = lifecycle.phase;
    } catch (error: unknown) {
      state.activePhase = lifecycle.phase;

      if (signal.aborted) throw error;
      if (isTerminal(lifecycle.phase)) {
        // A Broker terminal report stays authoritative if adapter cleanup throws.
      } else {
        if (lifecycle.phase !== "delivery-unknown") {
          await lifecycle.report("delivery-unknown").catch(() => undefined);
          state.activePhase = "delivery-unknown";
        }

        throw error instanceof ActiveDeliveryUnknownError
          ? error
          : new ActiveDeliveryUnknownError();
      }
    }

    if (!isTerminal(lifecycle.phase)) {
      await lifecycle.report("delivery-unknown").catch(() => undefined);
      state.activePhase = "delivery-unknown";
      throw new ActiveDeliveryUnknownError(
        "Agent adapter returned without a completed or failed report.",
      );
    }

    afterCursor = cursor;
    state.adapterStarted = false;
    state.activePhase = undefined;
  }
}

async function runLease(
  options: ActiveEventPumpOptions,
  lease: ActiveBridgeLease,
  outerSignal: AbortSignal,
): Promise<void> {
  const leaseController = new AbortController();
  const signal = combinedSignal([outerSignal, leaseController.signal]);
  const state: LeaseRunState = { adapterStarted: false, activePhase: undefined };
  let heartbeatError: unknown;
  const heartbeat = heartbeatLease(options.client, lease, signal).catch(
    (error: unknown) => {
      if (!signal.aborted) {
        heartbeatError = error;
        leaseController.abort();
      }
    },
  );

  try {
    await consumeLease(options, lease, signal, state);
  } catch (error: unknown) {
    if (heartbeatError !== undefined && state.adapterStarted) {
      const cursorPhase = state.activePhase;

      if (
        cursorPhase === "dispatching" ||
        cursorPhase === "dispatched" ||
        cursorPhase === "working"
      ) {
        throw new ActiveDeliveryUnknownError("Active lease heartbeat was lost.");
      }
    }

    throw heartbeatError ?? error;
  } finally {
    leaseController.abort();
    await heartbeat;
    await bestEffortRelease(options.client, lease);
  }
}

function retryDelay(
  failures: number,
  baseMs: number,
  maximumMs: number,
  random: () => number,
): number {
  const exponential = Math.min(maximumMs, baseMs * 2 ** Math.min(failures, 10));
  return Math.max(1, Math.round(exponential * (0.75 + random() * 0.5)));
}

export function createActiveEventPump(
  options: ActiveEventPumpOptions,
): ActiveEventPump {
  const controller = new AbortController();
  let adapterClosed = false;
  let closed = false;
  let running: Promise<void> | undefined;

  const closeAdapter = async (): Promise<void> => {
    if (adapterClosed) return;
    adapterClosed = true;
    await options.adapter.close();
  };

  const run = async (externalSignal?: AbortSignal): Promise<void> => {
    if (running !== undefined) return running;
    if (closed) throw abortError();

    const signal =
      externalSignal === undefined
        ? controller.signal
        : combinedSignal([controller.signal, externalSignal]);
    const operation = (async () => {
      let failures = 0;

      try {
        for (;;) {
          try {
            throwIfAborted(signal);
            const lease = await options.client.activeClaim(
              options.adapter.kind,
              options.sessionId,
              signal,
            );
            failures = 0;
            emitEvent(options.onEvent, {
              adapterKind: lease.adapterKind,
              type: "ready",
            });
            await runLease(options, lease, signal);
          } catch (error: unknown) {
            if (signal.aborted) break;
            if (error instanceof ActiveDeliveryUnknownError) throw error;
            if (!isRecoverableBeforeDelivery(error)) throw error;

            const delay = retryDelay(
              failures,
              options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS,
              options.retryMaxMs ?? DEFAULT_RETRY_MAX_MS,
              options.random ?? Math.random,
            );
            failures += 1;
            await abortableDelay(delay, signal);
          }
        }
      } finally {
        await closeAdapter();
      }
    })();
    running = operation;
    return operation;
  };

  return Object.freeze({
    run,
    async close() {
      if (closed) return;
      closed = true;
      controller.abort();
      if (running === undefined) await closeAdapter();
      else await running;
    },
  });
}
