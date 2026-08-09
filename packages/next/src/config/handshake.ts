import { randomBytes } from "node:crypto";

import {
  serializeResolvedSpotPatchOptions,
  type ResolvedSpotPatchOptions,
} from "@spotpatch/dev-server";

import {
  NEXT_ENVIRONMENT_KEYS,
  NEXT_INTERNAL_CONFIGURATION_PATH,
  NEXT_IPC_PROTOCOL_VERSION,
  NEXT_IPC_TIMEOUT_MS,
} from "../internal/constants.js";
import {
  assertIpcMessageSize,
  parseNextConfigureAck,
  type NextConfigureMessage,
} from "../internal/ipc.js";

const ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const CONFIGURATION_SECRET_PATTERN = /^[A-Za-z0-9_-]{32,128}$/u;
const ACKNOWLEDGEMENT_LIMIT_BYTES = 4_096;

export interface NextRuntimeCarrier {
  readonly registryEpoch: string;
  readonly sidecarOrigin: string;
}

interface ConfigureInput {
  readonly appRoot: string;
  readonly credentials: Readonly<Record<string, string>>;
  readonly options: ResolvedSpotPatchOptions;
}

let activeSignature: string | undefined;
let activeConfiguration: Promise<NextRuntimeCarrier> | undefined;

function readRequiredEnvironment(name: string): string {
  const value = process.env[name];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      "SpotPatch Next development must be started with `spotpatch-next dev`.",
    );
  }

  return value;
}

function readLoopbackOrigin(name: string): string {
  const value = readRequiredEnvironment(name);
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error("SpotPatch received an invalid CLI transport origin.");
  }

  if (
    url.origin !== value ||
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1"
  ) {
    throw new Error("SpotPatch received an invalid CLI transport origin.");
  }

  return url.origin;
}

function configurationSignature(input: ConfigureInput): string {
  return JSON.stringify({
    appRoot: input.appRoot,
    credentials: input.credentials,
    options: serializeResolvedSpotPatchOptions(input.options),
  });
}

async function sendConfiguration(input: ConfigureInput): Promise<NextRuntimeCarrier> {
  const nonce = readRequiredEnvironment(NEXT_ENVIRONMENT_KEYS.launchNonce);
  const expectedAppRoot = readRequiredEnvironment(NEXT_ENVIRONMENT_KEYS.appRoot);
  const registryEpoch = readRequiredEnvironment(NEXT_ENVIRONMENT_KEYS.registryEpoch);
  const sidecarOrigin = readLoopbackOrigin(NEXT_ENVIRONMENT_KEYS.sidecarOrigin);
  const internalOrigin = readLoopbackOrigin(NEXT_ENVIRONMENT_KEYS.internalOrigin);
  readRequiredEnvironment(NEXT_ENVIRONMENT_KEYS.internalSecret);
  const configurationSecret = readRequiredEnvironment(
    NEXT_ENVIRONMENT_KEYS.configurationSecret,
  );
  const bundler = readRequiredEnvironment(NEXT_ENVIRONMENT_KEYS.bundler);

  if (
    input.appRoot !== expectedAppRoot ||
    internalOrigin !== sidecarOrigin ||
    (bundler !== "turbopack" && bundler !== "webpack") ||
    !CONFIGURATION_SECRET_PATTERN.test(configurationSecret) ||
    !ID_PATTERN.test(nonce) ||
    !ID_PATTERN.test(registryEpoch)
  ) {
    throw new Error("SpotPatch received an invalid CLI launch identity.");
  }

  const requestId = randomBytes(18).toString("base64url");
  const message = Object.freeze({
    appRoot: input.appRoot,
    credentials: input.credentials,
    nonce,
    options: serializeResolvedSpotPatchOptions(input.options),
    protocolVersion: NEXT_IPC_PROTOCOL_VERSION,
    requestId,
    type: "spotpatch:next:configure",
  }) satisfies NextConfigureMessage;
  assertIpcMessageSize(message);
  let response: Response;

  try {
    response = await fetch(new URL(NEXT_INTERNAL_CONFIGURATION_PATH, internalOrigin), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SpotPatch-Configuration": configurationSecret,
      },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(NEXT_IPC_TIMEOUT_MS),
    });
  } catch {
    throw new Error("SpotPatch Next configuration transport failed.");
  }

  const declaredLength = Number(response.headers.get("content-length"));

  if (Number.isFinite(declaredLength) && declaredLength > ACKNOWLEDGEMENT_LIMIT_BYTES) {
    await response.body?.cancel();
    throw new Error("SpotPatch Next configuration response is invalid.");
  }

  const text = await response.text();

  if (Buffer.byteLength(text, "utf8") > ACKNOWLEDGEMENT_LIMIT_BYTES) {
    throw new Error("SpotPatch Next configuration response is invalid.");
  }

  let acknowledgementValue: unknown;

  try {
    acknowledgementValue = JSON.parse(text) as unknown;
  } catch {
    throw new Error("SpotPatch Next configuration response is invalid.");
  }

  const acknowledgement = parseNextConfigureAck(acknowledgementValue);

  if (
    !response.ok ||
    acknowledgement.nonce !== nonce ||
    acknowledgement.requestId !== requestId
  ) {
    throw new Error("SpotPatch Next configuration response is invalid.");
  }

  if (!acknowledgement.ok) {
    throw new Error(`SpotPatch Next configuration failed (${acknowledgement.code}).`);
  }

  return Object.freeze({ registryEpoch, sidecarOrigin });
}

export function configureNextRuntime(
  input: ConfigureInput,
): Promise<NextRuntimeCarrier> {
  const signature = configurationSignature(input);

  if (activeConfiguration !== undefined) {
    if (activeSignature !== signature) {
      return Promise.reject(
        new Error("SpotPatch Next received inconsistent repeated configuration."),
      );
    }

    return activeConfiguration;
  }

  activeSignature = signature;
  activeConfiguration = sendConfiguration(input).catch((error: unknown) => {
    activeConfiguration = undefined;
    activeSignature = undefined;
    throw error;
  });
  return activeConfiguration;
}
