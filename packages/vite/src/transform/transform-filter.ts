import path from "node:path";

import { createFilter } from "@rollup/pluginutils";

import type { ResolvedSpotPatchOptions } from "../options.js";

const SUPPORTED_EXTENSIONS = new Set([".jsx", ".tsx"]);

export function stripViteQuery(id: string): string {
  const queryIndex = id.indexOf("?");
  return queryIndex === -1 ? id : id.slice(0, queryIndex);
}

export function isInsideRoot(root: string, candidate: string, pathApi = path): boolean {
  const relative = pathApi.relative(pathApi.resolve(root), pathApi.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${pathApi.sep}`) &&
      relative !== ".." &&
      !pathApi.isAbsolute(relative))
  );
}

export interface TransformFilter {
  shouldTransform(id: string, code: string): boolean;
}

export function createTransformFilter(
  root: string,
  options: ResolvedSpotPatchOptions,
): TransformFilter {
  const matchesConfiguredFilter = createFilter(options.include, options.exclude);

  return Object.freeze({
    shouldTransform(id: string, code: string): boolean {
      if (id.startsWith("\0") || id.includes("virtual:spotpatch")) {
        return false;
      }

      const cleanId = stripViteQuery(id);

      if (!SUPPORTED_EXTENSIONS.has(path.extname(cleanId).toLowerCase())) {
        return false;
      }

      if (
        cleanId.includes("/node_modules/") ||
        cleanId.includes("\\node_modules\\") ||
        cleanId.includes("/packages/vite/") ||
        cleanId.includes("\\packages\\vite\\")
      ) {
        return false;
      }

      if (!isInsideRoot(root, cleanId) || !matchesConfiguredFilter(cleanId)) {
        return false;
      }

      return code.includes("<");
    },
  });
}
