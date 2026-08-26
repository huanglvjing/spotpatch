import { timingSafeEqual } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import {
  createDataFlowSourceFilter,
  createDataFlowSourceVersion,
  createSourceFilter,
} from "@spotpatch/compiler";
import { DEFAULT_DATA_FLOW_LIMITS } from "@spotpatch/shared";
import { z } from "zod";

import type { ResolvedSpotPatchOptions } from "../options.js";
import type { SourceRegistry } from "../registry/source-registry.js";
import { readJsonRequestBody } from "./request-body.js";
import { isLoopbackHostname } from "./request-security.js";

const REGISTRATION_BODY_LIMIT_BYTES = DEFAULT_DATA_FLOW_LIMITS.protocolRequestMaxBytes;
const REGISTRATION_IDENTITY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const DATA_FLOW_IDENTITY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const INTERNAL_SECRET_HEADER = "x-spotpatch-internal";
const FORBIDDEN_SOURCE_SEGMENTS = new Set([".next", "node_modules"]);
const registrationRequestSchema = z.strictObject({
  epoch: z.string().regex(REGISTRATION_IDENTITY_PATTERN),
  resourcePath: z.string().min(1).max(3_072),
  dataFlow: z
    .strictObject({
      sourceVersion: z.string().regex(DATA_FLOW_IDENTITY_PATTERN),
      components: z
        .array(
          z.strictObject({
            componentSourceId: z.string().regex(DATA_FLOW_IDENTITY_PATTERN),
            line: z.number().int().positive().max(10_000_000),
            column: z.number().int().positive().max(10_000_000),
          }),
        )
        .max(DEFAULT_DATA_FLOW_LIMITS.sourceMaxComponents),
    })
    .optional(),
});

export interface SourceRegistrationServiceOptions {
  readonly internalSecret: string;
  readonly options: ResolvedSpotPatchOptions;
  readonly registry: SourceRegistry;
  readonly registryEpoch: string;
  readonly root: string;
}

export type SourceRegistrationHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void;

export interface SourceRegistrationService {
  readonly handler: SourceRegistrationHandler;
  readonly root: string;
}

function getSingleHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function identitiesMatch(actual: string | undefined, expected: string): boolean {
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

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function hasForbiddenSegment(root: string, candidate: string): boolean {
  return path
    .relative(root, candidate)
    .split(path.sep)
    .some((segment) => FORBIDDEN_SOURCE_SEGMENTS.has(segment));
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

function requestComesFromLoopbackWorker(request: IncomingMessage): boolean {
  const host = getSingleHeader(request, "host");

  if (host === undefined || getSingleHeader(request, "origin") !== undefined) {
    return false;
  }

  try {
    return isLoopbackHostname(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

async function resolveAuthorizedSource(
  root: string,
  requestedPath: string,
  shouldTransform: (absolutePath: string) => boolean,
): Promise<string | undefined> {
  if (!path.isAbsolute(requestedPath) || requestedPath.includes("\0")) {
    return undefined;
  }

  try {
    const sourceStat = await lstat(requestedPath);

    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
      return undefined;
    }

    const resolvedPath = await realpath(requestedPath);

    if (
      !isWithinRoot(root, resolvedPath) ||
      hasForbiddenSegment(root, resolvedPath) ||
      !shouldTransform(resolvedPath)
    ) {
      return undefined;
    }

    return resolvedPath;
  } catch {
    return undefined;
  }
}

export async function createSourceRegistrationService(
  input: SourceRegistrationServiceOptions,
): Promise<SourceRegistrationService> {
  if (
    !REGISTRATION_IDENTITY_PATTERN.test(input.internalSecret) ||
    !REGISTRATION_IDENTITY_PATTERN.test(input.registryEpoch)
  ) {
    throw new TypeError("The source registration identity is invalid.");
  }

  const root = await realpath(input.root);
  const sourceFilter = createSourceFilter(root, input.options);
  const dataFlowFilter = createDataFlowSourceFilter(root, input.options);
  const registrationQueues = new Map<string, Promise<void>>();

  async function registerCurrentSource(
    sourcePath: string,
    dataFlow: z.infer<typeof registrationRequestSchema>["dataFlow"],
  ): Promise<string | undefined> {
    if (dataFlow === undefined) {
      return input.registry.register(sourcePath);
    }

    let fileId: string | undefined;
    const previous = registrationQueues.get(sourcePath) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        const currentSource = await readFile(sourcePath, "utf8");
        if (createDataFlowSourceVersion(currentSource) !== dataFlow.sourceVersion) {
          return;
        }
        fileId = input.registry.registerDataFlowComponents(
          sourcePath,
          dataFlow.sourceVersion,
          dataFlow.components,
        );
      });
    registrationQueues.set(sourcePath, current);
    await current.finally(() => {
      if (registrationQueues.get(sourcePath) === current) {
        registrationQueues.delete(sourcePath);
      }
    });
    return fileId;
  }

  const handler: SourceRegistrationHandler = (request, response) => {
    const handle = async (): Promise<void> => {
      const contentType = getSingleHeader(request, "content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();

      if (
        request.method !== "POST" ||
        contentType !== "application/json" ||
        !requestComesFromLoopbackWorker(request) ||
        !identitiesMatch(
          getSingleHeader(request, INTERNAL_SECRET_HEADER),
          input.internalSecret,
        )
      ) {
        writeJson(response, 403, { ok: false });
        return;
      }

      const parsed = registrationRequestSchema.safeParse(
        await readJsonRequestBody(request, REGISTRATION_BODY_LIMIT_BYTES),
      );

      if (!parsed.success || parsed.data.epoch !== input.registryEpoch) {
        writeJson(response, 400, { ok: false });
        return;
      }

      const sourcePath = await resolveAuthorizedSource(
        root,
        parsed.data.resourcePath,
        (absolutePath) =>
          parsed.data.dataFlow === undefined
            ? sourceFilter.shouldTransform(absolutePath, "<")
            : dataFlowFilter.shouldTransform(absolutePath, ""),
      );

      if (sourcePath === undefined) {
        writeJson(response, 403, { ok: false });
        return;
      }

      const fileId = await registerCurrentSource(sourcePath, parsed.data.dataFlow);
      if (fileId === undefined) {
        writeJson(response, 409, { ok: false });
        return;
      }

      writeJson(response, 200, { epoch: input.registryEpoch, fileId });
    };

    void handle().catch(() => {
      if (!response.headersSent) {
        writeJson(response, 400, { ok: false });
      } else {
        response.destroy();
      }
    });
  };

  return Object.freeze({ handler, root });
}
