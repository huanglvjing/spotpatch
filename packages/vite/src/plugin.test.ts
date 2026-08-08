import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { spotPatch } from "./plugin.js";

const temporaryDirectories: string[] = [];

function createEnvironmentRoot(source: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "spotpatch-environment-"));
  temporaryDirectories.push(root);
  writeFileSync(path.join(root, ".env.local"), source, "utf8");
  return root;
}

async function runConfigHook(
  plugins: ReturnType<typeof spotPatch>,
  root: string,
): Promise<void> {
  const hook = plugins[0]?.config;

  if (typeof hook !== "function") {
    throw new Error("Expected the SpotPatch configuration hook.");
  }

  await hook.call(
    {} as never,
    { root },
    { command: "serve", mode: "development", isPreview: false, isSsrBuild: false },
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("spotPatch", () => {
  it("returns no plugins when explicitly disabled", () => {
    expect(spotPatch({ enabled: false })).toEqual([]);
  });

  it("registers isolated development-only plugins", () => {
    const plugins = spotPatch();

    expect(plugins.map(({ name }) => name)).toEqual([
      "spotpatch:transform",
      "spotpatch:runtime-injection",
      "spotpatch:server",
    ]);
    expect(plugins.every(({ apply }) => apply === "serve")).toBe(true);
    expect(plugins.every(({ enforce }) => enforce === "pre")).toBe(true);
  });

  it("loads a complete conventional AI configuration from .env.local", async () => {
    const root = createEnvironmentRoot(
      [
        "SPOTPATCH_AI_BASE_URL=https://relay.example.test/v1",
        "SPOTPATCH_AI_MODEL=provider/model",
        "SPOTPATCH_AI_API_KEY=synthetic-local-credential",
      ].join("\n"),
    );

    await runConfigHook(spotPatch(), root);
  });

  it("fails fast when conventional AI environment values are incomplete", async () => {
    const root = createEnvironmentRoot(
      "SPOTPATCH_AI_API_KEY=synthetic-local-credential\n",
    );

    await expect(runConfigHook(spotPatch(), root)).rejects.toThrow(
      /SPOTPATCH_AI_BASE_URL/u,
    );
  });

  it("honors explicit AI disablement even when environment values are partial", async () => {
    const root = createEnvironmentRoot(
      "SPOTPATCH_AI_API_KEY=synthetic-local-credential\n",
    );

    await runConfigHook(spotPatch({ ai: false }), root);
  });
});
