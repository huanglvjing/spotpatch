import type { IncomingMessage, ServerResponse } from "node:http";

import {
  askJobActionRequestSchema,
  askJobCreateRequestSchema,
  askJobEventsRequestSchema,
  CONTEXTUAL_ASK_LIMITS,
  SPOTPATCH_ENDPOINTS,
  type ContextualAskErrorCode,
} from "@spotpatch/shared";

import { readJsonRequestBody } from "../server/request-body.js";
import type { SpotPatchServerLogger } from "../server/middleware.js";
import { ContextualAskError } from "./error.js";
import type { ContextualAskManager } from "./manager.js";

export type ContextualAskRoute =
  | Readonly<{ kind: "capability" }>
  | Readonly<{ kind: "create" }>
  | Readonly<{ kind: "job"; action: "events" | "result" | "cancel"; jobId: string }>;

const STATUS_BY_ERROR = Object.freeze({
  ASK_DISABLED: 404,
  ASK_SELECTION_REQUIRED: 422,
  ASK_SELECTION_STALE: 409,
  ASK_QUESTION_INVALID: 422,
  ASK_EXECUTOR_UNAVAILABLE: 503,
  ASK_TIMEOUT: 504,
  ASK_CONSENT_REQUIRED: 403,
  ASK_BUSY: 409,
  ASK_IDEMPOTENCY_CONFLICT: 409,
  ASK_SOURCE_SCOPE_DENIED: 403,
  ASK_LIMIT_EXCEEDED: 413,
  ASK_ANSWER_INVALID: 502,
  ASK_WRITE_ATTEMPTED: 403,
  ASK_CANCELLED: 409,
  ASK_RESULT_EXPIRED: 410,
  ASK_PROTOCOL_INCOMPATIBLE: 400,
} satisfies Record<ContextualAskErrorCode, number>);

const PUBLIC_MESSAGES = Object.freeze({
  ASK_DISABLED: "Contextual Ask is not enabled.",
  ASK_SELECTION_REQUIRED: "Select at least one source-backed element.",
  ASK_SELECTION_STALE: "The selected source is stale.",
  ASK_QUESTION_INVALID: "The question is invalid.",
  ASK_EXECUTOR_UNAVAILABLE: "The selected Ask executor is unavailable.",
  ASK_TIMEOUT: "The Ask executor did not answer before the deadline.",
  ASK_CONSENT_REQUIRED: "Provider data consent is required.",
  ASK_BUSY: "Another workspace task is active.",
  ASK_IDEMPOTENCY_CONFLICT: "The request ID was reused with different content.",
  ASK_SOURCE_SCOPE_DENIED: "The requested source scope was denied.",
  ASK_LIMIT_EXCEEDED: "The Ask request exceeded a safety limit.",
  ASK_ANSWER_INVALID: "The executor returned an invalid answer.",
  ASK_WRITE_ATTEMPTED: "Ask executors cannot write project files.",
  ASK_CANCELLED: "The Ask job was cancelled.",
  ASK_RESULT_EXPIRED: "The Ask result has expired.",
  ASK_PROTOCOL_INCOMPATIBLE: "The Ask protocol request is incompatible.",
} satisfies Record<ContextualAskErrorCode, string>);

function writeJson(response: ServerResponse, status: number, data: unknown): void {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify({ ok: true, data }));
}

function writeError(
  response: ServerResponse,
  error: unknown,
  logger: SpotPatchServerLogger | undefined,
): void {
  const normalized =
    error instanceof ContextualAskError
      ? error
      : new ContextualAskError("ASK_EXECUTOR_UNAVAILABLE", { cause: error });
  if (normalized.code === "ASK_EXECUTOR_UNAVAILABLE" && error !== normalized) {
    logger?.warn("[spotpatch:ask] Internal contextual Ask request failure.");
  }
  response.statusCode = STATUS_BY_ERROR[normalized.code];
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(
    JSON.stringify({
      ok: false,
      error: {
        code: normalized.code,
        message: PUBLIC_MESSAGES[normalized.code],
      },
    }),
  );
}

export function matchContextualAskPath(
  pathname: string,
): ContextualAskRoute | undefined {
  if (pathname === SPOTPATCH_ENDPOINTS.askCapability) {
    return Object.freeze({ kind: "capability" });
  }
  if (pathname === SPOTPATCH_ENDPOINTS.askJobs) {
    return Object.freeze({ kind: "create" });
  }
  const prefix = `${SPOTPATCH_ENDPOINTS.askJobs}/`;
  if (!pathname.startsWith(prefix)) return undefined;
  const segments = pathname.slice(prefix.length).split("/");
  if (segments.length !== 2) return undefined;
  let jobId: string;
  try {
    jobId = decodeURIComponent(segments[0] ?? "");
  } catch {
    return undefined;
  }
  const action = segments[1];
  if (
    !/^[A-Za-z0-9_-]{1,128}$/u.test(jobId) ||
    (action !== "events" && action !== "result" && action !== "cancel")
  ) {
    return undefined;
  }
  return Object.freeze({ kind: "job", action, jobId });
}

