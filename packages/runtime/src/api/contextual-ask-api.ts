import {
  SPOTPATCH_ENDPOINTS,
  SPOTPATCH_TOKEN_HEADER,
  getAskJobEndpoint,
  isErrorCode,
  type AskJobCreateRequest,
  type AskJobEvent,
  type AskJobResultResponse,
  type AskJobSnapshot,
  type ContextualAskCapability,
  type ErrorCode,
} from "@spotpatch/shared/contextual-ask-browser";

import {
  isAskJobEvent,
  isAskJobResultResponse,
  isAskJobSnapshot,
  isContextualAskCapability,
} from "./contextual-ask-response-validation.js";

const MAX_JSON_RESPONSE_BYTES = 2_000_000;
const MAX_EVENT_LINE_BYTES = 100_000;
const MAX_EVENT_STREAM_BYTES = 4_000_000;

export class ContextualAskApiError extends Error {
  constructor(readonly code?: ErrorCode) {
    super("SpotPatch Contextual Ask request failed.");
    this.name = "ContextualAskApiError";
  }
}

export interface ContextualAskApi {
  readonly capability: () => Promise<ContextualAskCapability>;
  readonly cancelJob: (jobId: string) => Promise<AskJobSnapshot>;
  readonly cancelPending: () => void;
  readonly createJob: (request: AskJobCreateRequest) => Promise<AskJobSnapshot>;
  readonly dispose: () => void;
  readonly events: (
    jobId: string,
    afterSequence: number,
    onEvent: (event: AskJobEvent) => void,
  ) => Promise<void>;
  readonly result: (jobId: string) => Promise<AskJobResultResponse>;
}

interface ContextualAskApiOptions {
  readonly fetch: typeof globalThis.fetch;
  readonly sessionToken: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepFreezeUnknown(value: unknown): void {
  if ((!isRecord(value) && !Array.isArray(value)) || Object.isFrozen(value)) return;
  for (const nested of Object.values(value)) deepFreezeUnknown(nested);
  Object.freeze(value);
}

function deepFreeze<T>(value: T): T {
  deepFreezeUnknown(value);
  return value;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ContextualAskApiError();
  }
}

async function readBoundedText(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await response.body?.cancel();
    throw new ContextualAskApiError();
  }
  if (response.body === null) throw new ContextualAskApiError();
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let output = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return output + decoder.decode();
      bytes += chunk.value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel();
        throw new ContextualAskApiError();
      }
      output += decoder.decode(chunk.value, { stream: true });
    }
  } catch (error: unknown) {
    if (
      error instanceof ContextualAskApiError ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      throw error;
    }
    throw new ContextualAskApiError();
  } finally {
    reader.releaseLock();
  }
}

async function readEnvelope(response: Response): Promise<unknown> {
  const payload = parseJson(await readBoundedText(response, MAX_JSON_RESPONSE_BYTES));
  if (!isRecord(payload)) throw new ContextualAskApiError();
  if (!response.ok) {
    const code =
      payload.ok === false && isRecord(payload.error) && isErrorCode(payload.error.code)
        ? payload.error.code
        : undefined;
    throw new ContextualAskApiError(code);
  }
  if (payload.ok !== true || !("data" in payload)) throw new ContextualAskApiError();
  return payload.data;
}

export function contextualAskApiErrorCode(error: unknown): ErrorCode | undefined {
  return error instanceof ContextualAskApiError ? error.code : undefined;
}

export function createContextualAskApi(
  options: ContextualAskApiOptions,
): ContextualAskApi {
  const pending = new Set<AbortController>();

  function cancelPending(): void {
    for (const controller of pending) controller.abort();
    pending.clear();
  }

  async function request(
    endpoint: string,
    method: "GET" | "POST",
    body?: unknown,
  ): Promise<unknown> {
    const controller = new AbortController();
    pending.add(controller);
    try {
      const response = await options.fetch(endpoint, {
        method,
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          [SPOTPATCH_TOKEN_HEADER]: options.sessionToken,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      return await readEnvelope(response);
    } finally {
      pending.delete(controller);
    }
  }

  async function events(
    jobId: string,
    afterSequence: number,
    onEvent: (event: AskJobEvent) => void,
  ): Promise<void> {
    const controller = new AbortController();
    pending.add(controller);
    try {
      const response = await options.fetch(
        getAskJobEndpoint(jobId, "events", { afterSequence }),
        {
          method: "GET",
          headers: { [SPOTPATCH_TOKEN_HEADER]: options.sessionToken },
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        await readEnvelope(response);
        return;
      }
      if (response.body === null) throw new ContextualAskApiError();
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let buffer = "";
      let totalBytes = 0;
      let previousSequence = afterSequence;
      const consumeLine = (line: string): void => {
        if (line.trim().length === 0) return;
        if (new TextEncoder().encode(line).byteLength > MAX_EVENT_LINE_BYTES) {
          throw new ContextualAskApiError();
        }
        const event = parseJson(line);
        if (
          !isAskJobEvent(event) ||
          event.jobId !== jobId ||
          event.sequence <= previousSequence
        ) {
          throw new ContextualAskApiError();
        }
        previousSequence = event.sequence;
        onEvent(deepFreeze(event));
      };
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) {
            consumeLine(buffer + decoder.decode());
            return;
          }
          totalBytes += chunk.value.byteLength;
          if (totalBytes > MAX_EVENT_STREAM_BYTES) {
            await reader.cancel();
            throw new ContextualAskApiError();
          }
          buffer += decoder.decode(chunk.value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          if (new TextEncoder().encode(buffer).byteLength > MAX_EVENT_LINE_BYTES) {
            await reader.cancel();
            throw new ContextualAskApiError();
          }
          for (const line of lines) consumeLine(line);
        }
      } catch (error: unknown) {
        if (
          error instanceof ContextualAskApiError ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          throw error;
        }
        throw new ContextualAskApiError();
      } finally {
        reader.releaseLock();
      }
    } finally {
      pending.delete(controller);
    }
  }

  return Object.freeze({
    async capability(): Promise<ContextualAskCapability> {
      const data = await request(SPOTPATCH_ENDPOINTS.askCapability, "GET");
      if (!isContextualAskCapability(data)) throw new ContextualAskApiError();
      return deepFreeze(data);
    },
    async cancelJob(jobId: string): Promise<AskJobSnapshot> {
      const data = await request(getAskJobEndpoint(jobId, "cancel"), "POST", {});
      if (!isAskJobSnapshot(data) || data.jobId !== jobId) {
        throw new ContextualAskApiError();
      }
      return deepFreeze(data);
    },
    cancelPending,
    async createJob(requestBody: AskJobCreateRequest): Promise<AskJobSnapshot> {
      const data = await request(SPOTPATCH_ENDPOINTS.askJobs, "POST", requestBody);
      if (
        !isAskJobSnapshot(data) ||
        data.selectionId !== requestBody.envelope.selection.selectionId ||
        data.executor.executorId !== requestBody.executorId
      ) {
        throw new ContextualAskApiError();
      }
      return deepFreeze(data);
    },
    dispose: cancelPending,
    events,
    async result(jobId: string): Promise<AskJobResultResponse> {
      const data = await request(getAskJobEndpoint(jobId, "result"), "GET");
      if (!isAskJobResultResponse(data) || data.snapshot.jobId !== jobId) {
        throw new ContextualAskApiError();
      }
      return deepFreeze(data);
    },
  });
}
