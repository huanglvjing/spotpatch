import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import {
  createRuntimeAiConfig,
  createRuntimeDataFlowConfig,
  type ResolvedSpotPatchOptions,
  type SpotPatchSession,
} from "@spotpatch/dev-server";
import { SPOTPATCH_API_BASE, type SpotPatchRuntimeConfig } from "@spotpatch/shared";
import type { Plugin, ViteDevServer } from "vite";

import metadata from "../package.json" with { type: "json" };

export const ASTRO_CLIENT_MODULE_ID = "virtual:spotpatch/astro-client";
export const ASTRO_DATA_FLOW_MODULE_ID = "virtual:spotpatch/astro-data-flow";
const RESOLVED_CLIENT_MODULE_ID = `\0${ASTRO_CLIENT_MODULE_ID}`;

const FEATURES = [
  {
    id: ASTRO_DATA_FLOW_MODULE_ID,
    file: "runtime-data-flow.js",
    enabled: (options: ResolvedSpotPatchOptions) => options.dataFlow.enabled,
  },
  {
    id: "virtual:spotpatch/astro-motion",
    file: "runtime-motion.js",
    enabled: () => true,
  },
  {
    id: "virtual:spotpatch/astro-data-flow-panel",
    file: "runtime-data-flow-panel.js",
    enabled: (options: ResolvedSpotPatchOptions) => options.dataFlow.enabled,
  },
  {
    id: "virtual:spotpatch/astro-external-handoff",
    file: "runtime-external-handoff.js",
    enabled: (options: ResolvedSpotPatchOptions) => options.externalAgent.enabled,
  },
  {
    id: "virtual:spotpatch/astro-contextual-ask",
    file: "runtime-contextual-ask.js",
    enabled: (options: ResolvedSpotPatchOptions) => options.contextualAsk.enabled,
  },
] as const;

export function createAstroRuntimePlugin(input: {
  readonly options: () => ResolvedSpotPatchOptions;
  readonly session: SpotPatchSession;
  readonly astroVersion: string;
  readonly root: string;
}): Plugin {
  const bundles = new Map<string, string>();
  const bundlePaths = new Map<string, string>();
  let server: ViteDevServer | undefined;
  let stopWatching: (() => void) | undefined;
  async function readBundle(file: string): Promise<string> {
    const cached = bundles.get(file);
    if (cached !== undefined) return cached;
    const fromHost = createRequire(path.join(input.root, "package.json"));
    const absolutePath = path.join(
      path.dirname(fromHost.resolve("@spotpatch/astro")),
      file,
    );
    const code = await readFile(absolutePath, "utf8");
    bundlePaths.set(absolutePath, file);
    server?.watcher.add(absolutePath);
    bundles.set(file, code);
    return code;
  }
  return {
    name: "spotpatch:astro:runtime",
    apply: "serve",
    configureServer(activeServer) {
      server = activeServer;
      const changed = (absolutePath: string): void => {
        const file = bundlePaths.get(absolutePath);
        if (file === undefined) return;
        bundles.delete(file);
        activeServer.moduleGraph.invalidateAll();
        activeServer.ws.send({ type: "full-reload" });
      };
      activeServer.watcher.on("change", changed);
      stopWatching = () => {
        activeServer.watcher.off("change", changed);
      };
    },
    closeBundle() {
      stopWatching?.();
      server = undefined;
      bundles.clear();
      bundlePaths.clear();
    },
    resolveId(id) {
      return id === ASTRO_CLIENT_MODULE_ID ||
        FEATURES.some((feature) => feature.id === id)
        ? `\0${id}`
        : null;
    },
    async load(id) {
      const options = input.options();
      const feature = FEATURES.find((candidate) => `\0${candidate.id}` === id);
      if (feature !== undefined) {
        if (!feature.enabled(options)) return null;
        const prefix =
          feature.id === ASTRO_DATA_FLOW_MODULE_ID
            ? `const __SPOTPATCH_DATA_FLOW_CONFIG__ = ${JSON.stringify(createRuntimeDataFlowConfig(options.dataFlow))};\n`
            : "";
        return prefix + (await readBundle(feature.file));
      }
      if (id !== RESOLVED_CLIENT_MODULE_ID) return null;
      const config = {
        apiBase: SPOTPATCH_API_BASE,
        ai: createRuntimeAiConfig(options.ai),
        budget: options.budget,
        contextualAsk: { enabled: options.contextualAsk.enabled },
        dataFlow: createRuntimeDataFlowConfig(options.dataFlow),
        debug: options.debug,
        editor: options.editor,
        externalAgent: options.externalAgent,
        framework: "astro",
        frameworkVersion: input.astroVersion,
        locale: options.locale,
        maxTargets: options.maxTargets,
        redact: options.redact,
        sessionId: input.session.id,
        sessionToken: input.session.token,
        shortcut: options.shortcut,
        spotPatchVersion: metadata.version,
      } satisfies SpotPatchRuntimeConfig;
      const imports = FEATURES.filter((feature) => feature.enabled(options))
        .map((feature) => `import ${JSON.stringify(feature.id)};`)
        .join("\n");
      return `${imports}\nconst __SPOTPATCH_ASTRO_CONFIG__ = ${JSON.stringify(config)};\n${await readBundle("client.js")}`;
    },
  };
}
