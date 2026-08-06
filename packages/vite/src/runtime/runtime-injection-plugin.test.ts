import { SPOTPATCH_API_BASE } from "@spotpatch/shared";
import { describe, expect, it } from "vitest";
import { version as VITE_VERSION } from "vite";

import { resolveOptions } from "../options.js";
import type { SpotPatchSession } from "../session/session.js";
import {
  createRuntimeInjectionPlugin,
  RESOLVED_SPOTPATCH_CLIENT_MODULE_ID,
  SPOTPATCH_CLIENT_MODULE_ID,
} from "./runtime-injection-plugin.js";

const session = Object.freeze({
  token: "browser-session-token",
}) satisfies SpotPatchSession;

const clientBundle = [
  "const SPOTPATCH_API_BASE = globalThis.__spotpatchTestApiBase;",
  "function bootstrapSpotPatch() {}",
].join("\n");

describe("runtime injection plugin", () => {
  it("injects the development virtual client module", () => {
    const plugin = createRuntimeInjectionPlugin({
      options: resolveOptions(),
      session,
      clientBundle,
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
      options: resolveOptions({ shortcut: "Alt+S" }),
      session,
      clientBundle,
    });

    const hook = plugin.load;

    if (typeof hook !== "function") {
      throw new Error("Expected a load hook.");
    }

    const code = hook.call({} as never, RESOLVED_SPOTPATCH_CLIENT_MODULE_ID) as string;

    expect(code).toContain("browser-session-token");
    expect(code).toContain("Alt+S");
    expect(code).toContain('"spotPatchVersion":"0.0.0"');
    expect(code).toContain(`"viteVersion":"${VITE_VERSION}"`);
    expect(code).toContain("SPOTPATCH_API_BASE");
    expect(code).not.toContain(SPOTPATCH_API_BASE);
    expect(code).not.toContain(process.cwd());
    expect(code).not.toContain('"editor"');
    expect(code).not.toContain('"root"');
  });

  it("resolves only its exact public virtual id", () => {
    const plugin = createRuntimeInjectionPlugin({
      options: resolveOptions(),
      session,
      clientBundle,
    });

    const hook = plugin.resolveId;

    if (typeof hook !== "function") {
      throw new Error("Expected a resolveId hook.");
    }

    expect(
      hook.call({} as never, SPOTPATCH_CLIENT_MODULE_ID, undefined, {} as never),
    ).toBe(RESOLVED_SPOTPATCH_CLIENT_MODULE_ID);
    expect(hook.call({} as never, "virtual:other", undefined, {} as never)).toBeNull();
  });
});
