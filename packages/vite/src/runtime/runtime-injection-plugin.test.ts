import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { SPOTPATCH_API_BASE } from "@spotpatch/shared";
import {
  resolveOptions,
  type ResolvedSpotPatchOptions,
  type SpotPatchSession,
} from "@spotpatch/dev-server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { version as VITE_VERSION } from "vite";

import packageMetadata from "../../package.json" with { type: "json" };
import type { SpotPatchPluginContext } from "../plugin-context.js";
import {
  createRuntimeInjectionPlugin,
  RESOLVED_SPOTPATCH_DATA_FLOW_MODULE_ID,
  RESOLVED_SPOTPATCH_DATA_FLOW_PANEL_MODULE_ID,
  RESOLVED_SPOTPATCH_EXTERNAL_HANDOFF_PANEL_MODULE_ID,
  RESOLVED_SPOTPATCH_REACT_ADAPTER_MODULE_ID,
  RESOLVED_SPOTPATCH_CLIENT_MODULE_ID,
  SPOTPATCH_CLIENT_MODULE_ID,
  SPOTPATCH_DATA_FLOW_MODULE_ID,
  SPOTPATCH_DATA_FLOW_PANEL_MODULE_ID,
  SPOTPATCH_EXTERNAL_HANDOFF_PANEL_MODULE_ID,
} from "./runtime-injection-plugin.js";
import { BRAND_MARK_CONTENT } from "./brand-mark-content.js";

const session = Object.freeze({
  id: "browser-session-id-0000",
  token: "browser-session-token",
}) satisfies SpotPatchSession;

const clientBundle = [
  "const SPOTPATCH_API_BASE = globalThis.__spotpatchTestApiBase;",
  "void __SPOTPATCH_RUNTIME_CONFIG__;",
].join("\n");
const reactAdapterBundle = "export function createReact18Adapter() {}";
const dataFlowPreludeBundle = "export const dataFlowRuntime = {};";
const dataFlowPanelBundle = "globalThis.__spotpatchPanelInstalled = true;";
const externalHandoffPanelBundle =
  "globalThis.__spotpatchExternalHandoffInstalled = true;";
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createContext(options: ResolvedSpotPatchOptions): SpotPatchPluginContext {
  return Object.freeze({
    getCredentialEnvironment: () => Object.freeze({}),
    getOptions: () => options,
  });
}

