import { randomBytes, timingSafeEqual } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import path from "node:path";

import type { RuntimeConfig } from "@spotpatch/runtime";
import {
  createRuntimeAiConfig,
  createRuntimeDataFlowConfig,
  createSession,
  createSourceRegistry,
  createSpotPatchMiddleware,
  isLoopbackHostname,
  readJsonRequestBody,
  resolveOptions,
  type SourceRegistry,
} from "@spotpatch/dev-server";
import {
  SOURCE_MARKER_ATTRIBUTE,
  SPOTPATCH_API_BASE,
  type ApiSuccess,
} from "@spotpatch/shared";

const BOOTSTRAP_PATH = `${SPOTPATCH_API_BASE}/bootstrap`;
const TRANSPORT_PATH = `${SPOTPATCH_API_BASE}/poc-transport`;
const TRANSPORT_CANCEL_PATH = `${SPOTPATCH_API_BASE}/poc-transport-cancel`;
const INTERNAL_REGISTRATION_PATH = "/__spotpatch-internal/register";
const INTERNAL_SECRET_HEADER = "x-spotpatch-internal";
const REGISTRATION_BODY_LIMIT_BYTES = 4_096;
const REGISTRATION_IDENTITY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const ALLOWED_SOURCE_EXTENSIONS = new Set([".jsx", ".tsx"]);
const FORBIDDEN_SOURCE_SEGMENTS = new Set([".next", "node_modules"]);

interface RegistrationRequest {
  readonly epoch: string;
  readonly resourcePath: string;
}

interface RuntimePocSidecarInput {
  readonly bundler: "turbopack" | "webpack";
  readonly internalSecret: string;
  readonly nextVersion: string;
  readonly publicOrigin: string;
  readonly registryEpoch: string;
  readonly routerKind: "app" | "hybrid" | "pages";
  readonly root: string;
}

export interface RuntimePocSidecar {
  readonly internalOrigin: string;
  readonly registrationCount: (absolutePath: string) => number;
  readonly registry: SourceRegistry;
  readonly runtimeConfig: RuntimeConfig;
  readonly transportAbortCount: () => number;
  close(): Promise<void>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

function requestPath(request: IncomingMessage): string {
  try {
    return new URL(request.url ?? "/", "http://spotpatch.invalid").pathname;
  } catch {
    return "";
  }
}

function writeJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

function writeEmptyError(response: ServerResponse, status: number): void {
  writeJson(response, status, { ok: false });
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function hasForbiddenSegment(root: string, candidate: string): boolean {
  return path
    .relative(root, candidate)
    .split(path.sep)
    .some((segment) => FORBIDDEN_SOURCE_SEGMENTS.has(segment));
}

function parseRegistrationRequest(value: unknown): RegistrationRequest | undefined {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    typeof value.epoch !== "string" ||
    typeof value.resourcePath !== "string" ||
    value.resourcePath.length === 0 ||
    value.resourcePath.includes("\0")
  ) {
    return undefined;
  }

  return Object.freeze({
    epoch: value.epoch,
    resourcePath: value.resourcePath,
  });
}

async function resolveAuthorizedSource(
  root: string,
  requestedPath: string,
): Promise<string | undefined> {
  if (!path.isAbsolute(requestedPath)) {
    return undefined;
  }

  const sourceStat = await lstat(requestedPath);

  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    return undefined;
  }

  const resolvedPath = await realpath(requestedPath);

  if (
    !isWithinRoot(root, resolvedPath) ||
    hasForbiddenSegment(root, resolvedPath) ||
    !ALLOWED_SOURCE_EXTENSIONS.has(path.extname(resolvedPath).toLowerCase())
  ) {
    return undefined;
  }

  return resolvedPath;
}

