import { SPOTPATCH_API_BASE } from "@spotpatch/shared";
import { describe, expect, it } from "vitest";
import { version as VITE_VERSION } from "vite";

import packageMetadata from "../../package.json" with { type: "json" };
import { resolveOptions, type ResolvedSpotPatchOptions } from "../options.js";
import type { SpotPatchPluginContext } from "../plugin-context.js";
import type { SpotPatchSession } from "../session/session.js";
import {
  createRuntimeInjectionPlugin,
  RESOLVED_SPOTPATCH_REACT_ADAPTER_MODULE_ID,
  RESOLVED_SPOTPATCH_CLIENT_MODULE_ID,
  SPOTPATCH_CLIENT_MODULE_ID,
} from "./runtime-injection-plugin.js";

const session = Object.freeze({
  token: "browser-session-token",
}) satisfies SpotPatchSession;

const clientBundle = [
  "const SPOTPATCH_API_BASE = globalThis.__spotpatchTestApiBase;",
  "void __SPOTPATCH_RUNTIME_CONFIG__;",
].join("\n");
const reactAdapterBundle = "export function createReact18Adapter() {}";

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

  it("keeps absolute paths and editor commands out of browser configuration", () => {
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

    expect(code).toContain("browser-session-token");
    expect(code).toContain("Alt+S");
    expect(code).toContain(`"spotPatchVersion":"${packageMetadata.version}"`);
    expect(code).toContain(`"viteVersion":"${VITE_VERSION}"`);
    expect(code).toContain('"locale":"auto"');
    expect(code).toContain('"maxTargets":8');
    expect(code).toContain("SPOTPATCH_API_BASE");
    expect(code).not.toContain(SPOTPATCH_API_BASE);
    expect(code).not.toContain(process.cwd());
    expect(code).not.toContain('"editor"');
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
});
