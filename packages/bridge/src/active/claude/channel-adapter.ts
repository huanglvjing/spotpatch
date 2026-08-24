import type { McpServer } from "@modelcontextprotocol/server";
import {
  ERROR_CODES,
  EXTERNAL_HANDOFF_LIMITS,
  SpotPatchError,
} from "@spotpatch/shared";

import {
  ActiveAdapterProtocolError,
  ActiveDeliveryUnknownError,
  type AgentAdapter,
  type AgentDeliveryLifecycle,
  type AgentHandoffSnapshot,
} from "../types.js";

export const CLAUDE_CHANNEL_NOTIFICATION_METHOD =
  "notifications/claude/channel" as const;

export type ClaudeHandoffOutcome = "completed" | "failed";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: T) => void;
}

interface PendingDelivery {
  readonly completion: Deferred<undefined>;
  readonly cursor: string;
  readonly lifecycle: AgentDeliveryLifecycle;
  readonly ready: Deferred<undefined>;
}

interface TerminalDelivery {
  readonly cursor: string;
  readonly outcome: ClaudeHandoffOutcome;
}

export interface ClaudeChannelAdapterOptions {
  readonly deliveryTimeoutMs?: number | undefined;
  readonly notificationTimeoutMs?: number | undefined;
  readonly server: McpServer;
}

export interface ClaudeChannelAdapter extends AgentAdapter {
  readonly kind: "claude-channel";
  readonly reportExactRead: (cursor: string, signal?: AbortSignal) => Promise<void>;
  readonly reportResult: (
    cursor: string,
    outcome: ClaudeHandoffOutcome,
    signal?: AbortSignal,
  ) => Promise<void>;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  // A host may disconnect before a waiter is attached. Keep rejection handled.
  void promise.catch(() => undefined);
  return Object.freeze({
    promise,
    reject: rejectPromise,
    resolve: resolvePromise,
  });
}

function abortError(): Error {
  const error = new Error("Claude Channel delivery was aborted.");
  error.name = "AbortError";
  return error;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw abortError();
}

function waitForCompletion(
  completion: Promise<void>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<void> {
  assertNotAborted(signal);

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      callback();
    };
    const abort = (): void => {
      finish(() => {
        reject(abortError());
      });
    };
    const timeout = setTimeout(() => {
      finish(() => {
        reject(
          new ActiveDeliveryUnknownError(
            "Claude did not report a terminal result before the delivery deadline.",
          ),
        );
      });
    }, timeoutMs);
    timeout.unref();
    signal.addEventListener("abort", abort, { once: true });
    completion.then(
      () => {
        finish(resolve);
      },
      (error: unknown) => {
        finish(() => {
          reject(
            error instanceof Error
              ? error
              : new ActiveAdapterProtocolError(
                  "Claude Channel completion rejected with a non-Error value.",
                ),
          );
        });
      },
    );
  });
}

function waitForNotification(
  notification: Promise<void>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<void> {
  assertNotAborted(signal);

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      callback();
    };
    const abort = (): void => {
      finish(() => {
        reject(abortError());
      });
    };
    const timeout = setTimeout(() => {
      finish(() => {
        reject(
          new ActiveDeliveryUnknownError(
            "Claude Channel notification write exceeded its deadline.",
          ),
        );
      });
    }, timeoutMs);
    timeout.unref();
    signal.addEventListener("abort", abort, { once: true });
    notification.then(
      () => {
        finish(resolve);
      },
      (error: unknown) => {
        const rejection =
          error instanceof Error
            ? error
            : new ActiveAdapterProtocolError(
                "Claude Channel notification rejected with a non-Error value.",
              );
        finish(() => {
          reject(rejection);
        });
      },
    );
  });
}

function channelContent(snapshot: AgentHandoffSnapshot): string {
  return `SpotPatch revision ${String(snapshot.revision)} is ready. Call spotpatch_get_current_handoff with sessionId ${snapshot.session.id} and the exact cursor, implement the request, then report completed or failed.`;
}

function invalidDispatch(): SpotPatchError {
  return new SpotPatchError(ERROR_CODES.ACTIVE_DISPATCH_INVALID);
}

export function createClaudeChannelAdapter(
  options: ClaudeChannelAdapterOptions,
): ClaudeChannelAdapter {
  const closeController = new AbortController();
  let closed = false;
  let pending: PendingDelivery | undefined;
  let terminal: TerminalDelivery | undefined;

  const requirePending = (cursor: string): PendingDelivery => {
    const current = pending;
    if (current?.cursor !== cursor) throw invalidDispatch();
    return current;
  };

  const adapter: ClaudeChannelAdapter = {
    kind: "claude-channel",

    async deliver(snapshot, lifecycle, signal) {
      if (closed) throw new ActiveAdapterProtocolError("Claude Channel is closed.");
      if (pending !== undefined) {
        throw new ActiveAdapterProtocolError(
          "Claude Channel accepts only one active delivery.",
        );
      }

      const current: PendingDelivery = Object.freeze({
        completion: deferred<undefined>(),
        cursor: snapshot.cursor,
        lifecycle,
        ready: deferred<undefined>(),
      });
      pending = current;
      const deliverySignal = AbortSignal.any([signal, closeController.signal]);

      try {
        try {
          assertNotAborted(deliverySignal);
          await waitForNotification(
            options.server.server.notification({
              method: CLAUDE_CHANNEL_NOTIFICATION_METHOD,
              params: {
                content: channelContent(snapshot),
                meta: {
                  cursor: snapshot.cursor,
                  revision: String(snapshot.revision),
                  session_id: snapshot.session.id,
                },
              },
            }),
            options.notificationTimeoutMs ??
              EXTERNAL_HANDOFF_LIMITS.activeTransportWriteTimeoutMs,
            deliverySignal,
          );
          await lifecycle.report("dispatched");
          current.ready.resolve(undefined);
        } catch (error: unknown) {
          current.ready.reject(error);
          await lifecycle.report("delivery-unknown").catch(() => undefined);
          throw new ActiveDeliveryUnknownError(
            "Claude Channel notification write could not be proved.",
          );
        }

        try {
          await waitForCompletion(
            current.completion.promise,
            options.deliveryTimeoutMs ??
              EXTERNAL_HANDOFF_LIMITS.activeDispatchTimeoutMs,
            deliverySignal,
          );
        } catch (error: unknown) {
          if (!deliverySignal.aborted && error instanceof ActiveDeliveryUnknownError) {
            await lifecycle.report("delivery-unknown").catch(() => undefined);
          }

          throw error;
        }
      } finally {
        if (pending === current) pending = undefined;
      }
    },

    async reportExactRead(cursor, signal) {
      assertNotAborted(signal);
      if (terminal?.cursor === cursor) return;
      const current = requirePending(cursor);
      await current.ready.promise;
      assertNotAborted(signal);
      await current.lifecycle.report("working");
    },

    async reportResult(cursor, outcome, signal) {
      assertNotAborted(signal);
      if (terminal?.cursor === cursor) {
        if (terminal.outcome !== outcome) throw invalidDispatch();
        return;
      }

      const current = requirePending(cursor);
      await current.ready.promise;
      assertNotAborted(signal);
      await current.lifecycle.report(outcome);
      terminal = Object.freeze({ cursor, outcome });
      current.completion.resolve(undefined);
    },

    close() {
      if (closed) return Promise.resolve();
      closed = true;
      closeController.abort();
      pending?.ready.reject(abortError());
      pending?.completion.reject(abortError());
      return Promise.resolve();
    },
  };

  return Object.freeze(adapter);
}
