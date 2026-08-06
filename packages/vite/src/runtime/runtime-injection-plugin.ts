import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { Plugin } from "vite";

import type { ResolvedSpotPatchOptions } from "../options.js";
import type { SpotPatchSession } from "../session/session.js";

export const SPOTPATCH_CLIENT_MODULE_ID = "virtual:spotpatch/client";
export const RESOLVED_SPOTPATCH_CLIENT_MODULE_ID = `\0${SPOTPATCH_CLIENT_MODULE_ID}`;

interface RuntimeInjectionPluginInput {
  readonly clientBundle?: string;
  readonly options: ResolvedSpotPatchOptions;
  readonly session: SpotPatchSession;
}

function readClientBundle(root: string): string {
  const resolveFromProject = createRequire(path.join(root, "package.json"));
  const packageEntry = resolveFromProject.resolve("@spotpatch/vite");
  const bundlePath = path.join(path.dirname(packageEntry), "runtime-client.js");
  return readFileSync(bundlePath, "utf8");
}

function createClientModule(
  input: RuntimeInjectionPluginInput,
  clientBundle: string,
): string {
  const runtimeConfig = {
    budget: input.options.budget,
    debug: input.options.debug,
    redact: input.options.redact,
    sessionToken: input.session.token,
    shortcut: input.options.shortcut,
  };

  return [
    clientBundle,
    `const config = ${JSON.stringify(runtimeConfig)};`,
    "bootstrapSpotPatch({ ...config, apiBase: SPOTPATCH_API_BASE });",
  ].join("\n");
}

export function createRuntimeInjectionPlugin(
  input: RuntimeInjectionPluginInput,
): Plugin {
  let root = process.cwd();
  let clientBundle = input.clientBundle;

  return {
    name: "spotpatch:runtime-injection",
    apply: "serve",
    enforce: "pre",

    configResolved(config) {
      root = path.resolve(config.root);
    },

    resolveId(id) {
      return id === SPOTPATCH_CLIENT_MODULE_ID
        ? RESOLVED_SPOTPATCH_CLIENT_MODULE_ID
        : null;
    },

    load(id) {
      if (id !== RESOLVED_SPOTPATCH_CLIENT_MODULE_ID) {
        return null;
      }

      clientBundle ??= readClientBundle(root);
      return createClientModule(input, clientBundle);
    },

    transformIndexHtml() {
      return [
        {
          tag: "script",
          attrs: {
            type: "module",
            src: `/@id/${SPOTPATCH_CLIENT_MODULE_ID}`,
          },
          injectTo: "head",
        },
      ];
    },
  };
}
