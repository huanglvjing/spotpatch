import type { AstroIntegration } from "astro";
import { describe, expect, it, vi } from "vitest";

import { spotPatch } from "./integration.js";
import { resolveOptions } from "@spotpatch/dev-server";

type SetupHook = NonNullable<AstroIntegration["hooks"]["astro:config:setup"]>;

describe("Astro integration gates", () => {
  it.each(["build", "preview", "sync"] as const)(
    "does not initialize anything during %s",
    async (command) => {
      const updateConfig = vi.fn();
      const injectScript = vi.fn();
      const hook = spotPatch().hooks["astro:config:setup"];
      // Omit config deliberately: the command gate must not inspect the project.
      await hook?.({
        command,
        updateConfig,
        injectScript,
      } as unknown as Parameters<SetupHook>[0]);
      expect(updateConfig).not.toHaveBeenCalled();
      expect(injectScript).not.toHaveBeenCalled();
    },
  );

  it("leaves disabled development integrations inert", async () => {
    await expect(
      spotPatch({ enabled: false }).hooks["astro:config:setup"]?.({
        command: "dev",
      } as Parameters<SetupHook>[0]),
    ).resolves.toBeUndefined();
  });

  it("accepts shared feature options without silently dropping capabilities", () => {
    const options = {
      dataFlow: {},
      externalAgent: true,
      contextualAsk: {},
      ai: false,
    } as const;
    expect(spotPatch(options).name).toBe("@spotpatch/astro");
    const resolved = resolveOptions(options);
    expect(resolved.dataFlow.enabled).toBe(true);
    expect(resolved.externalAgent.enabled).toBe(true);
    expect(resolved.contextualAsk.enabled).toBe(true);
  });
});