function parseAfterSequence(request: IncomingMessage): number {
  let url: URL;
  try {
    url = new URL(request.url ?? "/", "http://spotpatch.invalid");
  } catch {
    throw new ContextualAskError("ASK_PROTOCOL_INCOMPATIBLE");
  }
  if ([...url.searchParams.keys()].some((key) => key !== "afterSequence")) {
    throw new ContextualAskError("ASK_PROTOCOL_INCOMPATIBLE");
  }
  const raw = url.searchParams.get("afterSequence");
  if (raw === null) return 0;
  if (!/^\d+$/u.test(raw)) throw new ContextualAskError("ASK_PROTOCOL_INCOMPATIBLE");
  const parsed = askJobEventsRequestSchema.safeParse({ afterSequence: Number(raw) });
  if (!parsed.success || !Number.isSafeInteger(parsed.data.afterSequence)) {
    throw new ContextualAskError("ASK_PROTOCOL_INCOMPATIBLE");
  }
  return parsed.data.afterSequence ?? 0;
}

function streamEvents(
  request: IncomingMessage,
  response: ServerResponse,
  manager: ContextualAskManager,
  jobId: string,
): void {
  const afterSequence = parseAfterSequence(request);
  response.statusCode = 200;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
  let unsubscribe = (): void => undefined;
  const heartbeat = setInterval(
    () => response.write("\n"),
    CONTEXTUAL_ASK_LIMITS.eventHeartbeatMs,
  );
  heartbeat.unref();
  const cleanup = (): void => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  unsubscribe = manager.subscribe(jobId, (event) => {
    response.write(`${JSON.stringify(event)}\n`);
    if (["answered", "cancelled", "failed"].includes(event.status)) {
      cleanup();
      response.end();
    }
  });
  // subscribe() and events() are synchronous Manager operations. Establishing
  // the listener first closes the replay/live hand-off gap without duplicates.
  const replay = manager.events(jobId, afterSequence);
  for (const event of replay) response.write(`${JSON.stringify(event)}\n`);
  const latest = replay.at(-1);
  const currentStatus = latest?.status ?? manager.snapshot(jobId).status;
  if (["answered", "cancelled", "failed"].includes(currentStatus)) {
    cleanup();
    response.end();
    return;
  }
  request.once("close", cleanup);
  response.once("close", cleanup);
}

function hasEmptySelection(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const envelope = (value as { envelope?: unknown }).envelope;
  if (typeof envelope !== "object" || envelope === null) return false;
  const selection = (envelope as { selection?: unknown }).selection;
  if (typeof selection !== "object" || selection === null) return false;
  return (
    Array.isArray((selection as { targets?: unknown }).targets) &&
    (selection as { targets: unknown[] }).targets.length === 0
  );
}

function lacksProviderDataConsent(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { providerDataConsent?: unknown }).providerDataConsent !== true
  );
}

export async function handleContextualAskRequest(
  request: IncomingMessage,
  response: ServerResponse,
  route: ContextualAskRoute,
  manager: ContextualAskManager | undefined,
  logger?: SpotPatchServerLogger,
): Promise<void> {
  try {
    if (manager === undefined) throw new ContextualAskError("ASK_DISABLED");
    if (route.kind === "capability") {
      if (request.method !== "GET")
        throw new ContextualAskError("ASK_PROTOCOL_INCOMPATIBLE");
      writeJson(
        response,
        200,
        await manager.capability(
          AbortSignal.timeout(CONTEXTUAL_ASK_LIMITS.capabilityTimeoutMs),
        ),
      );
      return;
    }
    if (route.kind === "create") {
      if (request.method !== "POST")
        throw new ContextualAskError("ASK_PROTOCOL_INCOMPATIBLE");
      const raw = await readJsonRequestBody(
        request,
        CONTEXTUAL_ASK_LIMITS.maximumRequestBodyBytes,
      ).catch((error: unknown) => {
        throw new ContextualAskError("ASK_PROTOCOL_INCOMPATIBLE", { cause: error });
      });
      const parsed = askJobCreateRequestSchema.safeParse(raw);
      if (!parsed.success) {
        throw new ContextualAskError(
          hasEmptySelection(raw)
            ? "ASK_SELECTION_REQUIRED"
            : lacksProviderDataConsent(raw)
              ? "ASK_CONSENT_REQUIRED"
              : "ASK_PROTOCOL_INCOMPATIBLE",
        );
      }
      writeJson(response, 202, await manager.create(parsed.data));
      return;
    }
    if (route.action === "events") {
      if (request.method !== "GET")
        throw new ContextualAskError("ASK_PROTOCOL_INCOMPATIBLE");
      streamEvents(request, response, manager, route.jobId);
      return;
    }
    if (route.action === "result") {
      if (request.method !== "GET")
        throw new ContextualAskError("ASK_PROTOCOL_INCOMPATIBLE");
      writeJson(response, 200, await manager.result(route.jobId));
      return;
    }
    if (request.method !== "POST")
      throw new ContextualAskError("ASK_PROTOCOL_INCOMPATIBLE");
    const action = askJobActionRequestSchema.safeParse(
      await readJsonRequestBody(request).catch((error: unknown) => {
        throw new ContextualAskError("ASK_PROTOCOL_INCOMPATIBLE", { cause: error });
      }),
    );
    if (!action.success) throw new ContextualAskError("ASK_PROTOCOL_INCOMPATIBLE");
    writeJson(response, 200, manager.cancel(route.jobId));
  } catch (error: unknown) {
    writeError(response, error, logger);
  }
}
