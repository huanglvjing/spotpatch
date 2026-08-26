import type { DataFlowObservationPolicy } from "@spotpatch/runtime/data-flow";

function hasNextInternalHeader(headers: HeadersInit | undefined): boolean {
  if (headers === undefined) return false;
  const normalized = new Headers(headers);
  return normalized.has("RSC") || normalized.has("Next-Router-Prefetch");
}

function isNextInternalFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  baseUrl: string,
): boolean {
  const requestHeaders =
    typeof Request !== "undefined" && input instanceof Request
      ? input.headers
      : undefined;
  if (hasNextInternalHeader(init?.headers) || hasNextInternalHeader(requestHeaders)) {
    return true;
  }
  const rawUrl =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  try {
    const url = new URL(rawUrl, baseUrl);
    return url.origin === new URL(baseUrl).origin && url.searchParams.has("_rsc");
  } catch {
    return false;
  }
}

export function createNextDataFlowObservationPolicy(): DataFlowObservationPolicy {
  const policy: DataFlowObservationPolicy = {
    shouldObserveFetch: (input, init, baseUrl) =>
      !isNextInternalFetch(input, init, baseUrl),
  };

  return Object.freeze(policy);
}