function assertBootstrapRequest(
  request: IncomingMessage,
  publicOrigin: string,
): boolean {
  if (
    request.method !== "POST" ||
    getSingleHeader(request, "content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
      "application/json" ||
    getSingleHeader(request, "origin") !== publicOrigin ||
    getSingleHeader(request, "sec-fetch-site") !== "same-origin"
  ) {
    return false;
  }

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

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

export async function startRuntimePocSidecar(
  input: RuntimePocSidecarInput,
): Promise<RuntimePocSidecar> {
  if (
    !REGISTRATION_IDENTITY_PATTERN.test(input.internalSecret) ||
    !REGISTRATION_IDENTITY_PATTERN.test(input.registryEpoch)
  ) {
    throw new TypeError("The Runtime POC registration credentials are invalid.");
  }

  const root = await realpath(input.root);
  const publicOrigin = new URL(input.publicOrigin).origin;
  const options = resolveOptions({ ai: false, locale: "en-US" });
  const session = createSession();
  const registry = createSourceRegistry();
  const registrationCounts = new Map<string, number>();
  let transportAbortCount = 0;
  const runtimeConfig = Object.freeze({
    apiBase: SPOTPATCH_API_BASE,
    ai: createRuntimeAiConfig(options.ai),
    budget: options.budget,
    dataFlow: createRuntimeDataFlowConfig(options.dataFlow),
    bundler: input.bundler,
    debug: options.debug,
    editor: options.editor,
    externalAgent: Object.freeze({ enabled: false }),
    framework: "next",
    frameworkVersion: input.nextVersion,
    locale: options.locale,
    maxTargets: options.maxTargets,
    redact: options.redact,
    routerKind: input.routerKind,
    sessionId: session.id,
    sessionToken: session.token,
    shortcut: options.shortcut,
    spotPatchVersion: "runtime-poc",
  }) satisfies RuntimeConfig;
  const middleware = createSpotPatchMiddleware({
    options,
    registry,
    root,
    session,
  });
  const server = createServer((request, response) => {
    const pathname = requestPath(request);

    if (pathname === INTERNAL_REGISTRATION_PATH) {
      const handleRegistration = async (): Promise<void> => {
        if (
          request.method !== "POST" ||
          getSingleHeader(request, "origin") !== undefined ||
          !secretsMatch(
            getSingleHeader(request, INTERNAL_SECRET_HEADER),
            input.internalSecret,
          )
        ) {
          writeEmptyError(response, 403);
          return;
        }

        const parsed = parseRegistrationRequest(
          await readJsonRequestBody(request, REGISTRATION_BODY_LIMIT_BYTES),
        );

        if (parsed === undefined) {
          writeEmptyError(response, 400);
          return;
        }

        if (parsed.epoch !== input.registryEpoch) {
          writeEmptyError(response, 400);
          return;
        }

        const sourcePath = await resolveAuthorizedSource(root, parsed.resourcePath);

        if (sourcePath === undefined) {
          writeEmptyError(response, 403);
          return;
        }

        registrationCounts.set(
          sourcePath,
          (registrationCounts.get(sourcePath) ?? 0) + 1,
        );
        writeJson(response, 200, {
          epoch: input.registryEpoch,
          fileId: registry.register(sourcePath),
        });
      };

      void handleRegistration().catch(() => {
        if (!response.headersSent) {
          writeEmptyError(response, 400);
        } else {
          response.destroy();
        }
      });
      return;
    }

    if (pathname === BOOTSTRAP_PATH) {
      const handleBootstrap = async (): Promise<void> => {
        if (!assertBootstrapRequest(request, publicOrigin)) {
          writeEmptyError(response, 403);
          return;
        }

        const body = await readJsonRequestBody(request, REGISTRATION_BODY_LIMIT_BYTES);

        if (!isRecord(body) || Object.keys(body).length !== 0) {
          writeEmptyError(response, 400);
          return;
        }

        writeJson(response, 200, {
          ok: true,
          data: runtimeConfig,
        } satisfies ApiSuccess<RuntimeConfig>);
      };

      void handleBootstrap().catch(() => {
        if (!response.headersSent) {
          writeEmptyError(response, 400);
        } else {
          response.destroy();
        }
      });
      return;
    }

    if (pathname === TRANSPORT_PATH) {
      const handleTransport = async (): Promise<void> => {
        if (
          request.method !== "POST" ||
          getSingleHeader(request, "origin") !== publicOrigin ||
          getSingleHeader(request, "x-spotpatch-poc-transport") !== "1"
        ) {
          writeEmptyError(response, 403);
          return;
        }

        const body = await readJsonRequestBody(request, REGISTRATION_BODY_LIMIT_BYTES);
        response.statusCode = 207;
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
        response.setHeader("X-SpotPatch-Poc-Proxy", "preserved");
        response.flushHeaders();
        response.write(`${JSON.stringify({ sequence: 1, body })}\n`);
        setTimeout(() => {
          if (!response.destroyed) {
            response.end(`${JSON.stringify({ sequence: 2 })}\n`);
          }
        }, 500).unref();
      };

      void handleTransport().catch(() => {
        if (!response.headersSent) {
          writeEmptyError(response, 400);
        } else {
          response.destroy();
        }
      });
      return;
    }

    if (pathname === TRANSPORT_CANCEL_PATH) {
      if (
        request.method !== "POST" ||
        getSingleHeader(request, "origin") !== publicOrigin
      ) {
        writeEmptyError(response, 403);
        return;
      }

      response.statusCode = 200;
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      response.flushHeaders();
      let sequence = 0;
      const interval = setInterval(() => {
        sequence += 1;
        response.write(`${JSON.stringify({ sequence })}\n`);
      }, 20);
      interval.unref();
      let settled = false;
      const cleanup = (): void => {
        if (settled) {
          return;
        }

        settled = true;
        clearInterval(interval);
        transportAbortCount += 1;
      };
      request.once("aborted", cleanup);
      response.once("close", cleanup);
      return;
    }

    middleware(request, response, () => {
      writeEmptyError(response, 404);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();

  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("The Runtime POC Sidecar did not bind a TCP address.");
  }

  return Object.freeze({
    internalOrigin: `http://127.0.0.1:${String(address.port)}`,
    registrationCount(absolutePath: string): number {
      return registrationCounts.get(path.resolve(absolutePath)) ?? 0;
    },
    registry,
    runtimeConfig,
    transportAbortCount: () => transportAbortCount,
    async close(): Promise<void> {
      registry.clear();
      await closeServer(server);
    },
  });
}

export const RUNTIME_POC_SOURCE_MARKER_ATTRIBUTE = SOURCE_MARKER_ATTRIBUTE;

export function createRuntimePocSecret(): string {
  return randomBytes(24).toString("base64url");
}
