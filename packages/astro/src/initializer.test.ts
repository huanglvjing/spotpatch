import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyAstroIntegrationPlan,
  checkAstroIntegration,
  planAstroIntegration,
} from "./initializer.js";

const roots: string[] = [];

async function fixture(config: string, name = "astro.config.mjs"): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "spotpatch-astro-init-"));
  roots.push(root);
  await writeFile(path.join(root, name), config);
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "fixture", private: true })}\n`,
  );
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Astro integration initializer", () => {
  it("adds every public capability and becomes idempotent", async () => {
    const root = await fixture(
      'import node from "@astrojs/node";\nimport { defineConfig } from "astro/config";\n\nexport default defineConfig({\n  adapter: node(),\n});\n',
    );
    const plan = await planAstroIntegration(root);
    const content = plan.changes[0]?.nextContent ?? "";

    expect(content).toContain('import { spotPatch } from "@spotpatch/astro";');
    expect(content).toContain(
      "integrations: [spotPatch({ dataFlow: {}, contextualAsk: {}, externalAgent: true })]",
    );
    expect(content).toContain("adapter: node()");
    await applyAstroIntegrationPlan(plan);
    await expect(checkAstroIntegration(root)).resolves.toMatchObject({ ok: true });
    await expect(planAstroIntegration(root)).resolves.toMatchObject({ changes: [] });
  });

  it("preserves existing options and integrations while enabling capabilities", async () => {
    const root = await fixture(
      "import sitemap from '@astrojs/sitemap';\nimport spotPatch from '@spotpatch/astro';\nimport { defineConfig } from 'astro/config';\n\nexport default defineConfig({ integrations: [sitemap(), spotPatch({ ai: false, dataFlow: false, contextualAsk: false, externalAgent: false })] });\n",
    );
    const content = (await planAstroIntegration(root)).changes[0]?.nextContent ?? "";

    expect(content.match(/spotPatch\(/gu)).toHaveLength(1);
    expect(content).toContain("ai: false");
    expect(content).toContain("dataFlow: {}");
    expect(content).toContain("contextualAsk: {}");
    expect(content).toContain("externalAgent: true");
    expect(content).toContain("sitemap()");
  });

  it("uses a collision-free import for an identifier export", async () => {
    const root = await fixture(
      'import { defineConfig } from "astro/config";\nconst spotPatch = "host";\nconst config = defineConfig({});\nexport default config;\n',
    );
    const content = (await planAstroIntegration(root)).changes[0]?.nextContent ?? "";

    expect(content).toContain(
      'import { spotPatch as spotPatch1 } from "@spotpatch/astro";',
    );
    expect(content).toContain("integrations: [spotPatch1(");
  });

  it("supports a single object-returning defineConfig callback", async () => {
    const root = await fixture(
      'import { defineConfig } from "astro/config";\nexport default defineConfig(() => {\n  const base = "/app";\n  return { base };\n});\n',
    );
    const content = (await planAstroIntegration(root)).changes[0]?.nextContent ?? "";

    expect(content).toContain("integrations: [spotPatch(");
    expect(content).toContain("base");
  });

  it("fails closed when a defineConfig callback has conditional returns", async () => {
    const root = await fixture(
      'import { defineConfig } from "astro/config";\nexport default defineConfig(({ command }) => {\n  if (command === "dev") return {};\n  return {};\n});\n',
    );

    await expect(planAstroIntegration(root)).rejects.toThrow(
      /exactly one top-level object return/u,
    );
  });

  it("inserts the integration import after module directives", async () => {
    const root = await fixture('"use strict";\n\nexport default {};\n');
    const content = (await planAstroIntegration(root)).changes[0]?.nextContent ?? "";

    expect(content).toMatch(
      /^"use strict";\nimport \{ spotPatch \} from "@spotpatch\/astro";/u,
    );
  });

  it("fails without writing dynamic integration collections", async () => {
    const source =
      'import { defineConfig } from "astro/config";\nconst integrations = [];\nexport default defineConfig({ integrations });\n';
    const root = await fixture(source);

    await expect(planAstroIntegration(root)).rejects.toThrow(
      /integrations to be an array/u,
    );
    await expect(readFile(path.join(root, "astro.config.mjs"), "utf8")).resolves.toBe(
      source,
    );
  });

  it("fails closed for spread options", async () => {
    const root = await fixture(
      'import spotPatch from "@spotpatch/astro";\nimport { defineConfig } from "astro/config";\nconst options = {};\nexport default defineConfig({ integrations: [spotPatch({ ...options })] });\n',
    );

    await expect(planAstroIntegration(root)).rejects.toThrow(/spread/u);
  });

  it("requires exactly one supported config file", async () => {
    const root = await fixture("export default {};\n");
    await writeFile(path.join(root, "astro.config.ts"), "export default {};\n");

    await expect(planAstroIntegration(root)).rejects.toThrow(
      /exactly one supported astro\.config/u,
    );
  });
});
