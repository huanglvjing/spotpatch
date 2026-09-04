import { z } from "zod";

import { MAX_ANNOTATION_TARGETS, type SpotAnnotation } from "../model/annotation.js";
import { AGENT_APPLY_MODES, type AgentApplyMode } from "../model/agent.js";
import { spotAnnotationSchema } from "../model/context-schema.js";

export {
  pageContextSchema as pageContextRequestSchema,
  spotAnnotationSchema as spotAnnotationRequestSchema,
  spotTargetContextSchema as spotTargetContextRequestSchema,
} from "../model/context-schema.js";

export const runtimeBootstrapRequestSchema = z.strictObject({});

const sourceCoordinatesSchema = z.strictObject({
  fileId: z.string().min(1).max(128),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
});

export const sourceContextRequestSchema = sourceCoordinatesSchema
  .extend({
    maxLines: z.number().int().positive(),
  })
  .strict();

export const openEditorRequestSchema = sourceCoordinatesSchema.strict();

const dataFlowSourceCoordinatesRequestSchema = sourceCoordinatesSchema
  .extend({
    schemaVersion: z.literal(1),
    sourceVersion: z.string().min(1).max(128).optional(),
  })
  .strict();

const dataFlowComponentIdentityRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  componentSourceId: z.string().min(1).max(128),
  sourceVersion: z.string().min(1).max(128),
});

export const dataFlowComponentReportRequestSchema = z.union([
  dataFlowSourceCoordinatesRequestSchema,
  dataFlowComponentIdentityRequestSchema,
]);

export const dataFlowPageReportRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  targets: z
    .array(dataFlowComponentReportRequestSchema)
    .min(1)
    .max(MAX_ANNOTATION_TARGETS),
});

const profileIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

export const agentCapabilityRequestSchema = z.strictObject({
  providerProfileId: profileIdSchema,
  modelProfileId: profileIdSchema,
});

export const agentWorkspaceHealthRequestSchema = z.strictObject({});

export const agentJobCreateRequestSchema = z.strictObject({
  annotation: spotAnnotationSchema,
  applyMode: z.enum(AGENT_APPLY_MODES).optional(),
  providerProfileId: profileIdSchema,
  modelProfileId: profileIdSchema,
  providerDataConsent: z.literal(true),
  trustedFastModeConsent: z.literal(true).optional(),
  workingTreeMode: z
    .enum(["require-clean", "include-local-changes"])
    .default("require-clean"),
});

export const agentJobActionRequestSchema = z.strictObject({});

export type SourceContextRequest = z.infer<typeof sourceContextRequestSchema>;
export type RuntimeBootstrapRequest = z.infer<typeof runtimeBootstrapRequestSchema>;
export type OpenEditorRequest = z.infer<typeof openEditorRequestSchema>;
export type DataFlowComponentReportRequest = z.infer<
  typeof dataFlowComponentReportRequestSchema
>;
export type DataFlowPageReportRequest = z.infer<typeof dataFlowPageReportRequestSchema>;
export type AgentCapabilityRequest = z.infer<typeof agentCapabilityRequestSchema>;
export interface AgentJobCreateRequest {
  readonly annotation: SpotAnnotation;
  readonly applyMode?: AgentApplyMode;
  readonly providerProfileId: string;
  readonly modelProfileId: string;
  readonly providerDataConsent: true;
  readonly trustedFastModeConsent?: true;
  readonly workingTreeMode: "require-clean" | "include-local-changes";
}