describe("runtime injection plugin", () => {
  it("injects the development virtual client module", () => {
    const plugin = createRuntimeInjectionPlugin({
      context: createContext(resolveOptions()),
      session,
      clientBundle,
      reactAdapterBundle,
    });

    const hook = plugin.transformIndexHtml;
    expect(hook).toBeTypeOf("function");

    if (typeof hook !== "function") {
      throw new Error("Expected a transformIndexHtml hook.");
    }

    expect(hook.call({} as never, "", {} as never)).toEqual([
      {
        tag: "script",
        attrs: {
          type: "module",
          src: `/@id/${SPOTPATCH_CLIENT_MODULE_ID}`,
        },
        injectTo: "head",
      },
    ]);
  });

  it("keeps absolute paths and executable commands out of browser configuration", () => {
    const plugin = createRuntimeInjectionPlugin({
      context: createContext(resolveOptions({ shortcut: "Alt+S" })),
      session,
      clientBundle,
      reactAdapterBundle,
    });

    const hook = plugin.load;

    if (typeof hook !== "function") {
      throw new Error("Expected a load hook.");
    }

    const code = hook.call({} as never, RESOLVED_SPOTPATCH_CLIENT_MODULE_ID) as string;

    expect(code).toContain('"sessionId":"browser-session-id-0000"');
    expect(code).toContain("browser-session-token");
    expect(code).toContain("Alt+S");
    expect(code).toContain(`"spotPatchVersion":"${packageMetadata.version}"`);
    expect(code).toContain('"framework":"vite"');
    expect(code).toContain(`"frameworkVersion":"${VITE_VERSION}"`);
    expect(code).toContain('"locale":"auto"');
    expect(code).toContain('"editor":"auto"');
    expect(code).toContain('"maxTargets":8');
    expect(code).toContain('"externalAgent":{"enabled":false}');
    expect(code).not.toContain(SPOTPATCH_EXTERNAL_HANDOFF_PANEL_MODULE_ID);
    expect(code).toContain("SPOTPATCH_API_BASE");
    expect(code).toContain("__SPOTPATCH_BRAND_MARK_CONTENT__");
    expect(code).toContain(JSON.stringify(BRAND_MARK_CONTENT));
    expect(code).not.toContain(SPOTPATCH_API_BASE);
    expect(code).not.toContain(process.cwd());
    expect(code).not.toContain('"root"');
  });

  it("injects an explicit locale without relying on the consumer app runtime", () => {
    const plugin = createRuntimeInjectionPlugin({
      context: createContext(resolveOptions({ locale: "zh-CN" })),
      session,
      clientBundle,
      reactAdapterBundle,
    });
    const hook = plugin.load;

    if (typeof hook !== "function") {
      throw new Error("Expected a load hook.");
    }

    const code = hook.call({} as never, RESOLVED_SPOTPATCH_CLIENT_MODULE_ID) as string;
    expect(code).toContain('"locale":"zh-CN"');
  });

  it("injects only the allowlisted editor preference", () => {
    const plugin = createRuntimeInjectionPlugin({
      context: createContext(resolveOptions({ editor: "cursor" })),
      session,
      clientBundle,
      reactAdapterBundle,
    });
    const hook = plugin.load;

    if (typeof hook !== "function") {
      throw new Error("Expected a load hook.");
    }

    const code = hook.call({} as never, RESOLVED_SPOTPATCH_CLIENT_MODULE_ID) as string;
    expect(code).toContain('"editor":"cursor"');
  });

  it("injects only allowlisted AI profile labels and ids", () => {
    const plugin = createRuntimeInjectionPlugin({
      context: createContext(
        resolveOptions({
          ai: {
            providers: {
              relay: {
                type: "openai-compatible",
                label: "Team relay",
                protocol: "chat-completions",
                baseURL: "https://private-relay.example/v1",
                apiKeyEnv: "SPOTPATCH_AI_API_KEY",
                models: {
                  coding: { label: "Coding model", model: "secret-model-name" },
                },
                defaultModel: "coding",
              },
            },
            defaultProvider: "relay",
            execution: {
              checks: {
                lint: { label: "Lint", command: "pnpm", args: ["lint"] },
              },
            },
          },
        }),
      ),
      session,
      clientBundle,
      reactAdapterBundle,
    });
    const hook = plugin.load;

    if (typeof hook !== "function") {
      throw new Error("Expected a load hook.");
    }

    const code = hook.call({} as never, RESOLVED_SPOTPATCH_CLIENT_MODULE_ID) as string;

    expect(code).toContain('"label":"Team relay"');
    expect(code).toContain('"label":"Coding model"');
    expect(code).toContain('"id":"relay"');
    expect(code).not.toContain("private-relay.example");
    expect(code).not.toContain("SPOTPATCH_AI_API_KEY");
    expect(code).not.toContain("secret-model-name");
    expect(code).not.toContain('"command":"pnpm"');
  });

  it("resolves only its exact public virtual id", () => {
    const plugin = createRuntimeInjectionPlugin({
      context: createContext(resolveOptions()),
      session,
      clientBundle,
      reactAdapterBundle,
    });

    const hook = plugin.resolveId;

    if (typeof hook !== "function") {
      throw new Error("Expected a resolveId hook.");
    }

    expect(
      hook.call({} as never, SPOTPATCH_CLIENT_MODULE_ID, undefined, {} as never),
    ).toBe(RESOLVED_SPOTPATCH_CLIENT_MODULE_ID);
    expect(
      hook.call(
        {} as never,
        "@spotpatch/react-adapter",
        RESOLVED_SPOTPATCH_CLIENT_MODULE_ID,
        {} as never,
      ),
    ).toBe(RESOLVED_SPOTPATCH_REACT_ADAPTER_MODULE_ID);
    expect(
      hook.call(
        {} as never,
        "@spotpatch/react-adapter",
        "/src/application.tsx",
        {} as never,
      ),
    ).toBeNull();
    expect(hook.call({} as never, "virtual:other", undefined, {} as never)).toBeNull();
  });

  it("serves the isolated React adapter bundle only through its private id", () => {
    const plugin = createRuntimeInjectionPlugin({
      context: createContext(resolveOptions()),
      session,
      clientBundle,
      reactAdapterBundle,
    });
    const hook = plugin.load;

    if (typeof hook !== "function") {
      throw new Error("Expected a load hook.");
    }

    expect(hook.call({} as never, RESOLVED_SPOTPATCH_REACT_ADAPTER_MODULE_ID)).toBe(
      reactAdapterBundle,
    );
    expect(hook.call({} as never, "\0virtual:other")).toBeNull();
  });

  it("prepends and serves the data-flow prelude only when explicitly enabled", () => {
    const plugin = createRuntimeInjectionPlugin({
      context: createContext(resolveOptions({ dataFlow: {} })),
      session,
      clientBundle,
      reactAdapterBundle,
      dataFlowPreludeBundle,
      dataFlowPanelBundle,
    });
    const htmlHook = plugin.transformIndexHtml;
    const resolveHook = plugin.resolveId;
    const loadHook = plugin.load;
    if (
      typeof htmlHook !== "function" ||
      typeof resolveHook !== "function" ||
      typeof loadHook !== "function"
    ) {
      throw new Error("Expected runtime injection hooks.");
    }

    expect(htmlHook.call({} as never, "", {} as never)).toMatchObject([
      {
        attrs: { src: `/@id/${SPOTPATCH_DATA_FLOW_MODULE_ID}` },
        injectTo: "head-prepend",
      },
      { attrs: { src: `/@id/${SPOTPATCH_CLIENT_MODULE_ID}` }, injectTo: "head" },
    ]);
    expect(
      resolveHook.call(
        {} as never,
        SPOTPATCH_DATA_FLOW_MODULE_ID,
        undefined,
        {} as never,
      ),
    ).toBe(RESOLVED_SPOTPATCH_DATA_FLOW_MODULE_ID);
    const module = loadHook.call(
      {} as never,
      RESOLVED_SPOTPATCH_DATA_FLOW_MODULE_ID,
    ) as string;
    expect(module).toContain('"enabled":true');
    expect(module).toContain(dataFlowPreludeBundle);
    expect(
      resolveHook.call(
        {} as never,
        SPOTPATCH_DATA_FLOW_PANEL_MODULE_ID,
        RESOLVED_SPOTPATCH_CLIENT_MODULE_ID,
        {} as never,
      ),
    ).toBe(RESOLVED_SPOTPATCH_DATA_FLOW_PANEL_MODULE_ID);
    expect(
      loadHook.call({} as never, RESOLVED_SPOTPATCH_DATA_FLOW_PANEL_MODULE_ID),
    ).toBe(dataFlowPanelBundle);
    const client = loadHook.call(
      {} as never,
      RESOLVED_SPOTPATCH_CLIENT_MODULE_ID,
    ) as string;
    expect(client).toContain(
      `import ${JSON.stringify(SPOTPATCH_DATA_FLOW_PANEL_MODULE_ID)}`,
    );
  });

  it("serves the external handoff UI bundle only when explicitly enabled", () => {
    const plugin = createRuntimeInjectionPlugin({
      context: createContext(resolveOptions({ externalAgent: true })),
      session,
      clientBundle,
      reactAdapterBundle,
      externalHandoffPanelBundle,
    });
    const resolveHook = plugin.resolveId;
    const loadHook = plugin.load;

    if (typeof resolveHook !== "function" || typeof loadHook !== "function") {
      throw new Error("Expected runtime injection hooks.");
    }

    expect(
      resolveHook.call(
        {} as never,
        SPOTPATCH_EXTERNAL_HANDOFF_PANEL_MODULE_ID,
        RESOLVED_SPOTPATCH_CLIENT_MODULE_ID,
        {} as never,
      ),
    ).toBe(RESOLVED_SPOTPATCH_EXTERNAL_HANDOFF_PANEL_MODULE_ID);
    expect(
      loadHook.call({} as never, RESOLVED_SPOTPATCH_EXTERNAL_HANDOFF_PANEL_MODULE_ID),
    ).toBe(externalHandoffPanelBundle);
    const client = loadHook.call(
      {} as never,
      RESOLVED_SPOTPATCH_CLIENT_MODULE_ID,
    ) as string;
    expect(client).toContain(
      `import ${JSON.stringify(SPOTPATCH_EXTERNAL_HANDOFF_PANEL_MODULE_ID)}`,
    );
    expect(client).toContain('"externalAgent":{"enabled":true}');
  });

  it("invalidates changed runtime bundles and releases its watcher on shutdown", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "spotpatch-runtime-bundle-"));
    temporaryDirectories.push(root);
    const bundlePath = path.join(root, "runtime-client.js");
    const initialBundle = "globalThis.__spotpatchBundleVersion = 'initial';";
    const updatedBundle = "globalThis.__spotpatchBundleVersion = 'updated';";
    writeFileSync(bundlePath, initialBundle, "utf8");

    const plugin = createRuntimeInjectionPlugin({
      bundlePaths: { client: bundlePath },
      context: createContext(resolveOptions()),
      session,
      reactAdapterBundle,
    });
    const configureServerHook = plugin.configureServer;
    const loadHook = plugin.load;
    if (typeof configureServerHook !== "function" || typeof loadHook !== "function") {
      throw new Error("Expected runtime server and load hooks.");
    }

    const watcher = Object.assign(new EventEmitter(), { add: vi.fn() });
    const httpServer = new EventEmitter();
    const virtualModule = Object.freeze({ id: RESOLVED_SPOTPATCH_CLIENT_MODULE_ID });
    const getModuleById = vi.fn(() => virtualModule);
    const invalidateModule = vi.fn();
    const send = vi.fn();
    await configureServerHook.call(
      {} as never,
      {
        httpServer,
        moduleGraph: { getModuleById, invalidateModule },
        watcher,
        ws: { send },
      } as never,
    );

    expect(watcher.add).toHaveBeenCalledWith([bundlePath]);
    expect(loadHook.call({} as never, RESOLVED_SPOTPATCH_CLIENT_MODULE_ID)).toContain(
      initialBundle,
    );

    watcher.emit("change", path.join(root, "unrelated.js"));
    expect(send).not.toHaveBeenCalled();

    writeFileSync(bundlePath, updatedBundle, "utf8");
    watcher.emit("change", bundlePath);
    watcher.emit("change", bundlePath);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(getModuleById).toHaveBeenCalledWith(RESOLVED_SPOTPATCH_CLIENT_MODULE_ID);
    expect(invalidateModule).toHaveBeenCalledWith(virtualModule);
    expect(send).toHaveBeenCalledWith({ type: "full-reload", path: "*" });
    expect(loadHook.call({} as never, RESOLVED_SPOTPATCH_CLIENT_MODULE_ID)).toContain(
      updatedBundle,
    );

    watcher.emit("change", bundlePath);
    httpServer.emit("close");
    watcher.emit("change", bundlePath);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
