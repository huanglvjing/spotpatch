import type { IncomingMessage, ServerResponse } from "node:http";

import {
  ERROR_CODES,
  SPOTPATCH_ENDPOINTS,
  SpotPatchError,
  openEditorRequestSchema,
  sourceContextRequestSchema,
  type ApiFailure,
  type ApiSuccess,
  type CodeContext,
  type ErrorCode,
} from "@spotpatch/shared";

import type { ResolvedSpotPatchOptions } from "../options.js";
import type { SourceRegistry } from "../registry/source-registry.js";
import type { SpotPatchSession } from "../session/session.js";
import { type EditorLauncher, launchVSCode } from "./editor.js";
import { readJsonRequestBody } from "./request-body.js";
import { assertRequestAuthorized } from "./request-security.js";
import { readSourceContext } from "./source-context.js";
import { resolveSourceFile } from "./source-file.js";

export type SpotPatchNext = (error?: unknown) => void;
export type SpotPatchMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: SpotPatchNext,
) => void;

export interface SpotPatchServerLogger {
  warn(message: string): void;
}

export interface CreateMiddlewareOptions {
  readonly editorLauncher?: EditorLauncher;
  readonly logger?: SpotPatchServerLogger;
  readonly options: ResolvedSpotPatchOptions;
  readonly registry: SourceRegistry;
  readonly root: string;
  readonly session: SpotPatchSession;
}

const STATUS_BY_ERROR = Object.freeze({
  [ERROR_CODES.INVALID_REQUEST]: 400,
  [ERROR_CODES.INVALID_TOKEN]: 401,
  [ERROR_CODES.ORIGIN_NOT_ALLOWED]: 403,
  [ERROR_CODES.SOURCE_NOT_FOUND]: 404,
  [ERROR_CODES.SOURCE_OUTSIDE_ROOT]: 403,
  [ERROR_CODES.SOURCE_TOO_LARGE]: 413,
  [ERROR_CODES.EDITOR_OPEN_FAILED]: 500,
  [ERROR_CODES.INTERNAL_ERROR]: 500,
} satisfies Record<ErrorCode, number>);

const PUBLIC_MESSAGES = Object.freeze({
  [ERROR_CODES.INVALID_REQUEST]: "The request is invalid.",
  [ERROR_CODES.INVALID_TOKEN]: "The session token is invalid.",
  [ERROR_CODES.ORIGIN_NOT_ALLOWED]: "The request origin is not allowed.",
  [ERROR_CODES.SOURCE_NOT_FOUND]: "The source file is unavailable.",
  [ERROR_CODES.SOURCE_OUTSIDE_ROOT]: "The source file is outside the project root.",
  [ERROR_CODES.SOURCE_TOO_LARGE]: "The source file exceeds the size limit.",
  [ERROR_CODES.EDITOR_OPEN_FAILED]: "The editor request could not be started.",
  [ERROR_CODES.INTERNAL_ERROR]: "The request could not be completed.",
} satisfies Record<ErrorCode, string>);

function writeJson<T>(
  response: ServerResponse,
  status: number,
  payload: ApiSuccess<T> | ApiFailure,
): void {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function asSpotPatchError(error: unknown): SpotPatchError {
  return error instanceof SpotPatchError
    ? error
    : new SpotPatchError(ERROR_CODES.INTERNAL_ERROR, undefined, { cause: error });
}

function writeError(
  response: ServerResponse,
  error: unknown,
  logger: SpotPatchServerLogger | undefined,
): void {
  const normalized = asSpotPatchError(error);

  if (normalized.code === ERROR_CODES.INTERNAL_ERROR) {
    logger?.warn("[spotpatch:server] Internal request failure.");
  }

  writeJson(response, STATUS_BY_ERROR[normalized.code], {
    ok: false,
    error: {
      code: normalized.code,
      message: PUBLIC_MESSAGES[normalized.code],
    },
  });
}

function requestPath(request: IncomingMessage): string {
  try {
    return new URL(request.url ?? "/", "http://spotpatch.invalid").pathname;
  } catch {
    return "";
  }
}

async function handleSourceContext(
  request: IncomingMessage,
  options: CreateMiddlewareOptions,
): Promise<CodeContext> {
  const parsed = sourceContextRequestSchema.safeParse(
    await readJsonRequestBody(request),
  );

  if (!parsed.success) {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
  }

  return readSourceContext({
    request: parsed.data,
    registry: options.registry,
    root: options.root,
    maxLines: options.options.budget.maxCodeLines,
  });
}

async function handleOpenEditor(
  request: IncomingMessage,
  options: CreateMiddlewareOptions,
): Promise<Readonly<Record<string, never>>> {
  const parsed = openEditorRequestSchema.safeParse(await readJsonRequestBody(request));

  if (!parsed.success) {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
  }

  const body = parsed.data;
  const sourcePath = await resolveSourceFile({
    fileId: body.fileId,
    registry: options.registry,
    root: options.root,
  });
  const target = `${sourcePath}:${String(body.line)}:${String(body.column)}`;
  const editorLauncher = options.editorLauncher ?? launchVSCode;

  try {
    editorLauncher(target, () => {
      options.logger?.warn("[spotpatch:server] VS Code rejected an editor request.");
    });
  } catch (error: unknown) {
    throw new SpotPatchError(ERROR_CODES.EDITOR_OPEN_FAILED, undefined, {
      cause: error,
    });
  }

  return Object.freeze({});
}

export function createSpotPatchMiddleware(
  options: CreateMiddlewareOptions,
): SpotPatchMiddleware {
  return (request, response, next) => {
    const path = requestPath(request);

    if (
      path !== SPOTPATCH_ENDPOINTS.sourceContext &&
      path !== SPOTPATCH_ENDPOINTS.openEditor
    ) {
      next();
      return;
    }

    const handle = async (): Promise<void> => {
      if (request.method !== "POST") {
        throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
      }

      assertRequestAuthorized(request, {
        allowLan: options.options.allowLan,
        sessionToken: options.session.token,
      });

      if (path === SPOTPATCH_ENDPOINTS.sourceContext) {
        const data = await handleSourceContext(request, options);
        writeJson(response, 200, { ok: true, data });
        return;
      }

      const data = await handleOpenEditor(request, options);
      writeJson(response, 200, { ok: true, data });
    };

    void handle().catch((error: unknown) => {
      writeError(response, error, options.logger);
    });
  };
}
