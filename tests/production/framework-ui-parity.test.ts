import { readdir, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const SHARED_EXTERNAL_HANDOFF_SIGNATURES = Object.freeze([
  "spotpatch-select-trigger",
  "spotpatch-select-menu",
  "spotpatch-external-agent-value",
  "Managed Codex model",
  "受管 Codex 模型",
  "Send to Agent",
  "发送给 Agent",
]);

const BUNDLED_EXTERNAL_HANDOFF_ARTIFACTS = Object.freeze([
  ["Vite", ["packages/vite/dist/runtime-external-handoff-panel.js"]],
  ["Astro", ["packages/astro/dist/runtime-external-handoff.js"]],
] as const);

async function readArtifacts(paths: readonly string[]): Promise<string> {
  return (
    await Promise.all(paths.map((artifactPath) => readFile(artifactPath, "utf8")))
  ).join("\n");
}

describe("framework Runtime UI parity", () => {
  it.each(BUNDLED_EXTERNAL_HANDOFF_ARTIFACTS)(
    "ships the shared Agent controls in the %s artifact",
    async (_, artifactPaths) => {
      const source = await readArtifacts(artifactPaths);

      for (const signature of SHARED_EXTERNAL_HANDOFF_SIGNATURES) {
        expect(source).toContain(signature);
      }
      expect(source).not.toContain(".spotpatch-external-control select");
    },
  );

  it("ships the same controls through the Runtime entry and its chunks", async () => {
    const runtimeFiles = (await readdir("packages/runtime/dist"))
      .filter((fileName) => fileName.endsWith(".js"))
      .map((fileName) => `packages/runtime/dist/${fileName}`);
    const source = await readArtifacts(runtimeFiles);

    for (const signature of SHARED_EXTERNAL_HANDOFF_SIGNATURES) {
      expect(source).toContain(signature);
    }
    expect(source).not.toContain(".spotpatch-external-control select");
  });

  it("keeps Next on the public shared Runtime extension", async () => {
    const source = await readFile("packages/next/dist/client.js", "utf8");

    expect(source).toContain("@spotpatch/runtime/external-handoff-panel");
    expect(source).not.toContain("spotpatch-external-control");
  });
});
