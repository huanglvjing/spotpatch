import type { IncomingMessage, ServerResponse } from "node:http";

import {
  ERROR_CODES,
  EXTERNAL_HANDOFF_LIMITS,
  SPOTPATCH_ENDPOINTS,
  SpotPatchError,
  externalHandoffCapabilityRequestSchema,
  externalHandoffPublishRequestSchema,
  externalHandoffResolveDeliveryRequestSchema,
  externalHandoffStatusRequestSchema,
} from "@spotpatch/shared";

import type { ResolvedSpotPatchOptions } from "../options.js";
import type { SourceRegistry } from "../registry/source-registry.js";
import { authorizeAnnotation } from "../server/annotation-authorizer.js";
import { readJsonRequestBody } from "../server/request-body.js";
import type { ExternalHandoffService } from "./service.js";

export type ExternalHandoffBrowserRoute =
  "capability" | "publish" | "resolve-delivery" | "status";

export interface ExternalHandoffBrowserOptions {
  readonly options: ResolvedSpotPatchOptions;
  readonly registry: SourceRegistry;
  readonly root: string;
  readonly service?: ExternalHandoffService;
}

export type WriteExternalHandoffSuccess = (
  response: ServerResponse,
  status: number,
  data: unknown,
) => void;

export function matchExternalHandoffBrowserPath(
  path: string,
): ExternalHandoffBrowserRoute | undefined {
  if (path === SPOTPATCH_ENDPOINTS.externalHandoffCapability) return "capability";
  if (path === SPOTPATCH_ENDPOINTS.externalHandoffPublish) return "publish";
  if (path === SPOTPATCH_ENDPOINTS.externalHandoffStatus) return "status";
  if (path === SPOTPATCH_ENDPOINTS.externalHandoffResolveDelivery) {
    return "resolve-delivery";
  }
  return undefined;
}

function requireService(
  options: ExternalHandoffBrowserOptions,
): ExternalHandoffService {
  if (!options.options.externalAgent.enabled || options.service === undefined) {
    throw new SpotPatchError(ERROR_CODES.EXTERNAL_HANDOFF_DISABLED);
  }

  return options.service;
}

function remapAuthorizationError(error: unknown): never {
  if (error instanceof SpotPatchError) {
    if (
      error.code === ERROR_CODES.SOURCE_NOT_FOUND ||
      error.code === ERROR_CODES.SOURCE_OUTSIDE_ROOT ||
      error.code === ERROR_CODES.SOURCE_TOO_LARGE
    ) {
      throw new SpotPatchError(ERROR_CODES.HANDOFF_SOURCE_STALE, undefined, {
        cause: error,
      });
    }

    if (error.code === ERROR_CODES.INVALID_REQUEST) {
      throw new SpotPatchError(ERROR_CODES.HANDOFF_VALIDATION_FAILED, undefined, {
        cause: error,
      });
    }
  }

  throw error;
}

export async function handleExternalHandoffBrowserRequest(
  request: IncomingMessage,
  response: ServerResponse,
  route: ExternalHandoffBrowserRoute,
  options: ExternalHandoffBrowserOptions,
  writeSuccess: WriteExternalHandoffSuccess,
): Promise<void> {
  if (request.method !== "POST") {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
  }

  const service = requireService(options);

  if (route === "capability") {
    const parsed = externalHandoffCapabilityRequestSchema.safeParse(
      await readJsonRequestBody(request),
    );
    if (!parsed.success) throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
    writeSuccess(response, 200, service.capability());
    return;
  }

  if (route === "status") {
    const parsed = externalHandoffStatusRequestSchema.safeParse(
      await readJsonRequestBody(request),
    );
    if (!parsed.success) throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
    writeSuccess(response, 200, service.status(parsed.data.cursor));
    return;
  }

  if (route === "resolve-delivery") {
    const parsed = externalHandoffResolveDeliveryRequestSchema.safeParse(
      await readJsonRequestBody(request),
    );
    if (!parsed.success) throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
    writeSuccess(response, 200, service.resolveDelivery(parsed.data.cursor));
    return;
  }

  const parsed = externalHandoffPublishRequestSchema.safeParse(
    await readJsonRequestBody(request, EXTERNAL_HANDOFF_LIMITS.maximumPublishBodyBytes),
  );

  if (!parsed.success) {
    throw new SpotPatchError(ERROR_CODES.HANDOFF_VALIDATION_FAILED);
  }

  const result = await service.publish(parsed.data, async (annotation) => {
    try {
      return await authorizeAnnotation({
        annotation,
        options: options.options,
        registry: options.registry,
        root: options.root,
      });
    } catch (error: unknown) {
      remapAuthorizationError(error);
    }
  });
  writeSuccess(response, result.replayed ? 200 : 201, result);
}
