import { bootstrapSpotPatch } from "@spotpatch/runtime";
import { SPOTPATCH_ENDPOINTS, runtimeConfigSchema } from "@spotpatch/shared";

const BOOTSTRAP_ENDPOINT = SPOTPATCH_ENDPOINTS.bootstrap;
const MAX_BOOTSTRAP_RESPONSE_BYTES = 16_384;

export type RuntimePocBootstrapFailureCode =
  | "mount-failed"
  | "request-failed"
  | "response-invalid"
  | "response-rejected"
  | "response-too-large";

export type RuntimePocBootstrapResult =
  | Readonly<{ ok: true }>
  | Readonly<{
      errorCode: RuntimePocBootstrapFailureCode;
      ok: false;
    }>;

class RuntimePocBootstrapError extends Error {
  constructor(readonly code: RuntimePocBootstrapFailureCode) {
    super(code);
    this.name = "RuntimePocBootstrapError";
  }
}

interface ApiEnvelope {
  readonly data?: unknown;
  readonly ok?: unknown;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }

  for (const child of Object.values(value)) {
    deepFreeze(child);
  }

  return Object.freeze(value);
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));

  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_BOOTSTRAP_RESPONSE_BYTES
  ) {
    throw new RuntimePocBootstrapError("response-too-large");
  }

  const text = await response.text();

  if (new TextEncoder().encode(text).byteLength > MAX_BOOTSTRAP_RESPONSE_BYTES) {
    throw new RuntimePocBootstrapError("response-too-large");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RuntimePocBootstrapError("response-invalid");
  }
}

async function executeBootstrap(): Promise<void> {
  let response: Response;

  try {
    response = await fetch(BOOTSTRAP_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    throw new RuntimePocBootstrapError("request-failed");
  }

  if (!response.ok) {
    await response.body?.cancel();
    throw new RuntimePocBootstrapError("response-rejected");
  }

  const envelope = (await readBoundedJson(response)) as ApiEnvelope;
  const parsedConfig = runtimeConfigSchema.safeParse(envelope.data);

  if (envelope.ok !== true || !parsedConfig.success) {
    throw new RuntimePocBootstrapError("response-invalid");
  }

  try {
    bootstrapSpotPatch(deepFreeze(parsedConfig.data));
  } catch {
    throw new RuntimePocBootstrapError("mount-failed");
  }
}

export async function bootstrapRuntimePoc(): Promise<RuntimePocBootstrapResult> {
  try {
    await executeBootstrap();
    return Object.freeze({ ok: true });
  } catch (error: unknown) {
    return Object.freeze({
      errorCode:
        error instanceof RuntimePocBootstrapError ? error.code : "response-invalid",
      ok: false,
    });
  }
}
