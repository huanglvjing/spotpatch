import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";

import {
  ERROR_CODES,
  EXTERNAL_HANDOFF_BROKER_PROTOCOL_VERSION,
  EXTERNAL_HANDOFF_LIMITS,
  SpotPatchError,
  type ApiFailure,
  type ApiSuccess,
  type ExternalHandoffFramework,
} from "@spotpatch/shared";
import {
  SPOTPATCH_BRIDGE_PATHS,
  SPOTPATCH_BRIDGE_TOKEN_HEADER,
  bridgeAckRequestSchema,
  bridgeActiveClaimRequestSchema,
  bridgeActiveHeartbeatRequestSchema,
  bridgeActiveReleaseRequestSchema,
  bridgeActiveReportRequestSchema,
  bridgeCurrentRequestSchema,
  bridgeStatusRequestSchema,
  bridgeWaitRequestSchema,
} from "@spotpatch/shared/external-agent-node";

import { readJsonRequestBody } from "../server/request-body.js";
import type { ActiveAdapterRegistry } from "./active-registry.js";
import type { ExternalHandoffStore } from "./store.js";

export interface ExternalHandoffBroker {
  readonly bridgeToken: string;
  readonly close: () => Promise<void>;
  readonly endpoint: string;
  readonly isReady: () => boolean;
}

export interface CreateExternalHandoffBrokerOptions {
  readonly activeRegistry: ActiveAdapterRegistry;
  readonly framework: ExternalHandoffFramework;
  readonly projectKey: string;
  readonly sessionId: string;
  readonly store: ExternalHandoffStore;
}

function singleHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? undefined : value;
}

function tokensMatch(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

function writeJson<T>(
  response: ServerResponse,
  status: number,
  payload: ApiSuccess<T> | ApiFailure,
): void {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Connection", "close");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(payload));
}

function statusForError(code: string): number {
  if (code === ERROR_CODES.BRIDGE_UNAUTHORIZED) return 401;
  if (code === ERROR_CODES.HANDOFF_NOT_FOUND) return 404;
  if (code === ERROR_CODES.HANDOFF_EXPIRED || code === ERROR_CODES.SESSION_CLOSED) {
    return 410;
  }
  if (code === ERROR_CODES.BRIDGE_BUSY) return 429;
  if (code === ERROR_CODES.ACTIVE_ADAPTER_LEASE_INVALID) return 401;
  if (code === ERROR_CODES.HANDOFF_RESPONSE_TOO_LARGE) return 413;
  if (
    code === ERROR_CODES.HANDOFF_CURSOR_INVALID ||
    code === ERROR_CODES.BRIDGE_PROTOCOL_MISMATCH ||
    code === ERROR_CODES.EXTERNAL_AGENT_BUSY ||
    code === ERROR_CODES.ACTIVE_ADAPTER_CONFLICT ||
    code === ERROR_CODES.ACTIVE_DISPATCH_INVALID
  ) {
    return 409;
  }
  if (code === ERROR_CODES.INVALID_REQUEST) return 400;
  return 500;
}

function normalizeError(error: unknown): SpotPatchError {
  return error instanceof SpotPatchError
    ? error
    : new SpotPatchError(ERROR_CODES.INTERNAL_ERROR, undefined, { cause: error });
}

function assertAuthorized(
  request: IncomingMessage,
  expectedHost: string,
  bridgeToken: string,
): void {
  if (
    request.socket.remoteAddress !== "127.0.0.1" ||
    singleHeader(request, "host") !== expectedHost ||
    !tokensMatch(singleHeader(request, SPOTPATCH_BRIDGE_TOKEN_HEADER), bridgeToken)
  ) {
    throw new SpotPatchError(ERROR_CODES.BRIDGE_UNAUTHORIZED);
  }
}

async function closeServer(server: Server, sockets: Set<Socket>): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });

    for (const socket of sockets) {
      socket.destroy();
    }
  });
}

