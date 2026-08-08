import type { IncomingMessage, ServerResponse } from "node:http";

import {
  ERROR_CODES,
  SPOTPATCH_API_BASE,
  SPOTPATCH_ENDPOINTS,
  SpotPatchError,
  openEditorRequestSchema,
  sourceContextRequestSchema,
  type ApiFailure,
  type ApiSuccess,
  type CodeContext,
  type EditorOpenResult,
  type ErrorCode,
} from "@spotpatch/shared";

import type { ResolvedSpotPatchOptions } from "../options.js";
import type { SourceRegistry } from "../registry/source-registry.js";
import type { SpotPatchSession } from "../session/session.js";
import type { AgentJobManager } from "../agent/job-manager.js";
import { handleAgentRequest, matchAgentRequestPath } from "./agent-http.js";
import { type EditorLauncher, launchConfiguredEditor } from "./editor.js";
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
  readonly agentManager?: AgentJobManager;
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
  [ERROR_CODES.AI_DISABLED]: 404,
  [ERROR_CODES.PROVIDER_NOT_CONFIGURED]: 503,
  [ERROR_CODES.PROVIDER_AUTH_FAILED]: 502,
  [ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED]: 502,
  [ERROR_CODES.MODEL_NOT_ALLOWED]: 400,
  [ERROR_CODES.MODEL_TOOL_CALL_UNSUPPORTED]: 422,
  [ERROR_CODES.PROVIDER_RATE_LIMITED]: 429,
  [ERROR_CODES.AGENT_BUSY]: 409,
  [ERROR_CODES.AGENT_LIMIT_EXCEEDED]: 413,
  [ERROR_CODES.AGENT_CANCELLED]: 409,
  [ERROR_CODES.WORKTREE_DIRTY]: 409,
  [ERROR_CODES.TOOL_DENIED]: 403,
  [ERROR_CODES.PATCH_REJECTED]: 422,
  [ERROR_CODES.VALIDATION_FAILED]: 422,
  [ERROR_CODES.APPLY_CONFLICT]: 409,
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
  [ERROR_CODES.AI_DISABLED]: "AI execution is not enabled.",
  [ERROR_CODES.PROVIDER_NOT_CONFIGURED]: "The AI provider is unavailable.",
  [ERROR_CODES.PROVIDER_AUTH_FAILED]: "The AI provider rejected authentication.",
  [ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED]:
    "The AI provider protocol is unsupported.",
  [ERROR_CODES.MODEL_NOT_ALLOWED]: "The selected model is not allowed.",
  [ERROR_CODES.MODEL_TOOL_CALL_UNSUPPORTED]:
    "The selected model cannot run SpotPatch tools.",
  [ERROR_CODES.PROVIDER_RATE_LIMITED]: "The AI provider is rate limited.",
  [ERROR_CODES.AGENT_BUSY]: "Another Agent job is already running.",
  [ERROR_CODES.AGENT_LIMIT_EXCEEDED]: "The Agent job exceeded a safety limit.",
  [ERROR_CODES.AGENT_CANCELLED]: "The Agent job was cancelled.",
  [ERROR_CODES.WORKTREE_DIRTY]: "The project worktree must be clean.",
  [ERROR_CODES.TOOL_DENIED]: "The Agent tool request was denied.",
  [ERROR_CODES.PATCH_REJECTED]: "The proposed patch was rejected.",
  [ERROR_CODES.VALIDATION_FAILED]: "The proposed change failed validation.",
  [ERROR_CODES.APPLY_CONFLICT]: "The change conflicts with the current worktree.",
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
    maxCharacters: options.options.budget.codeCharacters,
    maxLines: options.options.budget.maxCodeLines,
  });
}

async function handleOpenEditor(
  request: IncomingMessage,
  options: CreateMiddlewareOptions,
): Promise<EditorOpenResult> {
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
  const editorLauncher = options.editorLauncher ?? launchConfiguredEditor;

  try {
    await editorLauncher(target, options.options.editor);
  } catch (error: unknown) {
    options.logger?.warn(
      `[spotpatch:server] ${options.options.editor === "auto" ? "The detected editor" : options.options.editor} rejected an editor request.`,
    );
    throw new SpotPatchError(ERROR_CODES.EDITOR_OPEN_FAILED, undefined, {
      cause: error,
    });
  }

  return Object.freeze({ editor: options.options.editor });
}

export function createSpotPatchMiddleware(
  options: CreateMiddlewareOptions,
): SpotPatchMiddleware {
  return (request, response, next) => {
    const path = requestPath(request);
    const agentRoute = matchAgentRequestPath(path);

    if (
      path !== SPOTPATCH_ENDPOINTS.sourceContext &&
      path !== SPOTPATCH_ENDPOINTS.openEditor &&
      agentRoute === undefined &&
      !path.startsWith(`${SPOTPATCH_API_BASE}/`)
    ) {
      next();
      return;
    }

    const handle = async (): Promise<void> => {
      assertRequestAuthorized(request, {
        allowLan: options.options.allowLan,
        sessionToken: options.session.token,
      });

      if (path === SPOTPATCH_ENDPOINTS.sourceContext) {
        if (request.method !== "POST") {
          throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
        }

        const data = await handleSourceContext(request, options);
        writeJson(response, 200, { ok: true, data });
        return;
      }

      if (path === SPOTPATCH_ENDPOINTS.openEditor) {
        if (request.method !== "POST") {
          throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
        }

        const data = await handleOpenEditor(request, options);
        writeJson(response, 200, { ok: true, data });
        return;
      }

      if (agentRoute === undefined) {
        throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
      }

      await handleAgentRequest(
        request,
        response,
        options,
        agentRoute,
        (target, status, data) => {
          writeJson(target, status, { ok: true, data });
        },
      );
    };

    void handle().catch((error: unknown) => {
      writeError(response, error, options.logger);
    });
  };
}
