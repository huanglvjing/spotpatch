import {
  type AgentJobCreateRequest,
  type agentJobCreateRequestSchema,
} from "@spotpatch/shared";
import type { z } from "zod";

import type { ResolvedSpotPatchOptions } from "../options.js";
import type { SourceRegistry } from "../registry/source-registry.js";
import { authorizeAnnotation } from "./annotation-authorizer.js";

export interface AuthorizeAgentJobRequestOptions {
  readonly options: ResolvedSpotPatchOptions;
  readonly registry: SourceRegistry;
  readonly request: z.output<typeof agentJobCreateRequestSchema>;
  readonly root: string;
}

export async function authorizeAgentJobRequest(
  input: AuthorizeAgentJobRequestOptions,
): Promise<AgentJobCreateRequest> {
  const annotation = await authorizeAnnotation({
    annotation: input.request.annotation,
    options: input.options,
    registry: input.registry,
    root: input.root,
  });

  return Object.freeze({
    annotation,
    ...(input.request.applyMode === undefined
      ? {}
      : { applyMode: input.request.applyMode }),
    providerProfileId: input.request.providerProfileId,
    modelProfileId: input.request.modelProfileId,
    providerDataConsent: true,
    ...(input.request.trustedFastModeConsent === true
      ? { trustedFastModeConsent: true as const }
      : {}),
    workingTreeMode: input.request.workingTreeMode,
  });
}
