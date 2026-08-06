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

export type SourceContextRequest = z.infer<typeof sourceContextRequestSchema>;
export type OpenEditorRequest = z.infer<typeof openEditorRequestSchema>;
