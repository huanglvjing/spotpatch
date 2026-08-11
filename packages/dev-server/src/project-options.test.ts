import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { resolveProjectOptions } from "./project-options.js";
import { discoverProjectValidationCheck } from "./project-validation.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const environmentAi = Object.freeze({
  baseURL: "https://provider.example.test/v1",
  model: "model-test",
});

async function projectFixture(withTypeScript = true): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "spotpatch-project-options-"));
  roots.push(root);
  await execFileAsync("git", ["init", "--quiet"], { cwd: root });
  await writeFile(path.join(root, "tsconfig.json"), '{"compilerOptions":{}}\n');
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

describe("project Agent options", () => {
  it("discovers a bounded local TypeScript check without package-manager commands", async () => {
    const root = await projectFixture();
    const check = await discoverProjectValidationCheck({
      appRoot: root,
      timeoutMs: 45_000,
    });

    expect(check).toMatchObject({
      id: "spotpatch-typecheck",
      label: "TypeScript",
      command: process.execPath,
      required: true,
      timeoutMs: 45_000,
    });
    expect(check?.args).toEqual([
      path.join(await realpath(root), "node_modules", "typescript", "bin", "tsc"),
      "--noEmit",
      "--pretty",
      "false",
      "--project",
      "tsconfig.json",
    ]);
  });

  it("enables trusted fast capability with an automatically discovered check", async () => {
    const root = await projectFixture();
    const resolved = await resolveProjectOptions({
      appRoot: root,
      environmentAi,
      options: { trustedFastMode: true },
    });

    expect(resolved.ai).not.toBe(false);

    if (resolved.ai !== false) {
      expect(resolved.ai.execution.applyMode).toBe("trusted-auto");
      expect(resolved.ai.execution.checks["spotpatch-typecheck"]).toMatchObject({
        required: true,
      });
    }
  });

  it("fails clearly when quick mode has no configured or discoverable check", async () => {
    const root = await projectFixture(false);

    await expect(
      resolveProjectOptions({
        appRoot: root,
        environmentAi,
        options: { trustedFastMode: true },
      }),
    ).rejects.toThrow(/requires a configured required check/u);
  });

  it("reuses an explicit required check without requiring TypeScript", async () => {
    const root = await projectFixture(false);
    const resolved = await resolveProjectOptions({
      appRoot: root,
      environmentAi: {
        ...environmentAi,
        execution: {
          checks: {
            validate: {
              label: "Validate",
              command: process.execPath,
              args: ["--version"],
            },
          },
        },
      },
      options: { trustedFastMode: true },
    });

    expect(resolved.ai).not.toBe(false);

    if (resolved.ai !== false) {
      expect(resolved.ai.execution.applyMode).toBe("trusted-auto");
      expect(Object.keys(resolved.ai.execution.checks)).toEqual(["validate"]);
    }
  });

  it("rejects conflicting automatic apply strategies", async () => {
    const root = await projectFixture(false);

    await expect(
      resolveProjectOptions({
        appRoot: root,
        environmentAi: {
          ...environmentAi,
          execution: {
            applyMode: "auto",
            checks: {
              validate: {
                label: "Validate",
                command: process.execPath,
                args: ["--version"],
              },
            },
          },
        },
        options: { trustedFastMode: true },
      }),
    ).rejects.toThrow(/cannot be combined with applyMode auto/u);
  });

  it("keeps picker-only projects disabled instead of requiring AI configuration", async () => {
    const resolved = await resolveProjectOptions({
      appRoot: process.cwd(),
      environmentAi: false,
      options: { trustedFastMode: true },
    });

    expect(resolved.ai).toBe(false);
  });
});
