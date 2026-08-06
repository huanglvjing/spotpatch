import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

import {
  ERROR_CODES,
  SpotPatchError,
  type CodeContext,
  type SourceContextRequest,
} from "@spotpatch/shared";

import type { SourceRegistry } from "../registry/source-registry.js";
import { extractCodeContext } from "./extract-code-context.js";
import { resolveSourceFile } from "./source-file.js";

export interface ReadSourceContextOptions {
  readonly maxCharacters: number;
  readonly maxLines: number;
  readonly registry: SourceRegistry;
  readonly request: SourceContextRequest;
  readonly root: string;
}

function toDisplayPath(root: string, sourcePath: string): string {
  return path.relative(root, sourcePath).split(path.sep).join("/");
}

export async function readSourceContext(
  options: ReadSourceContextOptions,
): Promise<CodeContext> {
  const sourcePath = await resolveSourceFile({
    fileId: options.request.fileId,
    registry: options.registry,
    root: options.root,
  });
  let source: string;

  try {
    source = await readFile(sourcePath, "utf8");
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      throw new SpotPatchError(ERROR_CODES.SOURCE_NOT_FOUND, undefined, {
        cause: error,
      });
    }

    throw error;
  }
  const lines = source.split(/\r?\n/);

  if (options.request.line > lines.length) {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
  }

  const extension = path.extname(sourcePath).toLowerCase();

  return extractCodeContext({
    source,
    sourcePath,
    relativePath: toDisplayPath(await realpath(options.root), sourcePath),
    language: extension === ".tsx" ? "tsx" : "jsx",
    line: options.request.line,
    column: options.request.column,
    maxLines: Math.min(options.request.maxLines, options.maxLines),
    maxCharacters: options.maxCharacters,
  });
}
