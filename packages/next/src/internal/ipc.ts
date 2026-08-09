import path from "node:path";

import {
  parseSerializedSpotPatchOptions,
  type ResolvedSpotPatchOptions,
  type SerializedSpotPatchOptions,
} from "@spotpatch/dev-server";

import {
  NEXT_IPC_MESSAGE_LIMIT_BYTES,
  NEXT_IPC_PROTOCOL_VERSION,
} from "./constants.js";

const ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const ENVIRONMENT_NAME_PATTERN = /^[A-Z][A-Z0-9_]{1,127}$/u;

export interface NextConfigureMessage {
  readonly appRoot: string;
  readonly credentials: Readonly<Record<string, string>>;
  readonly nonce: string;
  readonly options: SerializedSpotPatchOptions;
  readonly protocolVersion: typeof NEXT_IPC_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly type: "spotpatch:next:configure";
}

export type NextConfigureAck =
  | Readonly<{
      nonce: string;
      ok: true;
      protocolVersion: typeof NEXT_IPC_PROTOCOL_VERSION;
      requestId: string;
      type: "spotpatch:next:configure-ack";
    }>
  | Readonly<{
      code: "CONFIGURATION_CONFLICT" | "CONFIGURATION_FAILED" | "INVALID_IPC";
      nonce: string;
      ok: false;
      protocolVersion: typeof NEXT_IPC_PROTOCOL_VERSION;
      requestId: string;
      type: "spotpatch:next:configure-ack";
    }>;

export interface ParsedNextConfigureMessage extends Omit<
  NextConfigureMessage,
  "options"
> {
  readonly options: ResolvedSpotPatchOptions;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

export function assertIpcMessageSize(value: unknown): void {
  let serialized: string;

  try {
    serialized = JSON.stringify(value);
  } catch (error: unknown) {
    throw new TypeError("The SpotPatch IPC message is not serializable.", {
      cause: error,
    });
  }

  if (Buffer.byteLength(serialized, "utf8") > NEXT_IPC_MESSAGE_LIMIT_BYTES) {
    throw new RangeError("The SpotPatch IPC message exceeds the size limit.");
  }
}

function parseCredentials(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value) || Object.keys(value).length > 32) {
    throw new TypeError("The SpotPatch IPC credentials are invalid.");
  }

  const entries = Object.entries(value);
  const credentials: Record<string, string> = {};

  for (const [name, credential] of entries) {
    if (
      !ENVIRONMENT_NAME_PATTERN.test(name) ||
      typeof credential !== "string" ||
      credential.length === 0 ||
      credential.length > 16_384 ||
      credential.includes("\0")
    ) {
      throw new TypeError("The SpotPatch IPC credentials are invalid.");
    }

    credentials[name] = credential;
  }

  return Object.freeze(credentials);
}

export function parseNextConfigureMessage(value: unknown): ParsedNextConfigureMessage {
  assertIpcMessageSize(value);

  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "appRoot",
      "credentials",
      "nonce",
      "options",
      "protocolVersion",
      "requestId",
      "type",
    ]) ||
    value.type !== "spotpatch:next:configure" ||
    value.protocolVersion !== NEXT_IPC_PROTOCOL_VERSION ||
    typeof value.nonce !== "string" ||
    !ID_PATTERN.test(value.nonce) ||
    typeof value.requestId !== "string" ||
    !ID_PATTERN.test(value.requestId) ||
    typeof value.appRoot !== "string" ||
    !path.isAbsolute(value.appRoot) ||
    value.appRoot.length > 4_096 ||
    value.appRoot.includes("\0")
  ) {
    throw new TypeError("The SpotPatch configure IPC message is invalid.");
  }

  return Object.freeze({
    appRoot: value.appRoot,
    credentials: parseCredentials(value.credentials),
    nonce: value.nonce,
    options: parseSerializedSpotPatchOptions(value.options),
    protocolVersion: NEXT_IPC_PROTOCOL_VERSION,
    requestId: value.requestId,
    type: "spotpatch:next:configure",
  });
}

export function parseNextConfigureAck(value: unknown): NextConfigureAck {
  assertIpcMessageSize(value);

  if (
    !isRecord(value) ||
    value.type !== "spotpatch:next:configure-ack" ||
    value.protocolVersion !== NEXT_IPC_PROTOCOL_VERSION ||
    typeof value.ok !== "boolean" ||
    typeof value.nonce !== "string" ||
    !ID_PATTERN.test(value.nonce) ||
    typeof value.requestId !== "string" ||
    !ID_PATTERN.test(value.requestId)
  ) {
    throw new TypeError("The SpotPatch configure IPC acknowledgement is invalid.");
  }

  if (value.ok) {
    if (!hasExactKeys(value, ["nonce", "ok", "protocolVersion", "requestId", "type"])) {
      throw new TypeError("The SpotPatch configure IPC acknowledgement is invalid.");
    }

    return Object.freeze({
      nonce: value.nonce,
      ok: true,
      protocolVersion: NEXT_IPC_PROTOCOL_VERSION,
      requestId: value.requestId,
      type: "spotpatch:next:configure-ack",
    });
  }

  if (
    !hasExactKeys(value, [
      "code",
      "nonce",
      "ok",
      "protocolVersion",
      "requestId",
      "type",
    ]) ||
    (value.code !== "CONFIGURATION_CONFLICT" &&
      value.code !== "CONFIGURATION_FAILED" &&
      value.code !== "INVALID_IPC")
  ) {
    throw new TypeError("The SpotPatch configure IPC acknowledgement is invalid.");
  }

  return Object.freeze({
    code: value.code,
    nonce: value.nonce,
    ok: false,
    protocolVersion: NEXT_IPC_PROTOCOL_VERSION,
    requestId: value.requestId,
    type: "spotpatch:next:configure-ack",
  });
}
