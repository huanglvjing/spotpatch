import {
  SPOTPATCH_ENDPOINTS,
  SPOTPATCH_TOKEN_HEADER,
  type ApiResponse,
  type CodeContext,
  type OpenEditorRequest,
  type SPOTPATCH_API_BASE,
  type SourceContextRequest,
} from "@spotpatch/shared";

export interface RuntimeApi {
  readonly cancelPending: () => void;
  readonly dispose: () => void;
  readonly openEditor: (request: OpenEditorRequest) => Promise<void>;
  readonly sourceContext: (request: SourceContextRequest) => Promise<CodeContext>;
}

export interface RuntimeApiOptions {
  readonly apiBase: typeof SPOTPATCH_API_BASE;
  readonly fetch: typeof globalThis.fetch;
  readonly sessionToken: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function readSuccessData(value: unknown): unknown {
  if (!isRecord(value) || value.ok !== true || !("data" in value)) {
    throw new Error("SpotPatch local API request failed.");
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

export function createRuntimeApi(options: RuntimeApiOptions): RuntimeApi {
  const pendingRequests = new Set<AbortController>();

  function cancelPending(): void {
    for (const request of pendingRequests) {
      request.abort();
    }

    pendingRequests.clear();
  }

  async function post(endpoint: string, body: unknown): Promise<unknown> {
    const abortController = new AbortController();
    pendingRequests.add(abortController);

    try {
      const response = await options.fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [SPOTPATCH_TOKEN_HEADER]: options.sessionToken,
        },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });
      const payload = (await response.json()) as ApiResponse<unknown>;

      if (!response.ok) {
        throw new Error("SpotPatch local API request failed.");
      }

      return readSuccessData(payload);
    } finally {
      pendingRequests.delete(abortController);
    }
  }

  return Object.freeze({
    cancelPending,
    async sourceContext(request: SourceContextRequest): Promise<CodeContext> {
      const data = await post(SPOTPATCH_ENDPOINTS.sourceContext, request);

      if (!isCodeContext(data)) {
        throw new Error("SpotPatch source response is invalid.");
      }

      return Object.freeze({ ...data });
    },

    async openEditor(request: OpenEditorRequest): Promise<void> {
      await post(SPOTPATCH_ENDPOINTS.openEditor, request);
    },

    dispose(): void {
      cancelPending();
    },
  });
}
