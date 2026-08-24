import {
  ERROR_CODES,
  EXTERNAL_HANDOFF_BROKER_PROTOCOL_VERSION,
  EXTERNAL_HANDOFF_SNAPSHOT_SCHEMA_VERSION,
  SpotPatchError,
  type ExternalHandoffCapability,
  type ExternalHandoffFramework,
  type ExternalHandoffPublishRequest,
  type ExternalHandoffPublishResult,
  type ExternalHandoffStatusResult,
  type SpotAnnotation,
} from "@spotpatch/shared";
import { computeExternalHandoffProjectKey } from "@spotpatch/shared/external-agent-node";

import {
  createActiveAdapterRegistry,
  type ActiveAdapterRegistry,
} from "./active-registry.js";
import { createExternalHandoffBroker, type ExternalHandoffBroker } from "./broker.js";
import {
  publishExternalHandoffDescriptor,
  type PublishedExternalHandoffDescriptor,
} from "./discovery.js";
import { fingerprintExternalHandoffAnnotation } from "./fingerprint.js";
import { createExternalHandoffStore } from "./store.js";

export type AuthorizeExternalHandoff = (
  annotation: ExternalHandoffPublishRequest["annotation"],
) => Promise<SpotAnnotation>;

export interface ExternalHandoffService {
  readonly capability: () => ExternalHandoffCapability;
  readonly close: () => Promise<void>;
  readonly publish: (
    request: ExternalHandoffPublishRequest,
    authorize: AuthorizeExternalHandoff,
  ) => Promise<ExternalHandoffPublishResult>;
  readonly resolveDelivery: (cursor: string) => ExternalHandoffStatusResult;
  readonly start: () => Promise<void>;
  readonly status: (cursor?: string) => ExternalHandoffStatusResult;
}

export interface CreateExternalHandoffServiceOptions {
  readonly framework: ExternalHandoffFramework;
  readonly root: string;
  readonly sessionId: string;
}

interface InFlightPublish {
  readonly fingerprint: string;
  readonly promise: Promise<ExternalHandoffPublishResult>;
}

type ServiceState = "idle" | "starting" | "ready" | "failed" | "closed";

function asReplay(result: ExternalHandoffPublishResult): ExternalHandoffPublishResult {
  return Object.freeze({ ...result, replayed: true });
}

