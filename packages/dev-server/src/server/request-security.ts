import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";

import { ERROR_CODES, SPOTPATCH_TOKEN_HEADER, SpotPatchError } from "@spotpatch/shared";

function getSingleHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function tokensMatch(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) {
    return false;
  }

  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);

  return (
    actualBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    return true;
  }

  if (normalized === "::1") {
    return true;
  }

  if (isIP(normalized) === 4) {
    return normalized.split(".")[0] === "127";
  }

  return normalized.startsWith("::ffff:127.");
}

function parseHost(value: string): URL | undefined {
  try {
    return new URL(`http://${value}`);
  } catch {
    return undefined;
  }
}

function parseOrigin(value: string): URL | undefined {
  try {
    const origin = new URL(value);

    if (
      (origin.protocol !== "http:" && origin.protocol !== "https:") ||
      origin.username.length > 0 ||
      origin.password.length > 0 ||
      origin.origin === "null"
    ) {
      return undefined;
    }

    return origin;
  } catch {
    return undefined;
  }
}

function isSameOriginBrowserGet(request: IncomingMessage): boolean {
  return (
    request.method === "GET" &&
    getSingleHeader(request, "sec-fetch-site")?.toLowerCase() === "same-origin" &&
    getSingleHeader(request, "sec-fetch-mode")?.toLowerCase() === "cors" &&
    getSingleHeader(request, "sec-fetch-dest")?.toLowerCase() === "empty"
  );
}

export interface RequestSecurityOptions {
  readonly allowLan: boolean;
  readonly sessionToken: string;
}

export function assertRequestAuthorized(
  request: IncomingMessage,
  options: RequestSecurityOptions,
): void {
  const actualToken = getSingleHeader(request, SPOTPATCH_TOKEN_HEADER);

  if (!tokensMatch(actualToken, options.sessionToken)) {
    throw new SpotPatchError(ERROR_CODES.INVALID_TOKEN);
  }

  const hostHeader = getSingleHeader(request, "host");
  const originHeader = getSingleHeader(request, "origin");
  const host = hostHeader === undefined ? undefined : parseHost(hostHeader);
  const origin = originHeader === undefined ? undefined : parseOrigin(originHeader);

  if (host === undefined) {
    throw new SpotPatchError(ERROR_CODES.ORIGIN_NOT_ALLOWED);
  }

  const hostIsLoopback = isLoopbackHostname(host.hostname);

  // Browsers omit Origin on same-origin GET fetches. Fetch Metadata is browser-
  // controlled and lets those reads pass without weakening token validation or
  // accepting cross-site requests. Non-browser clients can continue to send Origin.
  if (origin === undefined) {
    if (!isSameOriginBrowserGet(request) || (!options.allowLan && !hostIsLoopback)) {
      throw new SpotPatchError(ERROR_CODES.ORIGIN_NOT_ALLOWED);
    }
    return;
  }

  const originIsLoopback = isLoopbackHostname(origin.hostname);

  if (!options.allowLan) {
    if (!hostIsLoopback || !originIsLoopback) {
      throw new SpotPatchError(ERROR_CODES.ORIGIN_NOT_ALLOWED);
    }

    return;
  }

  if (!originIsLoopback && origin.host.toLowerCase() !== host.host.toLowerCase()) {
    throw new SpotPatchError(ERROR_CODES.ORIGIN_NOT_ALLOWED);
  }
}
