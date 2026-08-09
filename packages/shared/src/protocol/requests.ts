import { z } from "zod";

import {
  MAX_ANNOTATION_INSTRUCTION_CHARACTERS,
  MAX_ANNOTATION_TARGETS,
  MAX_TARGET_INSTRUCTION_CHARACTERS,
  SPOTPATCH_LOCALES,
  type SpotAnnotation,
} from "../model/annotation.js";

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

const profileIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

const boundedString = (maximum: number): z.ZodString => z.string().max(maximum);
const sourceRefSchema = z.strictObject({
  fileId: boundedString(128).optional(),
  relativePath: boundedString(1_024).optional(),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
  origin: z.enum(["jsx-host", "react-fiber", "dom-ancestor", "none"]),
  confidence: z.enum(["exact", "probable", "approximate", "unknown"]),
});
const matchedStyleRuleSchema = z.strictObject({
  selector: boundedString(2_048),
  declarations: boundedString(8_192),
  source: boundedString(1_024).optional(),
  media: boundedString(1_024).optional(),
});
const codeContextSchema = z.strictObject({
  relativePath: boundedString(1_024),
  language: z.enum(["tsx", "jsx"]),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  excerpt: boundedString(16_000),
  boundary: z.enum(["component", "nearby-lines"]),
});

export const spotTargetContextRequestSchema = z.strictObject({
  instruction: z.string().trim().min(1).max(MAX_TARGET_INSTRUCTION_CHARACTERS),
  source: sourceRefSchema,
  react: z.strictObject({
    supported: z.boolean(),
    version: boundedString(64).optional(),
    componentName: boundedString(256).optional(),
    componentStack: z.array(boundedString(256)).max(64),
    source: sourceRefSchema.optional(),
  }),
  element: z.strictObject({
    tagName: boundedString(128),
    selector: boundedString(2_048),
    sanitizedHtml: boundedString(8_192),
    textPreview: boundedString(2_048).optional(),
    role: boundedString(256).optional(),
    rect: z.strictObject({
      x: z.number(),
      y: z.number(),
      width: z.number().nonnegative(),
      height: z.number().nonnegative(),
    }),
  }),
  styles: z.strictObject({
    classNames: z.array(boundedString(512)).max(256),
    inlineStyle: boundedString(8_192).optional(),
    matchedRules: z.array(matchedStyleRuleSchema).max(256),
    computed: z.record(boundedString(256), boundedString(2_048)),
    warnings: z.array(boundedString(1_024)).max(64),
  }),
  code: codeContextSchema.optional(),
  warnings: z.array(boundedString(1_024)).max(64),
});

export const spotAnnotationRequestSchema = z
  .strictObject({
    schemaVersion: z.literal(3),
    id: boundedString(128),
    locale: z.enum(SPOTPATCH_LOCALES),
    page: z.strictObject({
      url: boundedString(2_048),
      pathname: boundedString(2_048),
      title: boundedString(1_024),
      viewportWidth: z.number().nonnegative(),
      viewportHeight: z.number().nonnegative(),
      devicePixelRatio: z.number().positive(),
    }),
    targets: z.array(spotTargetContextRequestSchema).min(1).max(MAX_ANNOTATION_TARGETS),
    createdAt: z.iso.datetime(),
  })
  .superRefine((annotation, context) => {
    const total = annotation.targets.reduce(
      (characters, target) => characters + target.instruction.length,
      0,
    );

    if (total > MAX_ANNOTATION_INSTRUCTION_CHARACTERS) {
      context.addIssue({
        code: "custom",
        message: "Combined target instructions exceed the annotation limit.",
        path: ["targets"],
      });
    }
  });

export const agentCapabilityRequestSchema = z.strictObject({
  providerProfileId: profileIdSchema,
  modelProfileId: profileIdSchema,
});

export const agentWorkspaceHealthRequestSchema = z.strictObject({});

export const agentJobCreateRequestSchema = z.strictObject({
  annotation: spotAnnotationRequestSchema,
  providerProfileId: profileIdSchema,
  modelProfileId: profileIdSchema,
  providerDataConsent: z.literal(true),
  workingTreeMode: z
    .enum(["require-clean", "include-local-changes"])
    .default("require-clean"),
});

export const agentJobActionRequestSchema = z.strictObject({});

export type SourceContextRequest = z.infer<typeof sourceContextRequestSchema>;
export type RuntimeBootstrapRequest = z.infer<typeof runtimeBootstrapRequestSchema>;
export type OpenEditorRequest = z.infer<typeof openEditorRequestSchema>;
export type AgentCapabilityRequest = z.infer<typeof agentCapabilityRequestSchema>;
export interface AgentJobCreateRequest {
  readonly annotation: SpotAnnotation;
  readonly providerProfileId: string;
  readonly modelProfileId: string;
  readonly providerDataConsent: true;
  readonly workingTreeMode: "require-clean" | "include-local-changes";
}
