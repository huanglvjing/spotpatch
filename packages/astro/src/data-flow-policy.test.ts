// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { createAstroDataFlowPolicy } from "./data-flow-policy.js";

describe("Astro navigation observation policy", () => {
  it("excludes only the current navigation request, not business traffic to the same URL", async () => {
    const { policy, dispose } = createAstroDataFlowPolicy(document);
    const to = new URL("https://app.test/models/next");
    const signal = new AbortController().signal;
    const observe = (init?: RequestInit) =>
      policy.shouldObserveFetch?.(to, init, "https://app.test/");
    const loader = vi.fn(() => {
      expect(observe({ signal })).toBe(false);
      expect(observe()).toBe(true);
      expect(observe({ signal: new AbortController().signal })).toBe(true);
      expect(policy.shouldObserveFetch?.("/business", { signal }, to.href)).toBe(true);
      return Promise.resolve();
    });
    const event = Object.assign(new Event("astro:before-preparation"), {
      loader,
      to,
      signal,
    });
    document.dispatchEvent(event);
    await event.loader();
    expect(loader).toHaveBeenCalledOnce();
    expect(observe({ signal })).toBe(true);
    dispose();
    const after = Object.assign(new Event("astro:before-preparation"), {
      loader,
      to,
      signal,
    });
    document.dispatchEvent(after);
    expect(after.loader).toBe(loader);
  });

  it("clears navigation state when a loader aborts or fails", async () => {
    const { policy, dispose } = createAstroDataFlowPolicy(document);
    const to = new URL("https://app.test/next");
    const signal = new AbortController().signal;
    const event = Object.assign(new Event("astro:before-preparation"), {
      loader: () => Promise.reject(new Error("aborted")),
      to,
      signal,
    });
    document.dispatchEvent(event);
    await expect(event.loader()).rejects.toThrow("aborted");
    expect(policy.shouldObserveFetch?.(to, { signal }, to.href)).toBe(true);
    dispose();
  });
});
