// @vitest-environment jsdom

import type { ReactDevToolsGlobalHook, ReactRenderer } from "bippy";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBippyBridge } from "./bippy-bridge.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Bippy fiber bridge", () => {
  it("uses renderers registered on a separately installed global hook", () => {
    const element = document.createElement("button");
    const fiber = Object.freeze({ marker: "fiber" });
    const renderer = {
      findFiberByHostInstance: (candidate: unknown) =>
        candidate === element ? fiber : null,
      reconcilerVersion: "19.2.8",
    } as ReactRenderer;
    const hook = {
      renderers: new Map([[1, renderer]]),
    } as ReactDevToolsGlobalHook;
    vi.stubGlobal("__REACT_DEVTOOLS_GLOBAL_HOOK__", hook);

    expect(createBippyBridge().find(element)).toEqual({
      node: fiber,
      version: "19.2.8",
    });
  });
});
