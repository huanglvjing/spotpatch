import type { IncomingMessage, ServerResponse } from "node:http";

import {
  ERROR_CODES,
  EXTERNAL_AGENT_CONTROL_LIMITS,
  SPOTPATCH_ENDPOINTS,
  SpotPatchError,
  externalAgentControlCancelRequestSchema,
  externalAgentControlConnectRequestSchema,
  externalAgentControlDisconnectRequestSchema,
  externalAgentControlStatusRequestSchema,
  externalAgentControlStatusSchema,
  externalAgentEventSchema,
  externalAgentEventsRequestSchema,
  externalAgentManagedResultSchema,
  externalAgentResultRequestSchema,
  type ExternalAgentEvent,
} from "@spotpatch/shared";

import { readJsonRequestBody } from "../server/request-body.js";
import type { ExternalAgentControlPort } from "./control-port.js";

export type ExternalAgentBrowserRoute =
  "cancel" | "connect" | "disconnect" | "events" | "result" | "status";

export interface ExternalAgentBrowserController {
  handle(
    request: IncomingMessage,
    response: ServerResponse,
    route: ExternalAgentBrowserRoute,
    writeSuccess: (response: ServerResponse, status: number, data: unknown) => void,
  ): Promise<void>;
  dispose(): void;
}

export function matchExternalAgentBrowserPath(
  path: string,
): ExternalAgentBrowserRoute | undefined {
  if (path === SPOTPATCH_ENDPOINTS.externalAgentControlStatus) return "status";
  if (path === SPOTPATCH_ENDPOINTS.externalAgentControlConnect) return "connect";
  if (path === SPOTPATCH_ENDPOINTS.externalAgentControlDisconnect) {
    return "disconnect";
  }
  if (path === SPOTPATCH_ENDPOINTS.externalAgentControlCancel) return "cancel";
  if (path === SPOTPATCH_ENDPOINTS.externalAgentEvents) return "events";
  if (path === SPOTPATCH_ENDPOINTS.externalAgentResult) return "result";
  return undefined;
}

function writeEvent(response: ServerResponse, event: ExternalAgentEvent): void {
  response.write(`${JSON.stringify(externalAgentEventSchema.parse(event))}\n`);
}

export function createExternalAgentBrowserController(
  port: ExternalAgentControlPort,
): ExternalAgentBrowserController {
  const streams = new Set<ServerResponse>();
  let disposed = false;

  const handleEvents = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const parsed = externalAgentEventsRequestSchema.safeParse(
      await readJsonRequestBody(request),
    );

    if (!parsed.success) {
      throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
    }
    if (
      disposed ||
      streams.size >= EXTERNAL_AGENT_CONTROL_LIMITS.maximumEventSubscribers
    ) {
      throw new SpotPatchError(ERROR_CODES.BRIDGE_BUSY);
    }

    response.statusCode = 200;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    response.setHeader("X-Content-Type-Options", "nosniff");
    streams.add(response);
    const initial = externalAgentControlStatusSchema.parse(port.getStatus());
    writeEvent(response, { type: "status", data: initial });

    const unsubscribe = port.subscribe((status) => {
      if (!response.destroyed && status.sequence > (parsed.data.afterSequence ?? -1)) {
        writeEvent(response, { type: "status", data: status });
      }
    });
    const heartbeat = setInterval(() => {
      if (!response.destroyed) {
        const status = port.getStatus();
        writeEvent(response, {
          type: "heartbeat",
          sequence: status.sequence,
          emittedAt: new Date().toISOString(),
        });
      }
    }, EXTERNAL_AGENT_CONTROL_LIMITS.eventHeartbeatMs);
    heartbeat.unref();

    await new Promise<void>((resolve) => {
      const close = (): void => {
        response.off("close", close);
        clearInterval(heartbeat);
        unsubscribe();
        streams.delete(response);
        resolve();
      };
      response.once("close", close);
    });
  };

  return Object.freeze({
    async handle(
      request: IncomingMessage,
      response: ServerResponse,
      route: ExternalAgentBrowserRoute,
      writeSuccess: (response: ServerResponse, status: number, data: unknown) => void,
    ): Promise<void> {
      if (request.method !== "POST" || disposed) {
        throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
      }

      if (route === "events") {
        await handleEvents(request, response);
        return;
      }
      if (route === "status") {
        const parsed = externalAgentControlStatusRequestSchema.safeParse(
          await readJsonRequestBody(request),
        );
        if (!parsed.success) throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
        writeSuccess(
          response,
          200,
          externalAgentControlStatusSchema.parse(port.getStatus()),
        );
        return;
      }
      if (route === "connect") {
        const parsed = externalAgentControlConnectRequestSchema.safeParse(
          await readJsonRequestBody(request),
        );
        if (!parsed.success) throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
        const controller = new AbortController();
        response.once("close", () => {
          if (!response.writableEnded) controller.abort("browser-disconnected");
        });
        writeSuccess(
          response,
          200,
          externalAgentControlStatusSchema.parse(
            await port.connect(parsed.data, controller.signal),
          ),
        );
        return;
      }
      if (route === "disconnect") {
        const parsed = externalAgentControlDisconnectRequestSchema.safeParse(
          await readJsonRequestBody(request),
        );
        if (!parsed.success) throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
        writeSuccess(
          response,
          200,
          externalAgentControlStatusSchema.parse(await port.disconnect(parsed.data)),
        );
        return;
      }
      if (route === "cancel") {
        const parsed = externalAgentControlCancelRequestSchema.safeParse(
          await readJsonRequestBody(request),
        );
        if (!parsed.success) throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
        writeSuccess(
          response,
          200,
          externalAgentControlStatusSchema.parse(await port.cancel(parsed.data)),
        );
        return;
      }

      const parsed = externalAgentResultRequestSchema.safeParse(
        await readJsonRequestBody(request),
      );
      if (!parsed.success) throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
      const result = port.getResult(parsed.data.revision);
      if (result === undefined) {
        throw new SpotPatchError(ERROR_CODES.HANDOFF_NOT_FOUND);
      }
      writeSuccess(response, 200, externalAgentManagedResultSchema.parse(result));
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const response of streams) response.end();
      streams.clear();
    },
  });
}
