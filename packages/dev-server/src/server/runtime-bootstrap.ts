import type { IncomingMessage } from "node:http";

import {
  ERROR_CODES,
  SpotPatchError,
  runtimeBootstrapRequestSchema,
  runtimeConfigSchema,
  type SpotPatchRuntimeConfig,
} from "@spotpatch/shared";

import { readJsonRequestBody } from "./request-body.js";
import { isLoopbackHostname } from "./request-security.js";

export interface RuntimeBootstrapOptions {
  readonly expectedOrigin: string;
  readonly runtimeConfig: SpotPatchRuntimeConfig;
}

export interface ResolvedRuntimeBootstrapOptions {
  readonly expectedOrigin: string;
  readonly runtimeConfig: SpotPatchRuntimeConfig;
}

function getSingleHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export function resolveRuntimeBootstrapOptions(
  options: RuntimeBootstrapOptions,
): ResolvedRuntimeBootstrapOptions {
  let expectedOrigin: URL;

  try {
    expectedOrigin = new URL(options.expectedOrigin);
  } catch {
    throw new TypeError("The SpotPatch bootstrap origin is invalid.");
  }

  if (
    expectedOrigin.origin !== options.expectedOrigin ||
    expectedOrigin.protocol !== "http:" ||
    !isLoopbackHostname(expectedOrigin.hostname)
  ) {
    throw new TypeError("The SpotPatch bootstrap origin must be a loopback origin.");
  }

  const parsedConfig = runtimeConfigSchema.safeParse(options.runtimeConfig);

  if (!parsedConfig.success) {
    throw new TypeError("The SpotPatch Runtime configuration is invalid.");
  }

  return Object.freeze({
    expectedOrigin: expectedOrigin.origin,
    runtimeConfig: parsedConfig.data,
  });
}

function assertRuntimeBootstrapRequest(
  request: IncomingMessage,
  expectedOrigin: string,
): void {
  const contentType = getSingleHeader(request, "content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();

  if (request.method !== "POST" || contentType !== "application/json") {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
  }

  const host = getSingleHeader(request, "host");
  let hostIsLoopback = false;

  if (host !== undefined) {
    try {
      hostIsLoopback = isLoopbackHostname(new URL(`http://${host}`).hostname);
    } catch {
      hostIsLoopback = false;
    }
  }

  if (
    !hostIsLoopback ||
    getSingleHeader(request, "origin") !== expectedOrigin ||
    getSingleHeader(request, "sec-fetch-site") !== "same-origin"
  ) {
    throw new SpotPatchError(ERROR_CODES.ORIGIN_NOT_ALLOWED);
  }
}

export async function readRuntimeBootstrap(
  request: IncomingMessage,
  options: ResolvedRuntimeBootstrapOptions,
): Promise<SpotPatchRuntimeConfig> {
  assertRuntimeBootstrapRequest(request, options.expectedOrigin);
  const parsedBody = runtimeBootstrapRequestSchema.safeParse(
    await readJsonRequestBody(request),
  );

  if (!parsedBody.success) {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
  }

  return options.runtimeConfig;
}
