import {
  ERROR_CODES,
  SpotPatchError,
  type AgentLimits,
  type AiProviderAuthentication,
} from "@spotpatch/shared";

import {
  readProviderCredential,
  type ProviderCredential,
} from "./provider-credential.js";
import { readSseEvents, type SseEvent } from "./sse-parser.js";

interface PostProviderStreamOptions {
  readonly authentication: AiProviderAuthentication;
  readonly body: Readonly<Record<string, unknown>>;
  readonly credential: ProviderCredential;
  readonly fetch: typeof globalThis.fetch;
  readonly limits: Readonly<AgentLimits>;
  readonly signal: AbortSignal;
  readonly url: string;
}

function createProviderHeaders(
  authentication: AiProviderAuthentication,
  credential: ProviderCredential,
): Headers {
  const headers = new Headers({
    Accept: "text/event-stream",
    "Content-Type": "application/json",
  });
  const value = readProviderCredential(credential);

  if (authentication === "x-api-key") {
    headers.set("x-api-key", value);
  } else {
    headers.set("Authorization", `Bearer ${value}`);
  }

  return headers;
}

function mapStatus(status: number): SpotPatchError {
  if (status === 401 || status === 403) {
    return new SpotPatchError(ERROR_CODES.PROVIDER_AUTH_FAILED);
  }

  if (status === 429) {
    return new SpotPatchError(ERROR_CODES.PROVIDER_RATE_LIMITED);
  }

  return new SpotPatchError(ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED);
}

function linkAbortSignal(source: AbortSignal, target: AbortController): () => void {
  const abort = (): void => {
    target.abort(source.reason);
  };

  if (source.aborted) {
    abort();
  } else {
    source.addEventListener("abort", abort, { once: true });
  }

  return () => {
    source.removeEventListener("abort", abort);
  };
}

function signalIsAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

export async function postProviderStream(
  options: PostProviderStreamOptions,
): Promise<readonly SseEvent[]> {
  if (signalIsAborted(options.signal)) {
    throw new SpotPatchError(ERROR_CODES.AGENT_CANCELLED);
  }

  const requestController = new AbortController();
  const unlink = linkAbortSignal(options.signal, requestController);

  try {
    const connectTimeout = setTimeout(() => {
      requestController.abort("provider-connect-timeout");
    }, options.limits.providerConnectTimeoutMs);
    let response: Response;

    try {
      response = await options.fetch(options.url, {
        method: "POST",
        headers: createProviderHeaders(options.authentication, options.credential),
        body: JSON.stringify(options.body),
        redirect: "error",
        signal: requestController.signal,
      });
    } catch {
      if (signalIsAborted(options.signal)) {
        throw new SpotPatchError(ERROR_CODES.AGENT_CANCELLED);
      }

      throw new SpotPatchError(ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED);
    } finally {
      clearTimeout(connectTimeout);
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw mapStatus(response.status);
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

    if (!contentType.includes("text/event-stream")) {
      await response.body?.cancel().catch(() => undefined);
      throw new SpotPatchError(ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED);
    }

    try {
      return await readSseEvents(response.body, {
        firstByteTimeoutMs: options.limits.providerFirstByteTimeoutMs,
        idleTimeoutMs: options.limits.providerIdleTimeoutMs,
        maxBytes: options.limits.maxProviderResponseBytes,
        signal: requestController.signal,
      });
    } catch (error: unknown) {
      if (signalIsAborted(options.signal)) {
        throw new SpotPatchError(ERROR_CODES.AGENT_CANCELLED);
      }

      if (error instanceof SpotPatchError) {
        throw error;
      }

      throw new SpotPatchError(ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED);
    }
  } finally {
    unlink();
  }
}
