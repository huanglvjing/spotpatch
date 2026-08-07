import { z } from "zod";

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

export const spotAnnotationRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: boundedString(128),
  note: z.string().trim().min(1).max(4_000),
  page: z.strictObject({
    url: boundedString(2_048),
    pathname: boundedString(2_048),
    title: boundedString(1_024),
    viewportWidth: z.number().nonnegative(),
    viewportHeight: z.number().nonnegative(),
    devicePixelRatio: z.number().positive(),
  }),
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
  createdAt: z.iso.datetime(),
});

export const agentCapabilityRequestSchema = z.strictObject({
  providerProfileId: profileIdSchema,
  modelProfileId: profileIdSchema,
});

export const agentJobCreateRequestSchema = z.strictObject({
  annotation: spotAnnotationRequestSchema,
  providerProfileId: profileIdSchema,
  modelProfileId: profileIdSchema,
});

export const agentJobActionRequestSchema = z.strictObject({});

export type SourceContextRequest = z.infer<typeof sourceContextRequestSchema>;
export type OpenEditorRequest = z.infer<typeof openEditorRequestSchema>;
export type AgentCapabilityRequest = z.infer<typeof agentCapabilityRequestSchema>;
export type AgentJobCreateRequest = z.infer<typeof agentJobCreateRequestSchema>;
