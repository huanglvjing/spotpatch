import { realpath } from "node:fs/promises";
import path from "node:path";

import { createFilter } from "@rollup/pluginutils";
import { isInsideRoot, injectSourceMarkers } from "@spotpatch/compiler";
import type { ResolvedSpotPatchOptions, SourceRegistry } from "@spotpatch/dev-server";
import type { Plugin } from "vite";

import { injectAstroSourceMarkers } from "./astro-source-markers.js";
import { ASTRO_DATA_FLOW_MODULE_ID } from "./runtime-plugin.js";

interface AstroTransformInput {
  readonly root: string;
  readonly options: () => ResolvedSpotPatchOptions;
  readonly registry: SourceRegistry;
}

export function createAstroTransform(input: AstroTransformInput): Plugin {
  let matches: ReturnType<typeof createFilter> | undefined;
  const warned = new Set<string>();
  let realRoot: string | undefined;
  return {
    name: "spotpatch:astro:transform",
    apply: "serve",
    enforce: "pre",
    transform: {
      // Astro's own compiler is also enforce:pre. Hook ordering runs us before it.
      order: "pre",
      async handler(code, id, transformOptions) {
        const options = input.options();
        matches ??= createFilter(options.include, options.exclude, {
          resolve: input.root,
        });
        if (
          id.includes("?") ||
          id.includes("\0") ||
          !/\.(?:astro|[jt]sx?)$/u.test(id) ||
          /(?:^|[/\\])(?:node_modules|\.astro|dist|coverage)(?:[/\\]|$)/u.test(id) ||
          !isInsideRoot(input.root, id) ||
          !matches(id)
        )
          return null;
        const warn = (): void => {
          if (warned.has(id)) return;
          warned.add(id);
          this.warn(
            `[spotpatch:astro] Source markers unavailable or already present in ${path.relative(input.root, id)}.`,
          );
        };
        try {
          realRoot ??= await realpath(input.root);
          const file = await realpath(id);
          if (!isInsideRoot(realRoot, file)) return null;
          const common = {
            code,
            absolutePath: file,
            root: realRoot,
            fileId: input.registry.register(file),
          };
          const result = id.endsWith(".astro")
            ? injectAstroSourceMarkers({
                ...common,
                onExistingMarker: warn,
                ...(options.dataFlow.enabled
                  ? { dataFlow: { helperModule: ASTRO_DATA_FLOW_MODULE_ID } }
                  : {}),
              })
            : injectSourceMarkers({
                ...common,
                onWarning: warn,
                ...(options.dataFlow.enabled && transformOptions?.ssr !== true
                  ? { dataFlow: { helperModule: ASTRO_DATA_FLOW_MODULE_ID } }
                  : {}),
              });
          if (result?.dataFlow !== undefined) {
            input.registry.registerDataFlowComponents(
              file,
              result.dataFlow.sourceVersion,
              result.dataFlow.anchors.flatMap((anchor) =>
                anchor.kind === "component"
                  ? [
                      {
                        componentSourceId: anchor.id,
                        line: anchor.line,
                        column: anchor.column,
                      },
                    ]
                  : [],
              ),
            );
            for (const diagnostic of result.dataFlow.diagnostics) {
              const key = `${file}:${diagnostic.code}:${String(diagnostic.line)}:${String(diagnostic.column)}`;
              if (warned.has(key)) continue;
              warned.add(key);
              this.warn(
                `[spotpatch:astro] ${diagnostic.code} at ${path.relative(input.root, file)}:${String(diagnostic.line)}:${String(diagnostic.column)}; evidence remains partial.`,
              );
            }
          }
          return result === undefined
            ? null
            : { code: result.code, map: result.map.toString() };
        } catch {
          warn();
          return null;
        }
      },
    },
  };
}
