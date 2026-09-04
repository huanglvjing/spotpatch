import { z } from "zod";

import {
  MAX_ANNOTATION_INSTRUCTION_CHARACTERS,
  MAX_ANNOTATION_TARGETS,
  MAX_TARGET_INSTRUCTION_CHARACTERS,
  SPOTPATCH_LOCALES,
} from "./annotation.js";

const boundedString = (maximum: number): z.ZodString => z.string().max(maximum);

export const sourceRefSchema = z.strictObject({
  fileId: boundedString(128).optional(),
  relativePath: boundedString(1_024).optional(),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
  origin: z.enum(["jsx-host", "react-fiber", "dom-ancestor", "none"]),
  confidence: z.enum(["exact", "probable", "approximate", "unknown"]),
});

export const matchedStyleRuleSchema = z.strictObject({
  selector: boundedString(2_048),
  declarations: boundedString(8_192),
  source: boundedString(1_024).optional(),
  media: boundedString(1_024).optional(),
});

export const codeContextSchema = z.strictObject({
  relativePath: boundedString(1_024),
  language: z.enum(["tsx", "jsx"]),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  excerpt: boundedString(16_000),
  boundary: z.enum(["component", "nearby-lines"]),
});

export const pageContextSchema = z.strictObject({
  url: boundedString(2_048),
  pathname: boundedString(2_048),
  title: boundedString(1_024),
  viewportWidth: z.number().nonnegative(),
  viewportHeight: z.number().nonnegative(),
  devicePixelRatio: z.number().positive(),
});

export const spotTargetContextSchema = z.strictObject({
  instruction: z.string().trim().min(1).max(MAX_TARGET_INSTRUCTION_CHARACTERS),
  page: pageContextSchema.optional(),
  source: sourceRefSchema,
  react: z.strictObject({
    supported: z.boolean(),
    version: boundedString(64).optional(),
    componentName: boundedString(256).optional(),
    componentSourceId: boundedString(128).optional(),
    sourceVersion: boundedString(128).optional(),
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

export const spotAnnotationSchema = z
  .strictObject({
    schemaVersion: z.literal(3),
    id: boundedString(128),
    locale: z.enum(SPOTPATCH_LOCALES),
    page: pageContextSchema,
    targets: z.array(spotTargetContextSchema).min(1).max(MAX_ANNOTATION_TARGETS),
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
