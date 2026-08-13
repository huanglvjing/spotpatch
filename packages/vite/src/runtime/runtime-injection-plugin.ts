import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  createRuntimeAiConfig,
  createRuntimeDataFlowConfig,
  type SpotPatchSession,
} from "@spotpatch/dev-server";
import packageMetadata from "../../package.json" with { type: "json" };
import { version as VITE_VERSION, type Plugin } from "vite";

import type { SpotPatchPluginContext } from "../plugin-context.js";
import { BRAND_MARK_CONTENT } from "./brand-mark-content.js";

export const SPOTPATCH_CLIENT_MODULE_ID = "virtual:spotpatch/client";
export const RESOLVED_SPOTPATCH_CLIENT_MODULE_ID = `\0${SPOTPATCH_CLIENT_MODULE_ID}`;
export const SPOTPATCH_REACT_ADAPTER_MODULE_ID = "virtual:spotpatch/react-adapter";
export const RESOLVED_SPOTPATCH_REACT_ADAPTER_MODULE_ID = `\0${SPOTPATCH_REACT_ADAPTER_MODULE_ID}`;
export const SPOTPATCH_DATA_FLOW_MODULE_ID = "virtual:spotpatch/data-flow-runtime";
export const RESOLVED_SPOTPATCH_DATA_FLOW_MODULE_ID = `\0${SPOTPATCH_DATA_FLOW_MODULE_ID}`;
export const SPOTPATCH_DATA_FLOW_PANEL_MODULE_ID = "virtual:spotpatch/data-flow-panel";
export const RESOLVED_SPOTPATCH_DATA_FLOW_PANEL_MODULE_ID = `\0${SPOTPATCH_DATA_FLOW_PANEL_MODULE_ID}`;

interface RuntimeInjectionPluginInput {
  readonly clientBundle?: string;
  readonly context: SpotPatchPluginContext;
  readonly dataFlowPreludeBundle?: string;
  readonly dataFlowPanelBundle?: string;
  readonly reactAdapterBundle?: string;
  readonly session: SpotPatchSession;
}

function createDataFlowPreludeModule(
  input: RuntimeInjectionPluginInput,
  bundle: string,
): string {
  return [
    `const __SPOTPATCH_DATA_FLOW_CONFIG__ = ${JSON.stringify(input.context.getOptions().dataFlow)};`,
    bundle,
  ].join("\n");
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
    dataFlow: createRuntimeDataFlowConfig(options.dataFlow),
    debug: options.debug,
    editor: options.editor,
    framework: "vite" as const,
    frameworkVersion: viteVersion,
    locale: options.locale,
    maxTargets: options.maxTargets,
    redact: options.redact,
    sessionId: input.session.id,
    sessionToken: input.session.token,
    shortcut: options.shortcut,
    spotPatchVersion: packageMetadata.version,
  };

  return [
    ...(options.dataFlow.enabled
      ? [`import ${JSON.stringify(SPOTPATCH_DATA_FLOW_PANEL_MODULE_ID)};`]
      : []),
    `const __SPOTPATCH_BRAND_MARK_CONTENT__ = ${JSON.stringify(BRAND_MARK_CONTENT)};`,
    `const __SPOTPATCH_RUNTIME_CONFIG__ = ${JSON.stringify(runtimeConfig)};`,
    clientBundle,
  ].join("\n");
}

export function createRuntimeInjectionPlugin(
  input: RuntimeInjectionPluginInput,
): Plugin {
  let root = process.cwd();
  let clientBundle = input.clientBundle;
  let dataFlowPreludeBundle = input.dataFlowPreludeBundle;
  let dataFlowPanelBundle = input.dataFlowPanelBundle;
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

      if (id === SPOTPATCH_DATA_FLOW_MODULE_ID) {
        return RESOLVED_SPOTPATCH_DATA_FLOW_MODULE_ID;
      }

      if (id === SPOTPATCH_DATA_FLOW_PANEL_MODULE_ID) {
        return RESOLVED_SPOTPATCH_DATA_FLOW_PANEL_MODULE_ID;
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

      if (id === RESOLVED_SPOTPATCH_DATA_FLOW_MODULE_ID) {
        if (!input.context.getOptions().dataFlow.enabled) return null;
        dataFlowPreludeBundle ??= readRuntimeBundle(
          root,
          "runtime-data-flow-prelude.js",
        );
        return createDataFlowPreludeModule(input, dataFlowPreludeBundle);
      }

      if (id === RESOLVED_SPOTPATCH_DATA_FLOW_PANEL_MODULE_ID) {
        if (!input.context.getOptions().dataFlow.enabled) return null;
        dataFlowPanelBundle ??= readRuntimeBundle(root, "runtime-data-flow-panel.js");
        return dataFlowPanelBundle;
      }

      return null;
    },

    transformIndexHtml() {
      const client = {
        tag: "script",
        attrs: {
          type: "module",
          src: `/@id/${SPOTPATCH_CLIENT_MODULE_ID}`,
        },
        injectTo: "head" as const,
      };
      if (!input.context.getOptions().dataFlow.enabled) {
        return [client];
      }

      return [
        {
          tag: "script",
          attrs: {
            type: "module",
            src: `/@id/${SPOTPATCH_DATA_FLOW_MODULE_ID}`,
          },
          injectTo: "head-prepend" as const,
        },
        client,
      ];
    },
  };
}
