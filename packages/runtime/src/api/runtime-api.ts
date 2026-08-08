import {
  SPOTPATCH_ENDPOINTS,
  SPOTPATCH_EDITOR_PREFERENCES,
  SPOTPATCH_TOKEN_HEADER,
  getAgentJobEndpoint,
  type AgentCapabilityRequest,
  type AgentCapabilitySnapshot,
  type AgentJobCreateRequest,
  type AgentJobEvent,
  type AgentJobResultResponse,
  type AgentJobSnapshot,
  type ApiResponse,
  type CodeContext,
  type EditorOpenResult,
  type ErrorCode,
  type OpenEditorRequest,
  type SPOTPATCH_API_BASE,
  type SourceContextRequest,
} from "@spotpatch/shared";

import {
  isAgentCapabilitySnapshot,
  isAgentErrorCode,
  isAgentJobEvent,
  isAgentJobResultResponse,
  isAgentJobSnapshot,
} from "./agent-response-validation.js";

const MAX_JSON_RESPONSE_BYTES = 2_000_000;
const MAX_EVENT_LINE_BYTES = 100_000;
const MAX_EVENT_STREAM_BYTES = 4_000_000;

export class RuntimeApiError extends Error {
  readonly code: ErrorCode | undefined;

  constructor(code?: ErrorCode) {
    super("SpotPatch local API request failed.");
    this.name = "RuntimeApiError";
    this.code = code;
  }
}

export interface RuntimeApi {
  readonly agentCapability: (
    request: AgentCapabilityRequest,
  ) => Promise<AgentCapabilitySnapshot>;
  readonly agentEvents: (
    jobId: string,
    onEvent: (event: AgentJobEvent) => void,
  ) => Promise<void>;
  readonly agentResult: (jobId: string) => Promise<AgentJobResultResponse>;
  readonly applyAgentJob: (jobId: string) => Promise<AgentJobSnapshot>;
  readonly cancelAgentJob: (jobId: string) => Promise<AgentJobSnapshot>;
  readonly cancelPending: () => void;
  readonly createAgentJob: (
    request: AgentJobCreateRequest,
  ) => Promise<AgentJobSnapshot>;
  readonly dispose: () => void;
  readonly openEditor: (request: OpenEditorRequest) => Promise<EditorOpenResult>;
  readonly revertAgentJob: (jobId: string) => Promise<AgentJobSnapshot>;
  readonly sourceContext: (request: SourceContextRequest) => Promise<CodeContext>;
}

export interface RuntimeApiOptions {
  readonly apiBase: typeof SPOTPATCH_API_BASE;
  readonly fetch: typeof globalThis.fetch;
  readonly sessionToken: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFailureCode(value: unknown): ErrorCode | undefined {
  if (!isRecord(value) || value.ok !== false || !isRecord(value.error)) {
    return undefined;
  }

  return isAgentErrorCode(value.error.code) ? value.error.code : undefined;
}

function readSuccessData(value: unknown): unknown {
  if (!isRecord(value) || value.ok !== true || !("data" in value)) {
    throw new RuntimeApiError();
  }

  return value.data;
}

function isCodeContext(value: unknown): value is CodeContext {
  return (
    isRecord(value) &&
    typeof value.relativePath === "string" &&
    (value.language === "tsx" || value.language === "jsx") &&
    typeof value.startLine === "number" &&
    typeof value.endLine === "number" &&
    typeof value.excerpt === "string" &&
    (value.boundary === "component" || value.boundary === "nearby-lines")
  );
}

function isEditorOpenResult(value: unknown): value is EditorOpenResult {
  return (
    isRecord(value) &&
    typeof value.editor === "string" &&
    (SPOTPATCH_EDITOR_PREFERENCES as readonly string[]).includes(value.editor)
  );
}

function deepFreezeUnknown(value: unknown): void {
  if (!isRecord(value) && !Array.isArray(value)) {
    return;
  }

  if (Object.isFrozen(value)) {
    return;
  }

  for (const nested of Object.values(value)) {
    deepFreezeUnknown(nested);
  }

  Object.freeze(value);
}

function deepFreeze<T>(value: T): T {
  deepFreezeUnknown(value);
  return value;
}

async function readBoundedText(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));

  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new RuntimeApiError();
  }

  if (response.body === null) {
    throw new RuntimeApiError();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let output = "";

  try {
    for (;;) {
      const chunk = await reader.read();

      if (chunk.done) {
        output += decoder.decode();
        return output;
      }

      totalBytes += chunk.value.byteLength;

      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new RuntimeApiError();
      }

      output += decoder.decode(chunk.value, { stream: true });
    }
  } catch (error: unknown) {
    if (error instanceof RuntimeApiError) {
      throw error;
    }

    throw new RuntimeApiError();
  } finally {
    reader.releaseLock();
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RuntimeApiError();
  }
}

