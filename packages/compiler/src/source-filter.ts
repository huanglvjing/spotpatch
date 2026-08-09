import path from "node:path";

import { createFilter } from "@rollup/pluginutils";

export type SourceFilterEntry = string | RegExp;

export interface SourceFilterOptions {
  readonly exclude: readonly SourceFilterEntry[];
  readonly include: readonly SourceFilterEntry[];
}

export interface SourceFilter {
  shouldTransform(absolutePath: string, code: string): boolean;
}

const SUPPORTED_EXTENSIONS = new Set([".jsx", ".tsx"]);

export function isInsideRoot(root: string, candidate: string, pathApi = path): boolean {
  const relative = pathApi.relative(pathApi.resolve(root), pathApi.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${pathApi.sep}`) &&
      relative !== ".." &&
      !pathApi.isAbsolute(relative))
  );
}

export function createSourceFilter(
  root: string,
  options: SourceFilterOptions,
): SourceFilter {
  const resolvedRoot = path.resolve(root);
  const matchesConfiguredFilter = createFilter(options.include, options.exclude);

  return Object.freeze({
    shouldTransform(absolutePath: string, code: string): boolean {
      if (
        !SUPPORTED_EXTENSIONS.has(path.extname(absolutePath).toLowerCase()) ||
        absolutePath.includes("/node_modules/") ||
        absolutePath.includes("\\node_modules\\") ||
        !isInsideRoot(resolvedRoot, absolutePath) ||
        !matchesConfiguredFilter(absolutePath)
      ) {
        return false;
      }

      return code.includes("<");
    },
  });
}
