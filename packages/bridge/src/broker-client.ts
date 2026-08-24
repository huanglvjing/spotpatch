import { request as httpRequest } from "node:http";

import {
  ERROR_CODES,
  EXTERNAL_HANDOFF_LIMITS,
  SpotPatchError,
  isErrorCode,
} from "@spotpatch/shared";
import {
  SPOTPATCH_BRIDGE_TOKEN_HEADER,
  type ExternalHandoffDescriptor,
} from "@spotpatch/shared/external-agent-node";

interface RuntimeSchema<T> {
  safeParse(
    value: unknown,
  ): Readonly<{ success: true; data: T }> | Readonly<{ success: false }>;
}

function parseEnvelope<T>(value: unknown, schema: RuntimeSchema<T>): T {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SpotPatchError(ERROR_CODES.BRIDGE_PROTOCOL_MISMATCH);
  }

  const record = value as Readonly<Record<string, unknown>>;

  if (record.ok === true && Object.keys(record).length === 2 && "data" in record) {
    const parsed = schema.safeParse(record.data);
    if (parsed.success) return parsed.data;
    throw new SpotPatchError(ERROR_CODES.BRIDGE_PROTOCOL_MISMATCH);
  }

  if (
    record.ok === false &&
    Object.keys(record).length === 2 &&
    typeof record.error === "object" &&
    record.error !== null &&
    !Array.isArray(record.error)
  ) {
    const error = record.error as Readonly<Record<string, unknown>>;

    if (
      Object.keys(error).length === 2 &&
      isErrorCode(error.code) &&
      typeof error.message === "string"
    ) {
      throw new SpotPatchError(error.code);
    }
  }

  throw new SpotPatchError(ERROR_CODES.BRIDGE_PROTOCOL_MISMATCH);
}

export async function requestBroker<T>(
  descriptor: ExternalHandoffDescriptor,
  requestPath: string,
  body: unknown,
  schema: RuntimeSchema<T>,
  signal?: AbortSignal,
  timeoutMs: number = EXTERNAL_HANDOFF_LIMITS.brokerRequestTimeoutMs,
): Promise<T> {
  const serialized = JSON.stringify(body);

  if (
    Buffer.byteLength(serialized, "utf8") >
    EXTERNAL_HANDOFF_LIMITS.maximumBrokerRequestBytes
  ) {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
  }

  const endpoint = new URL(descriptor.endpoint);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      callback();
    };
    const request = httpRequest(
      {
        agent: false,
        hostname: "127.0.0.1",
        port: Number(endpoint.port),
        path: requestPath,
        method: "POST",
        headers: {
          Host: endpoint.host,
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(serialized, "utf8")),
          [SPOTPATCH_BRIDGE_TOKEN_HEADER]: descriptor.bridgeToken,
        },
      },
      (response) => {
        const contentType = response.headers["content-type"];
        const maximumResponseBytes =
          EXTERNAL_HANDOFF_LIMITS.maximumSnapshotBytes +
          EXTERNAL_HANDOFF_LIMITS.maximumBrokerRequestBytes;
        const declaredLength = Number(response.headers["content-length"]);

        if (
          typeof contentType !== "string" ||
          contentType.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
        ) {
          response.resume();
          finish(() => {
            reject(new SpotPatchError(ERROR_CODES.BRIDGE_PROTOCOL_MISMATCH));
          });
          return;
        }

        if (Number.isFinite(declaredLength) && declaredLength > maximumResponseBytes) {
          response.destroy();
          finish(() => {
            reject(new SpotPatchError(ERROR_CODES.HANDOFF_RESPONSE_TOO_LARGE));
          });
          return;
        }

        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.byteLength;

          if (bytes > maximumResponseBytes) {
            request.destroy(new SpotPatchError(ERROR_CODES.HANDOFF_RESPONSE_TOO_LARGE));
            return;
          }

          chunks.push(Buffer.from(chunk));
        });
        response.once("end", () => {
          if (settled) return;

          try {
            const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
            const parsed = parseEnvelope(value, schema);
            finish(() => {
              resolve(parsed);
            });
          } catch (error: unknown) {
            finish(() => {
              reject(
                error instanceof SpotPatchError
                  ? error
                  : new SpotPatchError(ERROR_CODES.BRIDGE_PROTOCOL_MISMATCH),
              );
            });
          }
        });
      },
    );
    const abort = (): void => {
      request.destroy(new SpotPatchError(ERROR_CODES.SESSION_CLOSED));
    };
    const timeout = setTimeout(() => {
      request.destroy(new SpotPatchError(ERROR_CODES.SESSION_CLOSED));
    }, timeoutMs);
    timeout.unref();
    request.once("error", (error: Error) => {
      finish(() => {
        reject(
          error instanceof SpotPatchError
            ? error
            : new SpotPatchError(ERROR_CODES.SESSION_CLOSED),
        );
      });
    });

    if (signal?.aborted === true) {
      abort();
      return;
    }

    signal?.addEventListener("abort", abort, { once: true });
    request.end(serialized);
  });
}
