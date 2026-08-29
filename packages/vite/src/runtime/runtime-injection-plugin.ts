import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import {
  createRuntimeAiConfig,
  createRuntimeDataFlowConfig,
  type ResolvedSpotPatchOptions,
  type SpotPatchSession,
} from "@spotpatch/dev-server";
import packageMetadata from "../../package.json" with { type: "json" };
import { version as VITE_VERSION, type Plugin, type ViteDevServer } from "vite";

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
export const SPOTPATCH_EXTERNAL_HANDOFF_PANEL_MODULE_ID =
  "virtual:spotpatch/external-handoff-panel";
export const RESOLVED_SPOTPATCH_EXTERNAL_HANDOFF_PANEL_MODULE_ID = `\0${SPOTPATCH_EXTERNAL_HANDOFF_PANEL_MODULE_ID}`;

const RUNTIME_BUNDLE_NAMES = [
  "client",
  "dataFlowPanel",
  "dataFlowPrelude",
  "externalHandoffPanel",
  "reactAdapter",
] as const;

type RuntimeBundleName = (typeof RUNTIME_BUNDLE_NAMES)[number];

interface RuntimeBundleDefinition {
  readonly enabled: (options: ResolvedSpotPatchOptions) => boolean;
  readonly fileName: string;
  readonly importer?: string;
  readonly publicId: string;
  readonly resolvedId: string;
}

interface RuntimeBundleState {
  cached?: string;
  readonly injected?: string;
  path?: string;
}

const RUNTIME_BUNDLE_DEFINITIONS: Readonly<
  Record<RuntimeBundleName, RuntimeBundleDefinition>
> = Object.freeze({
  client: {
    enabled: () => true,
    fileName: "runtime-client.js",
    publicId: SPOTPATCH_CLIENT_MODULE_ID,
    resolvedId: RESOLVED_SPOTPATCH_CLIENT_MODULE_ID,
  },
  dataFlowPanel: {
    enabled: (options) => options.dataFlow.enabled,
    fileName: "runtime-data-flow-panel.js",
    publicId: SPOTPATCH_DATA_FLOW_PANEL_MODULE_ID,
    resolvedId: RESOLVED_SPOTPATCH_DATA_FLOW_PANEL_MODULE_ID,
  },
  dataFlowPrelude: {
    enabled: (options) => options.dataFlow.enabled,
    fileName: "runtime-data-flow-prelude.js",
    publicId: SPOTPATCH_DATA_FLOW_MODULE_ID,
    resolvedId: RESOLVED_SPOTPATCH_DATA_FLOW_MODULE_ID,
  },
  externalHandoffPanel: {
    enabled: (options) => options.externalAgent.enabled,
    fileName: "runtime-external-handoff-panel.js",
    publicId: SPOTPATCH_EXTERNAL_HANDOFF_PANEL_MODULE_ID,
    resolvedId: RESOLVED_SPOTPATCH_EXTERNAL_HANDOFF_PANEL_MODULE_ID,
  },
  reactAdapter: {
    enabled: () => true,
    fileName: "runtime-react-adapter.js",
    importer: RESOLVED_SPOTPATCH_CLIENT_MODULE_ID,
    publicId: "@spotpatch/react-adapter",
    resolvedId: RESOLVED_SPOTPATCH_REACT_ADAPTER_MODULE_ID,
  },
});

interface RuntimeInjectionPluginInput {
  readonly bundlePaths?: Partial<Readonly<Record<RuntimeBundleName, string>>>;
  readonly clientBundle?: string;
  readonly context: SpotPatchPluginContext;
  readonly dataFlowPreludeBundle?: string;
  readonly dataFlowPanelBundle?: string;
  readonly externalHandoffPanelBundle?: string;
  readonly reactAdapterBundle?: string;
  readonly session: SpotPatchSession;
}

