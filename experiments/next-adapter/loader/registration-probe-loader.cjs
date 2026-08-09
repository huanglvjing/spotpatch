"use strict";

const probeContract = require("./probe-contract.json");
const {
  transformRegisteredProbeSource,
} = require("./registration-probe-transform.cjs");

const INTERNAL_ENDPOINT_PATH = "/__spotpatch-internal/register";
const MAX_CACHE_ENTRIES = 1024;
const MAX_RESPONSE_BYTES = 4096;
const REGISTRATION_TIMEOUT_MS = 3000;
const epochPattern = /^[A-Za-z0-9_-]{16,128}$/u;
// Keep this POC boundary aligned with the shared source-coordinate contract:
// non-empty Base64URL-compatible IDs, capped at the protocol maximum.
const fileIdPattern = /^[A-Za-z0-9_-]{1,128}$/u;
const markerAttributePattern = /^data-[a-z0-9-]+$/u;
const probeIdPattern = new RegExp(probeContract.probeIdPattern, "u");
const registrationCache = new Map();
const warnedReasons = new Set();
const safeFailureReasons = new Set([
  "registration-environment-missing",
  "registration-epoch-mismatch",
  "registration-origin-invalid",
  "registration-request-failed",
  "registration-response-invalid",
  "registration-response-too-large",
  "registration-timeout",
  "registration-transform-failed",
]);

function readRequiredEnvironment(name) {
  const value = process.env[name];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error("registration-environment-missing");
  }

  return value;
}

function getOptions(loaderContext) {
  const options = loaderContext.getOptions();

  if (
    options === null ||
    typeof options !== "object" ||
    typeof options.probeId !== "string" ||
    !probeIdPattern.test(options.probeId) ||
    !Object.values(probeContract.sourceMapModes).includes(options.sourceMapMode) ||
    typeof options.registryEpoch !== "string" ||
    !epochPattern.test(options.registryEpoch) ||
    typeof options.sourceMarkerAttribute !== "string" ||
    !markerAttributePattern.test(options.sourceMarkerAttribute)
  ) {
    throw new TypeError("The registration probe Loader options are invalid.");
  }

  return options;
}

function warnOnce(loaderContext, reason) {
  if (warnedReasons.has(reason)) {
    return;
  }

  warnedReasons.add(reason);
  loaderContext.emitWarning(
    new Error(
      `[spotpatch:next:registration-poc] ${reason}; source markers were skipped.`,
    ),
  );
}

function getSafeFailureReason(error) {
  return error instanceof Error && safeFailureReasons.has(error.message)
    ? error.message
    : "registration-unavailable";
}

function pruneCache() {
  while (registrationCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = registrationCache.keys().next().value;

    if (typeof oldestKey !== "string") {
      return;
    }

    registrationCache.delete(oldestKey);
  }
}

async function readRegistrationResponse(response, expectedEpoch) {
  const declaredLength = Number(response.headers.get("content-length"));

  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("registration-response-too-large");
  }

  const text = await response.text();

  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    throw new Error("registration-response-too-large");
  }

  let body;

  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("registration-response-invalid");
  }

  if (
    !response.ok ||
    body === null ||
    typeof body !== "object" ||
    body.epoch !== expectedEpoch ||
    typeof body.fileId !== "string" ||
    !fileIdPattern.test(body.fileId)
  ) {
    throw new Error("registration-response-invalid");
  }

  return body.fileId;
}

async function requestRegistration(resourcePath, options) {
  const internalOrigin = readRequiredEnvironment("SPOTPATCH_POC_INTERNAL_ORIGIN");
  const internalSecret = readRequiredEnvironment("SPOTPATCH_POC_INTERNAL_SECRET");
  const environmentEpoch = readRequiredEnvironment("SPOTPATCH_POC_REGISTRY_EPOCH");

  if (environmentEpoch !== options.registryEpoch) {
    throw new Error("registration-epoch-mismatch");
  }

  const endpoint = new URL(INTERNAL_ENDPOINT_PATH, internalOrigin);

  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1") {
    throw new Error("registration-origin-invalid");
  }

  let response;

  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SpotPatch-Internal": internalSecret,
      },
      body: JSON.stringify({
        epoch: options.registryEpoch,
        resourcePath,
      }),
      signal: AbortSignal.timeout(REGISTRATION_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError")
        ? "registration-timeout"
        : "registration-request-failed",
    );
  }

  return readRegistrationResponse(response, options.registryEpoch);
}

function register(resourcePath, options) {
  const cacheKey = `${options.registryEpoch}\0${resourcePath}`;
  const cached = registrationCache.get(cacheKey);

  if (cached !== undefined) {
    registrationCache.delete(cacheKey);
    registrationCache.set(cacheKey, cached);
    return cached;
  }

  const pending = requestRegistration(resourcePath, options).catch((error) => {
    registrationCache.delete(cacheKey);
    throw error;
  });
  registrationCache.set(cacheKey, pending);
  pruneCache();
  return pending;
}

module.exports = function registrationProbeLoader(source, inputMap, metadata) {
  this.cacheable(true);
  const callback = this.async();

  if (
    typeof source !== "string" ||
    !source.includes(
      `${probeContract.attributeName}=${JSON.stringify(probeContract.inactiveValue)}`,
    )
  ) {
    callback(null, source, inputMap, metadata);
    return;
  }

  let options;

  try {
    options = getOptions(this);
  } catch {
    warnOnce(this, "invalid-loader-options");
    callback(null, source, inputMap, metadata);
    return;
  }

  void register(this.resourcePath, options)
    .then((fileId) => {
      let result;

      try {
        result = transformRegisteredProbeSource({
          fileId,
          loaderContext: this,
          probeId: options.probeId,
          source,
          sourceMapMode: options.sourceMapMode,
          sourceMarkerAttribute: options.sourceMarkerAttribute,
        });
      } catch {
        throw new Error("registration-transform-failed");
      }

      callback(
        null,
        result === null ? source : result.code,
        result === null ? inputMap : result.map,
        metadata,
      );
    })
    .catch((error) => {
      warnOnce(this, getSafeFailureReason(error));
      callback(null, source, inputMap, metadata);
    });
};
