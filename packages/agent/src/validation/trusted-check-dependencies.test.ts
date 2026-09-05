import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ResolvedAgentCheckDefinition } from "@spotpatch/shared";
import { describe, expect, it } from "vitest";

import { createTestGitRepository } from "../test-utils/git-repository.js";
import { trustedCheckDependencyViews } from "./trusted-check-dependencies.js";

describe("trusted diagnostic dependency views", () => {
  it("allows the installed static Astro checker in a nested app, rejecting altered commands and roots", async () => {
    const repository = await createTestGitRepository({
      "apps/site/package.json": "{}",
      "apps/site/tsconfig.json": "{}",
    });
    try {
      const packageRoot = path.join(repository.root, "node_modules/@astrojs/check");
      await mkdir(path.join(packageRoot, "dist"), { recursive: true });
      await mkdir(path.join(packageRoot, "bin"), { recursive: true });
      await mkdir(path.join(repository.root, "apps/site/node_modules"));
      await writeFile(
        path.join(packageRoot, "package.json"),
        JSON.stringify({ main: "dist/index.js" }),
      );
      await writeFile(path.join(packageRoot, "dist/index.js"), "");
      const cli = path.join(packageRoot, "bin/astro-check.js");
      await writeFile(cli, "");
      const check: ResolvedAgentCheckDefinition = {
        id: "astro",
        label: "Astro",
        command: process.execPath,
        args: [
          cli,
          "--minimumFailingSeverity",
          "error",
          "--root",
          "apps/site",
          "--tsconfig",
          "tsconfig.json",
        ],
        required: true,
        timeoutMs: 10_000,
      };
      expect(await trustedCheckDependencyViews(check, repository.root)).toEqual([
        {
          source: await realpath(path.join(repository.root, "apps/site/node_modules")),
          relativePath: path.join("apps/site", "node_modules"),
        },
        {
          source: await realpath(path.join(repository.root, "node_modules")),
          relativePath: "node_modules",
        },
      ]);
      for (const args of [
        [...check.args, "--watch"],
        [cli, "check", "--root", "apps/site"],
        check.args.map((value, index) => (index === 4 ? "../outside" : value)),
        check.args.map((value, index) => (index === 6 ? "other.json" : value)),
        check.args.map((value, index) => (index === 0 ? process.execPath : value)),
      ]) {
        expect(
          await trustedCheckDependencyViews({ ...check, args }, repository.root),
        ).toEqual([]);
      }
    } finally {
      await repository.cleanup();
    }
  });
});