function createBundleState(injected: string | undefined): RuntimeBundleState {
  return injected === undefined ? {} : { injected };
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

function resolveRuntimeBundlePath(root: string, fileName: string): string {
  const resolveFromProject = createRequire(path.join(root, "package.json"));
  const packageEntry = resolveFromProject.resolve("@spotpatch/vite");
  return path.join(path.dirname(packageEntry), fileName);
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
    externalAgent: options.externalAgent,
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
    ...(options.externalAgent.enabled
      ? [`import ${JSON.stringify(SPOTPATCH_EXTERNAL_HANDOFF_PANEL_MODULE_ID)};`]
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
  let viteVersion = VITE_VERSION;
  let disposeWatcher: (() => void) | undefined;
  const bundleStates: Record<RuntimeBundleName, RuntimeBundleState> = {
    client: createBundleState(input.clientBundle),
    dataFlowPanel: createBundleState(input.dataFlowPanelBundle),
    dataFlowPrelude: createBundleState(input.dataFlowPreludeBundle),
    externalHandoffPanel: createBundleState(input.externalHandoffPanelBundle),
    reactAdapter: createBundleState(input.reactAdapterBundle),
  };

  function getBundlePath(name: RuntimeBundleName): string {
    const state = bundleStates[name];
    state.path ??= path.resolve(
      input.bundlePaths?.[name] ??
        resolveRuntimeBundlePath(root, RUNTIME_BUNDLE_DEFINITIONS[name].fileName),
    );
    return state.path;
  }

  function loadBundle(name: RuntimeBundleName): string {
    const state = bundleStates[name];
    if (state.injected !== undefined) return state.injected;
    state.cached ??= readFileSync(getBundlePath(name), "utf8");
    return state.cached;
  }

  function stopWatching(): void {
    disposeWatcher?.();
  }

  function watchRuntimeBundles(server: ViteDevServer): void {
    stopWatching();
    const options = input.context.getOptions();
    const bundleNameByPath = new Map<string, RuntimeBundleName>();

    for (const name of RUNTIME_BUNDLE_NAMES) {
      if (
        RUNTIME_BUNDLE_DEFINITIONS[name].enabled(options) &&
        bundleStates[name].injected === undefined
      ) {
        bundleNameByPath.set(getBundlePath(name), name);
      }
    }

    const bundlePaths = [...bundleNameByPath.keys()];
    if (bundlePaths.length === 0) return;

    let reloadHandle: NodeJS.Immediate | undefined;
    const scheduleReload = (): void => {
      reloadHandle ??= setImmediate(() => {
        reloadHandle = undefined;
        server.ws.send({ type: "full-reload", path: "*" });
      });
    };

    const handleChange = (changedPath: string): void => {
      const name = bundleNameByPath.get(path.resolve(changedPath));
      if (name === undefined) return;

      delete bundleStates[name].cached;
      const module = server.moduleGraph.getModuleById(
        RUNTIME_BUNDLE_DEFINITIONS[name].resolvedId,
      );
      if (module !== undefined) {
        server.moduleGraph.invalidateModule(module);
      }
      scheduleReload();
    };
    const dispose = (): void => {
      if (reloadHandle !== undefined) {
        clearImmediate(reloadHandle);
        reloadHandle = undefined;
      }
      server.watcher.off("change", handleChange);
      server.httpServer?.off("close", dispose);
      if (disposeWatcher === dispose) disposeWatcher = undefined;
    };

    server.watcher.add(bundlePaths);
    server.watcher.on("change", handleChange);
    server.httpServer?.once("close", dispose);
    disposeWatcher = dispose;
  }

  return {
    name: "spotpatch:runtime-injection",
    apply: "serve",
    enforce: "pre",

    configResolved(config) {
      root = path.resolve(config.root);
      viteVersion = readConsumerViteVersion(root);
    },

    configureServer(server) {
      watchRuntimeBundles(server);
    },

    resolveId(id, importer) {
      for (const name of RUNTIME_BUNDLE_NAMES) {
        const definition = RUNTIME_BUNDLE_DEFINITIONS[name];
        if (
          id === definition.publicId &&
          (definition.importer === undefined || importer === definition.importer)
        ) {
          return definition.resolvedId;
        }
      }
      return null;
    },

    load(id) {
      for (const name of RUNTIME_BUNDLE_NAMES) {
        const definition = RUNTIME_BUNDLE_DEFINITIONS[name];
        if (id !== definition.resolvedId) continue;
        if (!definition.enabled(input.context.getOptions())) return null;

        const bundle = loadBundle(name);
        if (name === "client") {
          return createClientModule(input, bundle, viteVersion);
        }
        if (name === "dataFlowPrelude") {
          return createDataFlowPreludeModule(input, bundle);
        }
        return bundle;
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

    closeBundle() {
      stopWatching();
    },
  };
}