export function createExternalHandoffService(
  options: CreateExternalHandoffServiceOptions,
): ExternalHandoffService {
  const activeRegistry: ActiveAdapterRegistry = createActiveAdapterRegistry();
  const store = createExternalHandoffStore({
    framework: options.framework,
    sessionId: options.sessionId,
  });
  const inFlight = new Map<string, InFlightPublish>();
  let broker: ExternalHandoffBroker | undefined;
  let descriptor: PublishedExternalHandoffDescriptor | undefined;
  let startPromise: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;
  let state: ServiceState = "idle";
  const isClosed = (): boolean => state === "closed";

  const requireReady = (): void => {
    if (state !== "ready" || broker?.isReady() !== true) {
      throw new SpotPatchError(
        state === "closed"
          ? ERROR_CODES.SESSION_CLOSED
          : ERROR_CODES.EXTERNAL_HANDOFF_UNAVAILABLE,
      );
    }
  };

  const start = async (): Promise<void> => {
    if (state === "ready") return;
    if (state === "closed") throw new SpotPatchError(ERROR_CODES.SESSION_CLOSED);
    if (startPromise !== undefined) return startPromise;

    state = "starting";
    startPromise = (async () => {
      let createdBroker: ExternalHandoffBroker | undefined;
      let createdDescriptor: PublishedExternalHandoffDescriptor | undefined;

      try {
        const projectKey = await computeExternalHandoffProjectKey(options.root);
        createdBroker = await createExternalHandoffBroker({
          activeRegistry,
          framework: options.framework,
          projectKey,
          sessionId: options.sessionId,
          store,
        });
        createdDescriptor = await publishExternalHandoffDescriptor({
          bridgeToken: createdBroker.bridgeToken,
          endpoint: createdBroker.endpoint,
          framework: options.framework,
          root: options.root,
          sessionId: options.sessionId,
        });

        if (isClosed()) {
          await createdDescriptor.close();
          await createdBroker.close();
          throw new SpotPatchError(ERROR_CODES.SESSION_CLOSED);
        }

        broker = createdBroker;
        descriptor = createdDescriptor;
        state = "ready";
      } catch (error: unknown) {
        if (createdDescriptor !== undefined && descriptor !== createdDescriptor) {
          await createdDescriptor.close().catch(() => undefined);
        }
        if (createdBroker !== undefined && broker !== createdBroker) {
          await createdBroker.close().catch(() => undefined);
        }
        if (!isClosed()) state = "failed";
        throw error;
      }
    })();

    return startPromise;
  };

  return Object.freeze({
    start,

    capability() {
      const currentCursor = store.currentCursor();
      const active = activeRegistry.snapshot(currentCursor ?? undefined);
      return Object.freeze({
        enabled: true,
        brokerReady: state === "ready" && broker?.isReady() === true,
        activeWaitCount: store.activeWaitCount(),
        snapshotSchemaVersion: EXTERNAL_HANDOFF_SNAPSHOT_SCHEMA_VERSION,
        brokerProtocolVersion: EXTERNAL_HANDOFF_BROKER_PROTOCOL_VERSION,
        activeAdapter: active.activeAdapter,
        dispatch: currentCursor === null ? null : active.dispatch,
      });
    },

    async publish(
      request: ExternalHandoffPublishRequest,
      authorize: AuthorizeExternalHandoff,
    ) {
      requireReady();
      const fingerprint = fingerprintExternalHandoffAnnotation(request.annotation);
      const replayed = store.replay(request.requestId, fingerprint);
      if (replayed !== undefined) return replayed;

      const pending = inFlight.get(request.requestId);
      if (pending !== undefined) {
        if (pending.fingerprint !== fingerprint) {
          throw new SpotPatchError(ERROR_CODES.HANDOFF_VALIDATION_FAILED);
        }
        return asReplay(await pending.promise);
      }

      activeRegistry.assertPublishable();

      const promise = (async (): Promise<ExternalHandoffPublishResult> => {
        const annotation = await authorize(request.annotation);
        return store.publish({
          annotation,
          fingerprint,
          requestId: request.requestId,
          reserve: activeRegistry.reserve,
        });
      })();
      const activePublish = Object.freeze({ fingerprint, promise });
      inFlight.set(request.requestId, activePublish);

      try {
        return await promise;
      } finally {
        if (inFlight.get(request.requestId) === activePublish) {
          inFlight.delete(request.requestId);
        }
      }
    },

    status(cursor?: string) {
      requireReady();
      const handoff = store.status(cursor);
      const active = activeRegistry.snapshot(cursor ?? handoff.cursor);
      return Object.freeze({
        handoff,
        activeAdapter: active.activeAdapter,
        dispatch: active.dispatch,
      });
    },

    resolveDelivery(cursor: string) {
      requireReady();
      const handoff = store.status(cursor);
      const active = activeRegistry.resolveDelivery(cursor);
      return Object.freeze({
        handoff,
        activeAdapter: active.activeAdapter,
        dispatch: active.dispatch,
      });
    },

    close() {
      closePromise ??= (async () => {
        if (state === "closed") return;
        state = "closed";
        activeRegistry.close();
        store.close();
        inFlight.clear();
        await startPromise?.catch(() => undefined);
        const publishedDescriptor = descriptor;
        descriptor = undefined;
        const activeBroker = broker;
        broker = undefined;
        await publishedDescriptor?.close().catch(() => undefined);
        await activeBroker?.close().catch(() => undefined);
      })();
      return closePromise;
    },
  });
}
