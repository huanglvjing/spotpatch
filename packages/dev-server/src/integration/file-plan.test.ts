import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyIntegrationPlan,
  createIntegrationFileChange,
  type IntegrationFileChange,
} from "./file-plan.js";

const roots: string[] = [];

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "spotpatch-file-plan-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("integration file plan", () => {
  it("refuses to overwrite a file changed after its preview", async () => {
    const root = await fixture();
    const target = path.join(root, "vite.config.ts");
    await writeFile(target, "export default {};\n");
    const change = createIntegrationFileChange(
      root,
      target,
      "export default { plugins: [] };\n",
      "export default {};\n",
    );

    if (change === undefined) {
      throw new Error("Expected an integration change.");
    }

    await writeFile(target, "export default { hostEdit: true };\n");
    await expect(
      applyIntegrationPlan({ appRoot: root, changes: [change] }),
    ).rejects.toThrow(/changed after the preview/u);
    await expect(readFile(target, "utf8")).resolves.toBe(
      "export default { hostEdit: true };\n",
    );
  });

  it("rejects a forged plan outside the app root before writing", async () => {
    const root = await fixture();
    const outsideRoot = await fixture();
    const target = path.join(outsideRoot, "outside.ts");
    const change = Object.freeze({
      absolutePath: target,
      nextContent: "export {};\n",
      relativePath: "outside.ts",
    }) satisfies IntegrationFileChange;

    await expect(
      applyIntegrationPlan({ appRoot: root, changes: [change] }),
    ).rejects.toThrow(/outside the app root/u);
    await expect(readFile(target, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
