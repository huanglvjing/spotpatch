import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { resolveProjectOptions } from "@spotpatch/dev-server";
import { afterEach, describe, expect, it } from "vitest";

import { resolveAstroValidationChecks } from "./project-validation.js";

const roots: string[] = [];
const execFileAsync = promisify(execFile);
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(checker: boolean): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "spotpatch-astro-validation-"));
  roots.push(root);
  await execFileAsync("git", ["init", "--quiet"], { cwd: root });
  for (const name of ["astro", "typescript", ...(checker ? ["@astrojs/check"] : [])]) {
    const directory = path.join(root, "node_modules", name);
    await mkdir(path.join(directory, "bin"), { recursive: true });
    await mkdir(path.join(directory, "dist"), { recursive: true });
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name, main: "dist/index.js" }),
    );
    await writeFile(path.join(directory, "dist/index.js"), "");
    if (name === "@astrojs/check")
      await writeFile(
        path.join(directory, "bin/astro-check.js"),
        'throw new Error("Discovery must not execute checks");',
      );
  }
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      devDependencies: {
        astro: "0.0.0",
        typescript: "0.0.0",
        ...(checker ? { "@astrojs/check": "0.0.0" } : {}),
      },
    }),
  );
  await writeFile(path.join(root, "tsconfig.json"), "{}");
  return root;
}

describe("Astro trusted validation", () => {
  it("runs real template diagnostics without executing Astro configuration", async () => {
    const appRoot = await mkdtemp(path.join(os.tmpdir(), "spotpatch-astro-check-"));
    roots.push(appRoot);
    await execFileAsync("git", ["init", "--quiet"], { cwd: appRoot });
    await symlink(
      fileURLToPath(
        new URL("../../../playgrounds/compat-astro7/node_modules", import.meta.url),
      ),
      path.join(appRoot, "node_modules"),
      "dir",
    );
    await writeFile(
      path.join(appRoot, "package.json"),
      JSON.stringify({
        devDependencies: { astro: "*", "@astrojs/check": "*", typescript: "*" },
      }),
    );
    await writeFile(
      path.join(appRoot, "tsconfig.json"),
      JSON.stringify({
        extends: "astro/tsconfigs/strict",
        include: ["src/**/*.astro"],
      }),
    );
    await writeFile(
      path.join(appRoot, "astro.config.mjs"),
      'throw new Error("Diagnostics must not execute Astro config");',
    );
    await mkdir(path.join(appRoot, "src"));
    const source = path.join(appRoot, "src/Page.astro");
    await writeFile(
      source,
      '---\nconst label: string = "Before";\n---\n<button>{label}</button>',
    );
    const checks = await resolveAstroValidationChecks({
      appRoot,
      checks: {},
      timeoutMs: 30_000,
    });
    const check = checks["spotpatch-astro-check"];
    if (check === undefined) throw new Error("Installed checker was not discovered");
    const passed = await execFileAsync(check.command, [...check.args], {
      cwd: appRoot,
      timeout: check.timeoutMs,
    });
    expect(passed.stdout).toContain("0 errors");
    expect(passed.stdout).toContain("1 file");
    await writeFile(
      source,
      "---\nconst label: string = 42;\n---\n<button>{label}</button>",
    );
    const failed = execFileAsync(check.command, [...check.args], {
      cwd: appRoot,
      timeout: check.timeoutMs,
    });
    await expect(failed).rejects.toHaveProperty("code", 1);
    await expect(failed).rejects.toHaveProperty(
      "stdout",
      expect.stringContaining("src/Page.astro"),
    );
  }, 60_000);

  it("discovers a non-interactive Astro check with worktree-relative root", async () => {
    const appRoot = await fixture(true);
    const checks = await resolveAstroValidationChecks({
      appRoot,
      checks: {},
      timeoutMs: 30_000,
    });
    expect(checks["spotpatch-astro-check"]).toMatchObject({
      command: process.execPath,
      required: true,
      timeoutMs: 30_000,
      args: [
        path.join(
          await realpath(appRoot),
          "node_modules/@astrojs/check/bin/astro-check.js",
        ),
        "--minimumFailingSeverity",
        "error",
        "--root",
        ".",
        "--tsconfig",
        "tsconfig.json",
      ],
    });
  });
  it("does not fall back to tsc or install a missing Astro checker", async () => {
    const appRoot = await fixture(false);
    await expect(
      resolveProjectOptions({
        appRoot,
        options: { trustedFastMode: true },
        environmentAi: {
          baseURL: "https://provider.example.test/v1",
          model: "fixture",
        },
        resolveValidationChecks: resolveAstroValidationChecks,
      }),
    ).rejects.toThrow("requires a configured required check");
  });
  it("preserves explicit required checks without inspecting the host", async () => {
    const checks = Object.freeze({
      test: Object.freeze({
        id: "test",
        label: "Project validation",
        command: "node",
        args: Object.freeze(["test.mjs"]),
        required: true,
        timeoutMs: 15_000,
      }),
    });
    expect(
      await resolveAstroValidationChecks({
        appRoot: "/missing",
        checks,
        timeoutMs: 15_000,
      }),
    ).toBe(checks);
  });
});
