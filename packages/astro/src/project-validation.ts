import { execFile } from "node:child_process";
import { access, lstat, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

import { isInsideRoot } from "@spotpatch/compiler";
import { type resolveProjectValidationChecks } from "@spotpatch/dev-server";
import type { ResolvedAgentCheckDefinition } from "@spotpatch/shared";

const execFileAsync = promisify(execFile);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function hasCheckerConfiguration(appRoot: string): Promise<boolean> {
  for (const name of ["package.json", "tsconfig.json"]) {
    const metadata = await lstat(path.join(appRoot, name));
    if (!metadata.isFile() || metadata.isSymbolicLink()) return false;
  }
  const manifest: unknown = JSON.parse(
    await readFile(path.join(appRoot, "package.json"), "utf8"),
  );
  if (!isRecord(manifest)) return false;
  return ["astro", "@astrojs/check", "typescript"].every((name) =>
    ["dependencies", "devDependencies", "peerDependencies"].some((section) => {
      const dependencies = manifest[section];
      return isRecord(dependencies) && typeof dependencies[name] === "string";
    }),
  );
}

/** Astro templates require Astro's checker; tsc alone cannot validate them. */
export const resolveAstroValidationChecks: typeof resolveProjectValidationChecks =
  async (input) => {
    if (Object.values(input.checks).some((check) => check.required))
      return input.checks;
    try {
      const appRoot = await realpath(input.appRoot);
      if (!(await hasCheckerConfiguration(appRoot))) return input.checks;
      const fromHost = createRequire(path.join(appRoot, "package.json"));
      fromHost.resolve("typescript");
      // Call the installed diagnostic tool directly: `astro check` also runs
      // sync, which loads project configuration and can write generated files.
      const cli = path.join(
        path.dirname(fromHost.resolve("@astrojs/check")),
        "..",
        "bin",
        "astro-check.js",
      );
      await access(cli);
      const result = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
        cwd: appRoot,
        encoding: "utf8",
        timeout: 5_000,
        windowsHide: true,
      });
      const projectRoot = await realpath(result.stdout.trim());
      if (!isInsideRoot(projectRoot, appRoot)) return input.checks;
      let id = "spotpatch-astro-check";
      for (let suffix = 2; input.checks[id] !== undefined; suffix += 1)
        id = `spotpatch-astro-check-${String(suffix)}`;
      const check: ResolvedAgentCheckDefinition = Object.freeze({
        id,
        label: "Astro",
        command: process.execPath,
        args: Object.freeze([
          cli,
          // Explicit defaults also tolerate @astrojs/check 0.9.x's CLI
          // double hideBin: only this default pair is dropped, not --root.
          "--minimumFailingSeverity",
          "error",
          "--root",
          path.relative(projectRoot, appRoot).split(path.sep).join("/") || ".",
          "--tsconfig",
          "tsconfig.json",
        ]),
        required: true,
        timeoutMs: input.timeoutMs,
      });
      return Object.freeze({ ...input.checks, [id]: check });
    } catch {
      return input.checks;
    }
  };
