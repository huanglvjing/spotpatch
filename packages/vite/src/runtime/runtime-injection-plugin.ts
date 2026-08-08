import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

import packageMetadata from "../../package.json" with { type: "json" };
import { version as VITE_VERSION, type Plugin } from "vite";

import { createRuntimeAiConfig } from "../options.js";
import type { SpotPatchPluginContext } from "../plugin-context.js";
import type { SpotPatchSession } from "../session/session.js";

export const SPOTPATCH_CLIENT_MODULE_ID = "virtual:spotpatch/client";
export const RESOLVED_SPOTPATCH_CLIENT_MODULE_ID = `\0${SPOTPATCH_CLIENT_MODULE_ID}`;
export const SPOTPATCH_REACT_ADAPTER_MODULE_ID = "virtual:spotpatch/react-adapter";
export const RESOLVED_SPOTPATCH_REACT_ADAPTER_MODULE_ID = `\0${SPOTPATCH_REACT_ADAPTER_MODULE_ID}`;

interface RuntimeInjectionPluginInput {
  readonly clientBundle?: string;
  readonly context: SpotPatchPluginContext;
  readonly reactAdapterBundle?: string;
  readonly session: SpotPatchSession;
}

function readRuntimeBundle(root: string, fileName: string): string {
  const resolveFromProject = createRequire(path.join(root, "package.json"));
  const packageEntry = resolveFromProject.resolve("@spotpatch/vite");
  const bundlePath = path.join(path.dirname(packageEntry), fileName);
  return readFileSync(bundlePath, "utf8");
}

function readConsumerViteVersion(root: string): string {
  try {
    const resolveFromProject = createRequire(path.join(root, "package.json"));
    const manifestPath = resolveFromProject.resolve("vite/package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;

    if (
      typeof manifest === "object" &&
      manifest !== null &&
      "version" in manifest &&
      typeof manifest.version === "string"
    ) {
      return manifest.version;
    }
  } catch {
    // Vite itself remains the safe fallback if package metadata is not exported.
  }

  return VITE_VERSION;
}

function createClientModule(
  input: RuntimeInjectionPluginInput,
  clientBundle: string,
  viteVersion: string,
): string {
  const options = input.context.getOptions();
  const runtimeConfig = {
    ai: createRuntimeAiConfig(options.ai),
    budget: options.budget,
    debug: options.debug,
    editor: options.editor,
    locale: options.locale,
    maxTargets: options.maxTargets,
    redact: options.redact,
    sessionToken: input.session.token,
    shortcut: options.shortcut,
    spotPatchVersion: packageMetadata.version,
    viteVersion,
  };

  return [
    `const __SPOTPATCH_RUNTIME_CONFIG__ = ${JSON.stringify(runtimeConfig)};`,
    clientBundle,
  ].join("\n");
}

export function createRuntimeInjectionPlugin(
  input: RuntimeInjectionPluginInput,
): Plugin {
  let root = process.cwd();
  let clientBundle = input.clientBundle;
  let viteVersion = VITE_VERSION;

  return {
    name: "spotpatch:runtime-injection",
    apply: "serve",
    enforce: "pre",

    configResolved(config) {
      root = path.resolve(config.root);
      viteVersion = readConsumerViteVersion(root);
    },

    resolveId(id, importer) {
      if (id === SPOTPATCH_CLIENT_MODULE_ID) {
        return RESOLVED_SPOTPATCH_CLIENT_MODULE_ID;
      }

      if (
        id === "@spotpatch/react-adapter" &&
        importer === RESOLVED_SPOTPATCH_CLIENT_MODULE_ID
      ) {
        return RESOLVED_SPOTPATCH_REACT_ADAPTER_MODULE_ID;
      }

      return null;
    },

    load(id) {
      if (id === RESOLVED_SPOTPATCH_CLIENT_MODULE_ID) {
        clientBundle ??= readRuntimeBundle(root, "runtime-client.js");
        return createClientModule(input, clientBundle, viteVersion);
      }

      if (id === RESOLVED_SPOTPATCH_REACT_ADAPTER_MODULE_ID) {
        return (
          input.reactAdapterBundle ??
          readRuntimeBundle(root, "runtime-react-adapter.js")
        );
      }

      return null;
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
