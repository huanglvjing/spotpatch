import { createHash } from "node:crypto";
import path from "node:path";

import type { Plugin, ResolvedConfig } from "vite";

import type { ResolvedSpotPatchOptions } from "../options.js";
import type { SourceRegistry } from "../registry/source-registry.js";
import { injectSourceMarkers } from "./inject-source-markers.js";
import { createTransformFilter, stripViteQuery } from "./transform-filter.js";

interface TransformPluginInput {
  readonly options: ResolvedSpotPatchOptions;
  readonly registry: SourceRegistry;
}

interface ViteTransformOutput {
  readonly code: string;
  readonly map: string;
}

function createCacheKey(id: string, code: string): string {
  const hash = createHash("sha256").update(code).digest("base64url");
  return `${id}\0${hash}`;
}

function getDisplayPath(root: string, id: string): string {
  const relative = path.relative(root, stripViteQuery(id));
  return relative.split(path.sep).join("/");
}

export function createTransformPlugin(input: TransformPluginInput): Plugin {
  let root = process.cwd();
  let filter = createTransformFilter(root, input.options);
  let logger: ResolvedConfig["logger"] | undefined;
  const warnedFiles = new Set<string>();
  const cache = new Map<string, ViteTransformOutput | null>();

  return {
    name: "spotpatch:transform",
    apply: "serve",
    enforce: "pre",

    configResolved(config) {
      root = path.resolve(config.root);
      filter = createTransformFilter(root, input.options);
      logger = config.logger;
    },

    transform(code, id) {
      if (!filter.shouldTransform(id, code)) {
        return null;
      }

      const cleanId = path.resolve(stripViteQuery(id));
      const cacheKey = createCacheKey(cleanId, code);

      if (cache.has(cacheKey)) {
        return cache.get(cacheKey) ?? null;
      }

      const startedAt = performance.now();

      try {
        const result = injectSourceMarkers({
          code,
          absolutePath: cleanId,
          root,
          fileId: input.registry.register(cleanId),
          onWarning(warning) {
            logger?.warn(
              `[spotpatch:transform] Existing source marker at ${getDisplayPath(root, id)}:${String(warning.line)}:${String(warning.column)}; preserving application value.`,
            );
          },
        });

        const output =
          result === undefined
            ? null
            : Object.freeze({
                code: result.code,
                map: result.map.toString(),
              });
        cache.set(cacheKey, output);

        if (input.options.debug) {
          const elapsed = performance.now() - startedAt;
          logger?.info(
            `[spotpatch:transform] ${getDisplayPath(root, id)} ${elapsed.toFixed(2)}ms`,
          );
        }

        return output;
      } catch (error: unknown) {
        if (!warnedFiles.has(cleanId)) {
          warnedFiles.add(cleanId);
          const detail =
            input.options.debug && error instanceof Error ? `: ${error.message}` : "";
          logger?.warn(
            `[spotpatch:transform] Failed to transform ${getDisplayPath(root, id)}; using original module${detail}`,
          );
        }

        return null;
      }
    },
  };
}
