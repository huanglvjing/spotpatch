import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { isLoopbackHostname, readJsonRequestBody } from "@spotpatch/dev-server";

import { NEXT_IPC_MESSAGE_LIMIT_BYTES } from "./constants.js";
import { assertIpcMessageSize, type NextConfigureAck } from "./ipc.js";

const CONFIGURATION_SECRET_HEADER = "x-spotpatch-configuration";
const CONFIGURATION_SECRET_PATTERN = /^[A-Za-z0-9_-]{32,128}$/u;

export interface ConfigurationServerOptions {
  readonly configurationSecret: string;
  readonly onConfiguration: (value: unknown) => Promise<NextConfigureAck | undefined>;
}

export type ConfigurationRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void;

function getSingleHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function secretsMatch(actual: string | undefined, expected: string): boolean {
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

function hasLoopbackHost(request: IncomingMessage): boolean {
  const host = getSingleHeader(request, "host");

  if (host === undefined) {
    return false;
  }

  try {
    return isLoopbackHostname(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  const body = JSON.stringify(payload);
  response.statusCode = statusCode;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

export function createConfigurationRequestHandler(
  options: ConfigurationServerOptions,
): ConfigurationRequestHandler {
  if (!CONFIGURATION_SECRET_PATTERN.test(options.configurationSecret)) {
    throw new TypeError("The SpotPatch configuration secret is invalid.");
  }

  return (request, response) => {
    const handle = async (): Promise<void> => {
      const contentType = getSingleHeader(request, "content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();

      if (
        request.method !== "POST" ||
        contentType !== "application/json" ||
        !hasLoopbackHost(request) ||
        getSingleHeader(request, "origin") !== undefined ||
        !secretsMatch(
          getSingleHeader(request, CONFIGURATION_SECRET_HEADER),
          options.configurationSecret,
        )
      ) {
        writeJson(response, 403, { ok: false });
        return;
      }

      const value = await readJsonRequestBody(request, NEXT_IPC_MESSAGE_LIMIT_BYTES);
      const acknowledgement = await options.onConfiguration(value);

      if (acknowledgement === undefined) {
        writeJson(response, 400, { ok: false });
        return;
      }

      assertIpcMessageSize(acknowledgement);
      writeJson(response, 200, acknowledgement);
    };

    void handle().catch(() => {
      if (response.headersSent) {
        response.destroy();
        return;
      }

      writeJson(response, 400, { ok: false });
    });
  };
}
