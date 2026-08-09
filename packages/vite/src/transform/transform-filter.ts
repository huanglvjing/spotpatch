import path from "node:path";

import { createSourceFilter } from "@spotpatch/compiler";
import type { ResolvedSpotPatchOptions } from "@spotpatch/dev-server";

export function stripViteQuery(id: string): string {
  const queryIndex = id.indexOf("?");
  return queryIndex === -1 ? id : id.slice(0, queryIndex);
}

export { isInsideRoot } from "@spotpatch/compiler";

export interface TransformFilter {
  shouldTransform(id: string, code: string): boolean;
}

export function createTransformFilter(
  root: string,
  options: ResolvedSpotPatchOptions,
): TransformFilter {
  const sourceFilter = createSourceFilter(root, options);

  return Object.freeze({
    shouldTransform(id: string, code: string): boolean {
      if (
        id.startsWith("\0") ||
        id.includes("virtual:spotpatch") ||
        id.includes("/packages/vite/") ||
        id.includes("\\packages\\vite\\")
      ) {
        return false;
      }

      const cleanId = stripViteQuery(id);
      return sourceFilter.shouldTransform(path.resolve(cleanId), code);
    },
  });
}
