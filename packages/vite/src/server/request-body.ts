import type { IncomingMessage } from "node:http";

import { ERROR_CODES, SpotPatchError } from "@spotpatch/shared";

import { MAX_REQUEST_BODY_BYTES } from "./constants.js";

function isJsonContentType(value: string | undefined): boolean {
  return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

export async function readJsonRequestBody(request: IncomingMessage): Promise<unknown> {
  if (!isJsonContentType(request.headers["content-type"])) {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
  }

  const declaredLength = Number(request.headers["content-length"]);

  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
  }

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  let exceededLimit = false;

  for await (const rawChunk of request) {
    const chunk: unknown = rawChunk;

    if (typeof chunk !== "string" && !(chunk instanceof Uint8Array)) {
      throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
    }

    const buffer = Buffer.from(chunk);
    byteLength += buffer.byteLength;

    if (byteLength > MAX_REQUEST_BODY_BYTES) {
      exceededLimit = true;
      continue;
    }

    chunks.push(buffer);
  }

  if (exceededLimit || byteLength === 0) {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error: unknown) {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST, undefined, {
      cause: error,
    });
  }
}
