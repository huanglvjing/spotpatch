import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyViteIntegrationPlan,
  checkViteIntegration,
  planViteIntegration,
} from "./initializer.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

async function fixture(config: string, withTypeScript = true): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "spotpatch-vite-init-"));
  roots.push(root);
  await execFileAsync("git", ["init", "--quiet"], { cwd: root });
  await writeFile(path.join(root, "vite.config.ts"), config);
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify(
      {
        name: "fixture",
        private: true,
        devDependencies: withTypeScript ? { typescript: "0.0.0" } : {},
      },
      undefined,
      2,
    )}\n`,
  );

  if (withTypeScript) {
    const packageRoot = path.join(root, "node_modules", "typescript");
    await mkdir(path.join(packageRoot, "bin"), { recursive: true });
    await writeFile(path.join(root, "tsconfig.json"), "{}\n");
    await writeFile(
      path.join(packageRoot, "package.json"),
      '{"name":"typescript","version":"0.0.0"}\n',
    );
    await writeFile(path.join(packageRoot, "bin", "tsc"), "process.exit(0);\n");
  }

  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Vite integration initializer", () => {
  it("adds the plugin, enables the page selector, and becomes idempotent", async () => {
    const root = await fixture(
      'import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\n\nexport default defineConfig({\n  plugins: [react()],\n});\n',
    );
    const plan = await planViteIntegration(root);

    expect(plan.trustedFastModeAvailable).toBe(true);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]?.nextContent).toContain(
      'import { spotPatch } from "@spotpatch/vite";',
    );
    expect(plan.changes[0]?.nextContent).toContain(
      "plugins: [spotPatch({ trustedFastMode: true }),",
    );

    await applyViteIntegrationPlan(plan);
    await expect(checkViteIntegration(root)).resolves.toMatchObject({ ok: true });
    await expect(planViteIntegration(root)).resolves.toMatchObject({ changes: [] });
  });

  it("upgrades an existing zero-config plugin without duplicating it", async () => {
    const root = await fixture(
      'import { spotPatch } from "@spotpatch/vite";\nimport { defineConfig } from "vite";\n\nexport default defineConfig({ plugins: [spotPatch()] });\n',
    );
    const plan = await planViteIntegration(root);
    const config = plan.changes[0]?.nextContent ?? "";

    expect(config.match(/spotPatch\(/gu)).toHaveLength(1);
    expect(config).toContain("spotPatch({ trustedFastMode: true })");
  });

  it("uses a collision-free import and supports an identifier export", async () => {
    const root = await fixture(
      'import { defineConfig } from "vite";\nconst spotPatch = "host";\nconst config = defineConfig({});\nexport default config;\n',
    );
    const config = (await planViteIntegration(root)).changes[0]?.nextContent ?? "";

    expect(config).toContain(
      'import { spotPatch as spotPatch1 } from "@spotpatch/vite";',
    );
    expect(config).toContain("plugins: [spotPatch1({ trustedFastMode: true })]");
  });

  it("supports a defineConfig callback with setup statements and an object return", async () => {
    const root = await fixture(
      'import react from "@vitejs/plugin-react";\nimport { defineConfig, loadEnv } from "vite";\n\nexport default defineConfig(({ mode }) => {\n  const env = loadEnv(mode, process.cwd(), "");\n\n  return {\n    plugins: [react()],\n    define: { __MODE__: JSON.stringify(env.MODE) },\n  };\n});\n',
    );
    const plan = await planViteIntegration(root);
    const config = plan.changes[0]?.nextContent ?? "";

    expect(config).toContain('import { spotPatch } from "@spotpatch/vite";');
    expect(config).toContain("plugins: [spotPatch({ trustedFastMode: true }),");
    expect(config).toContain("define: { __MODE__: JSON.stringify(env.MODE) }");

    await applyViteIntegrationPlan(plan);
    await expect(planViteIntegration(root)).resolves.toMatchObject({ changes: [] });
  });

  it("supports a concise object-returning defineConfig callback", async () => {
    const root = await fixture(
      'import { defineConfig } from "vite";\n\nexport default defineConfig(() => ({ plugins: [] }));\n',
    );
    const config = (await planViteIntegration(root)).changes[0]?.nextContent ?? "";

    expect(config).toContain("plugins: [spotPatch({ trustedFastMode: true })]");
  });

  it("fails closed for callbacks with ambiguous top-level returns", async () => {
    const root = await fixture(
      'import { defineConfig } from "vite";\n\nexport default defineConfig(({ mode }) => {\n  if (mode === "test") return { plugins: [] };\n  return { plugins: [] };\n});\n',
    );
    const original = await readFile(path.join(root, "vite.config.ts"), "utf8");

    await expect(planViteIntegration(root)).rejects.toThrow(
      /exactly one top-level object return/u,
    );
    await expect(readFile(path.join(root, "vite.config.ts"), "utf8")).resolves.toBe(
      original,
    );
  });

  it("installs picker-only integration when no safe project check is found", async () => {
    const root = await fixture(
      'import { defineConfig } from "vite";\nexport default defineConfig({ plugins: [] });\n',
      false,
    );
    const plan = await planViteIntegration(root);

    expect(plan.trustedFastModeAvailable).toBe(false);
    expect(plan.changes[0]?.nextContent).toContain("plugins: [spotPatch()]");
  });

  it("fails closed for dynamic plugin collections", async () => {
    const root = await fixture(
      'import { defineConfig } from "vite";\nconst plugins = [];\nexport default defineConfig({ plugins });\n',
    );
    const original = await readFile(path.join(root, "vite.config.ts"), "utf8");

    await expect(planViteIntegration(root)).rejects.toThrow(/plugins to be an array/u);
    await expect(readFile(path.join(root, "vite.config.ts"), "utf8")).resolves.toBe(
      original,
    );
  });
});
