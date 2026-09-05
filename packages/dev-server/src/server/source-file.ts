import { realpath, stat } from "node:fs/promises";
import path from "node:path";

import { ERROR_CODES, SpotPatchError } from "@spotpatch/shared";

import type { SourceRegistry } from "../registry/source-registry.js";
import { MAX_SOURCE_FILE_BYTES } from "./constants.js";

const ALLOWED_EXTENSIONS = new Set([".jsx", ".tsx", ".astro"]);

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

export async function assertInsideRoot(
  root: string,
  candidate: string,
): Promise<string> {
  let realRoot: string;
  let realCandidate: string;

  try {
    [realRoot, realCandidate] = await Promise.all([
      realpath(root),
      realpath(candidate),
    ]);
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      throw new SpotPatchError(ERROR_CODES.SOURCE_NOT_FOUND, undefined, {
        cause: error,
      });
    }

    throw error;
  }

  const relative = path.relative(realRoot, realCandidate);
  const outside =
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative);

  if (outside) {
    throw new SpotPatchError(ERROR_CODES.SOURCE_OUTSIDE_ROOT);
  }

  return realCandidate;
}

export interface ResolveSourceFileOptions {
  readonly fileId: string;
  readonly registry: SourceRegistry;
  readonly root: string;
}

export async function resolveSourceFile(
  options: ResolveSourceFileOptions,
): Promise<string> {
  const registeredPath = options.registry.resolve(options.fileId);

  if (registeredPath === undefined) {
    throw new SpotPatchError(ERROR_CODES.SOURCE_NOT_FOUND);
  }

  const sourcePath = await assertInsideRoot(options.root, registeredPath);

  if (!ALLOWED_EXTENSIONS.has(path.extname(sourcePath).toLowerCase())) {
    throw new SpotPatchError(ERROR_CODES.SOURCE_NOT_FOUND);
  }

  let sourceStat;

  try {
    sourceStat = await stat(sourcePath);
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      throw new SpotPatchError(ERROR_CODES.SOURCE_NOT_FOUND, undefined, {
        cause: error,
      });
    }

    throw error;
  }

  if (!sourceStat.isFile()) {
    throw new SpotPatchError(ERROR_CODES.SOURCE_NOT_FOUND);
  }

  if (sourceStat.size > MAX_SOURCE_FILE_BYTES) {
    throw new SpotPatchError(ERROR_CODES.SOURCE_TOO_LARGE);
  }

  return sourcePath;
}