export async function createExternalHandoffBroker(
  options: CreateExternalHandoffBrokerOptions,
): Promise<ExternalHandoffBroker> {
  const bridgeToken = randomBytes(32).toString("base64url");
  const sockets = new Set<Socket>();
  let expectedHost = "";
  const server = createServer(
    { maxHeaderSize: EXTERNAL_HANDOFF_LIMITS.maximumBrokerHeaderBytes },
    (request, response) => {
      const handle = async (): Promise<void> => {
        assertAuthorized(request, expectedHost, bridgeToken);

        if (request.method !== "POST") {
          throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
        }

        const body = await readJsonRequestBody(
          request,
          EXTERNAL_HANDOFF_LIMITS.maximumBrokerRequestBytes,
        );

        if (request.url === SPOTPATCH_BRIDGE_PATHS.status) {
          const parsed = bridgeStatusRequestSchema.safeParse(body);
          if (!parsed.success) throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
          let current = null;

          try {
            current = options.store.status();
          } catch (error: unknown) {
            if (
              !(error instanceof SpotPatchError) ||
              error.code !== ERROR_CODES.HANDOFF_NOT_FOUND
            ) {
              throw error;
            }
          }

          writeJson(response, 200, {
            ok: true,
            data: Object.freeze({
              brokerProtocolVersion: EXTERNAL_HANDOFF_BROKER_PROTOCOL_VERSION,
              projectKey: options.projectKey,
              sessionId: options.sessionId,
              framework: options.framework,
              current,
            }),
          });
          return;
        }

        if (request.url === SPOTPATCH_BRIDGE_PATHS.current) {
          const parsed = bridgeCurrentRequestSchema.safeParse(body);
          if (!parsed.success) throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
          const snapshot = options.store.current(parsed.data.cursor);
          writeJson(response, 200, {
            ok: true,
            data: Object.freeze({ outcome: "handoff" as const, snapshot }),
          });
          return;
        }

        if (request.url === SPOTPATCH_BRIDGE_PATHS.ack) {
          const parsed = bridgeAckRequestSchema.safeParse(body);
          if (!parsed.success) throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
          const summary = options.store.ack(
            parsed.data.cursor,
            parsed.data.connectorInstanceId,
          );
          writeJson(response, 200, {
            ok: true,
            data: Object.freeze({ summary }),
          });
          return;
        }

        if (request.url === SPOTPATCH_BRIDGE_PATHS.wait) {
          const parsed = bridgeWaitRequestSchema.safeParse(body);
          if (!parsed.success) throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
          const controller = new AbortController();
          const abort = (): void => {
            if (!response.writableEnded) controller.abort("bridge-client-closed");
          };
          response.once("close", abort);

          try {
            const data = await options.store.wait(
              parsed.data.afterCursor,
              parsed.data.timeoutMs,
              controller.signal,
            );
            writeJson(response, 200, { ok: true, data });
          } finally {
            response.removeListener("close", abort);
          }
          return;
        }

        if (request.url === SPOTPATCH_BRIDGE_PATHS.activeClaim) {
          const parsed = bridgeActiveClaimRequestSchema.safeParse(body);
          if (!parsed.success) throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
          const data = options.activeRegistry.claim(
            parsed.data.adapterKind,
            parsed.data.connectorInstanceId,
            options.store.currentCursor(),
          );
          writeJson(response, 200, { ok: true, data });
          return;
        }

        if (request.url === SPOTPATCH_BRIDGE_PATHS.activeHeartbeat) {
          const parsed = bridgeActiveHeartbeatRequestSchema.safeParse(body);
          if (!parsed.success) throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
          const data = options.activeRegistry.heartbeat(parsed.data.leaseToken);
          writeJson(response, 200, { ok: true, data });
          return;
        }

        if (request.url === SPOTPATCH_BRIDGE_PATHS.activeReport) {
          const parsed = bridgeActiveReportRequestSchema.safeParse(body);
          if (!parsed.success) throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
          const data = options.activeRegistry.report(
            parsed.data.leaseToken,
            parsed.data.cursor,
            parsed.data.phase,
          );
          writeJson(response, 200, { ok: true, data });
          return;
        }

        if (request.url === SPOTPATCH_BRIDGE_PATHS.activeRelease) {
          const parsed = bridgeActiveReleaseRequestSchema.safeParse(body);
          if (!parsed.success) throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
          const data = options.activeRegistry.release(parsed.data.leaseToken);
          writeJson(response, 200, { ok: true, data });
          return;
        }

        throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
      };

      void handle().catch((error: unknown) => {
        if (response.writableEnded || response.destroyed) return;
        const normalized = normalizeError(error);

        if (normalized.code === ERROR_CODES.BRIDGE_BUSY) {
          response.setHeader("Retry-After", "1");
        }

        writeJson(response, statusForError(normalized.code), {
          ok: false,
          error: {
            code: normalized.code,
            message: "The local SpotPatch bridge request failed.",
          },
        });
      });
    },
  );
  server.maxConnections = EXTERNAL_HANDOFF_LIMITS.maximumBrokerSockets;
  server.headersTimeout = 5_000;
  server.requestTimeout = EXTERNAL_HANDOFF_LIMITS.maximumWaitMs + 5_000;
  server.keepAliveTimeout = 1;
  server.on("connection", (socket) => {
    if (sockets.size >= EXTERNAL_HANDOFF_LIMITS.maximumBrokerSockets) {
      socket.destroy();
      return;
    }

    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();

  if (
    address === null ||
    typeof address === "string" ||
    address.address !== "127.0.0.1"
  ) {
    await closeServer(server, sockets);
    throw new Error("SpotPatch external Agent broker did not bind IPv4 loopback.");
  }

  expectedHost = `127.0.0.1:${String(address.port)}`;
  let closed = false;
  let ready = true;
  server.removeAllListeners("error");
  server.on("error", () => {
    ready = false;

    for (const socket of sockets) socket.destroy();
  });
  return Object.freeze({
    bridgeToken,
    endpoint: `http://${expectedHost}`,
    isReady: () => ready && !closed,
    async close() {
      if (closed) return;
      closed = true;
      ready = false;
      await closeServer(server, sockets);
    },
  });
}