async function readJsonEnvelope(response: Response): Promise<unknown> {
  const payload = parseJson(
    await readBoundedText(response, MAX_JSON_RESPONSE_BYTES),
  ) as ApiResponse<unknown>;

  if (!response.ok) {
    throw new RuntimeApiError(readFailureCode(payload));
  }

  return readSuccessData(payload);
}

function parseCapability(
  value: unknown,
  expected: AgentCapabilityRequest,
): AgentCapabilitySnapshot {
  if (
    !isAgentCapabilitySnapshot(value) ||
    value.providerProfileId !== expected.providerProfileId ||
    value.modelProfileId !== expected.modelProfileId
  ) {
    throw new RuntimeApiError();
  }

  return deepFreeze(value);
}

function parseJobSnapshot(
  value: unknown,
  expected?: Readonly<{
    jobId?: string;
    modelProfileId?: string;
    providerProfileId?: string;
  }>,
): AgentJobSnapshot {
  if (
    !isAgentJobSnapshot(value) ||
    (expected?.jobId !== undefined && value.jobId !== expected.jobId) ||
    (expected?.providerProfileId !== undefined &&
      value.providerProfileId !== expected.providerProfileId) ||
    (expected?.modelProfileId !== undefined &&
      value.modelProfileId !== expected.modelProfileId)
  ) {
    throw new RuntimeApiError();
  }

  return deepFreeze(value);
}

function parseJobResult(value: unknown, expectedJobId: string): AgentJobResultResponse {
  if (!isAgentJobResultResponse(value) || value.snapshot.jobId !== expectedJobId) {
    throw new RuntimeApiError();
  }

  return deepFreeze(value);
}

function parseAgentEvent(value: unknown): AgentJobEvent {
  if (!isAgentJobEvent(value)) {
    throw new RuntimeApiError();
  }

  return deepFreeze(value);
}

function omitBrowserCodeContext(request: AgentJobCreateRequest): AgentJobCreateRequest {
  return {
    ...request,
    annotation: {
      ...request.annotation,
      targets: request.annotation.targets.map((target) => ({
        instruction: target.instruction,
        source: target.source,
        react: target.react,
        element: target.element,
        styles: target.styles,
        warnings: target.warnings,
      })),
    },
  };
}

export function runtimeApiErrorCode(error: unknown): ErrorCode | undefined {
  return error instanceof RuntimeApiError ? error.code : undefined;
}

