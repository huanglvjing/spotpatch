import { bootstrapSpotPatch } from "@spotpatch/runtime";
import {
  SPOTPATCH_ENDPOINTS,
  runtimeConfigSchema,
  type SpotPatchRuntimeConfig,
} from "@spotpatch/shared";

const MAX_BOOTSTRAP_RESPONSE_BYTES = 16_384;

export type NextClientBootstrapFailureCode =
  | "CACHE_POLICY_INVALID"
  | "MOUNT_FAILED"
  | "REQUEST_FAILED"
  | "RESPONSE_INVALID"
  | "RESPONSE_REJECTED"
  | "RESPONSE_TOO_LARGE";

export type NextClientBootstrapResult =
  | Readonly<{ ok: true }>
  | Readonly<{
      code: NextClientBootstrapFailureCode;
      ok: false;
    }>;

class BootstrapError extends Error {
  constructor(readonly code: NextClientBootstrapFailureCode) {
    super(code);
    this.name = "SpotPatchNextBootstrapError";
  }
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }

  for (const child of Object.values(value as Readonly<Record<string, unknown>>)) {
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
    await response.body?.cancel();
    throw new BootstrapError("RESPONSE_TOO_LARGE");
  }

  const text = await response.text();

  if (new TextEncoder().encode(text).byteLength > MAX_BOOTSTRAP_RESPONSE_BYTES) {
    throw new BootstrapError("RESPONSE_TOO_LARGE");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BootstrapError("RESPONSE_INVALID");
  }
}

function parseEnvelope(value: unknown): SpotPatchRuntimeConfig {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !("ok" in value) ||
    value.ok !== true ||
    !("data" in value)
  ) {
    throw new BootstrapError("RESPONSE_INVALID");
  }

  const parsed = runtimeConfigSchema.safeParse(value.data);

  if (!parsed.success || parsed.data.framework !== "next") {
    throw new BootstrapError("RESPONSE_INVALID");
  }

  return deepFreeze(parsed.data);
}

async function executeBootstrap(): Promise<void> {
  let response: Response;

  try {
    response = await fetch(SPOTPATCH_ENDPOINTS.bootstrap, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    throw new BootstrapError("REQUEST_FAILED");
  }

  if (!response.ok) {
    await response.body?.cancel();
    throw new BootstrapError("RESPONSE_REJECTED");
  }

  if (!response.headers.get("cache-control")?.toLowerCase().includes("no-store")) {
    await response.body?.cancel();
    throw new BootstrapError("CACHE_POLICY_INVALID");
  }

  const config = parseEnvelope(await readBoundedJson(response));

  try {
    bootstrapSpotPatch(config);
  } catch {
    throw new BootstrapError("MOUNT_FAILED");
  }
}

export async function bootstrapNextClient(): Promise<NextClientBootstrapResult> {
  try {
    await executeBootstrap();
    return Object.freeze({ ok: true });
  } catch (error: unknown) {
    return Object.freeze({
      code: error instanceof BootstrapError ? error.code : "RESPONSE_INVALID",
      ok: false,
    });
  }
}