export function createRuntimeApi(options: RuntimeApiOptions): RuntimeApi {
  const pendingRequests = new Set<AbortController>();

  function cancelPending(): void {
    for (const request of pendingRequests) {
      request.abort();
    }

    pendingRequests.clear();
  }

  async function requestJson(
    endpoint: string,
    method: "GET" | "POST",
    body?: unknown,
  ): Promise<unknown> {
    const abortController = new AbortController();
    pendingRequests.add(abortController);

    try {
      const response = await options.fetch(endpoint, {
        method,
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          [SPOTPATCH_TOKEN_HEADER]: options.sessionToken,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: abortController.signal,
      });
      return await readJsonEnvelope(response);
    } finally {
      pendingRequests.delete(abortController);
    }
  }

  async function agentEvents(
    jobId: string,
    onEvent: (event: AgentJobEvent) => void,
  ): Promise<void> {
    const abortController = new AbortController();
    pendingRequests.add(abortController);

    try {
      const response = await options.fetch(getAgentJobEndpoint(jobId, "events"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [SPOTPATCH_TOKEN_HEADER]: options.sessionToken,
        },
        body: JSON.stringify({}),
        signal: abortController.signal,
      });

      if (!response.ok) {
        await readJsonEnvelope(response);
        return;
      }

      if (response.body === null) {
        throw new RuntimeApiError();
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let buffer = "";
      let totalBytes = 0;
      let previousSequence = 0;

      const consumeLine = (line: string): void => {
        if (line.trim().length === 0) {
          return;
        }

        if (new TextEncoder().encode(line).byteLength > MAX_EVENT_LINE_BYTES) {
          throw new RuntimeApiError();
        }

        const event = parseAgentEvent(parseJson(line));

        if (event.jobId !== jobId || event.sequence <= previousSequence) {
          throw new RuntimeApiError();
        }

        previousSequence = event.sequence;
        onEvent(event);
      };

      try {
        for (;;) {
          const chunk = await reader.read();

          if (chunk.done) {
            buffer += decoder.decode();
            consumeLine(buffer);
            return;
          }

          totalBytes += chunk.value.byteLength;

          if (totalBytes > MAX_EVENT_STREAM_BYTES) {
            await reader.cancel();
            throw new RuntimeApiError();
          }

          buffer += decoder.decode(chunk.value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          if (new TextEncoder().encode(buffer).byteLength > MAX_EVENT_LINE_BYTES) {
            await reader.cancel();
            throw new RuntimeApiError();
          }

          for (const line of lines) {
            consumeLine(line);
          }
        }
      } catch (error: unknown) {
        if (
          error instanceof RuntimeApiError ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          throw error;
        }

        throw new RuntimeApiError();
      } finally {
        reader.releaseLock();
      }
    } finally {
      pendingRequests.delete(abortController);
    }
  }

  const emptyAction = Object.freeze({});

  return Object.freeze({
    cancelPending,

    async sourceContext(request: SourceContextRequest): Promise<CodeContext> {
      const data = await requestJson(
        SPOTPATCH_ENDPOINTS.sourceContext,
        "POST",
        request,
      );

      if (!isCodeContext(data)) {
        throw new RuntimeApiError();
      }

      return Object.freeze({ ...data });
    },

    async openEditor(request: OpenEditorRequest): Promise<EditorOpenResult> {
      const data = await requestJson(SPOTPATCH_ENDPOINTS.openEditor, "POST", request);

      if (!isEditorOpenResult(data)) {
        throw new RuntimeApiError();
      }

      return Object.freeze({ editor: data.editor });
    },

    async agentCapability(
      request: AgentCapabilityRequest,
    ): Promise<AgentCapabilitySnapshot> {
      return parseCapability(
        await requestJson(SPOTPATCH_ENDPOINTS.agentCapability, "POST", request),
        request,
      );
    },

    async createAgentJob(request: AgentJobCreateRequest): Promise<AgentJobSnapshot> {
      const serverRequest = omitBrowserCodeContext(request);
      return parseJobSnapshot(
        await requestJson(SPOTPATCH_ENDPOINTS.agentJobs, "POST", serverRequest),
        request,
      );
    },

    agentEvents,

    async agentResult(jobId: string): Promise<AgentJobResultResponse> {
      return parseJobResult(
        await requestJson(getAgentJobEndpoint(jobId, "result"), "POST", emptyAction),
        jobId,
      );
    },

    async cancelAgentJob(jobId: string): Promise<AgentJobSnapshot> {
      return parseJobSnapshot(
        await requestJson(getAgentJobEndpoint(jobId, "cancel"), "POST", emptyAction),
        { jobId },
      );
    },

    async applyAgentJob(jobId: string): Promise<AgentJobSnapshot> {
      return parseJobSnapshot(
        await requestJson(getAgentJobEndpoint(jobId, "apply"), "POST", emptyAction),
        { jobId },
      );
    },

    async revertAgentJob(jobId: string): Promise<AgentJobSnapshot> {
      return parseJobSnapshot(
        await requestJson(getAgentJobEndpoint(jobId, "revert"), "POST", emptyAction),
        { jobId },
      );
    },

    dispose(): void {
      cancelPending();
    },
  });
}
