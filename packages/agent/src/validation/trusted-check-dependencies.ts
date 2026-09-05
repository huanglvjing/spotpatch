import { realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import type { ResolvedAgentCheckDefinition } from "@spotpatch/shared";

import { assertAgentPathAllowed } from "../security/path-policy.js";

const TYPESCRIPT_ARGUMENTS = [
  "--noEmit",
  "--pretty",
  "false",
  "--incremental",
  "false",
  "--project",
] as const;

export interface TrustedDependencyView {
  readonly source: string;
  readonly relativePath: string;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

/** Only fixed, non-emitting diagnostic commands may borrow installed dependencies.
 * Call after the Agent turn, and remove every view before inspecting/applying edits.
 * These are trusted local tools, not an OS sandbox for arbitrary package code.
 */
export async function trustedCheckDependencyViews(
  check: ResolvedAgentCheckDefinition,
  projectRoot: string,
): Promise<readonly TrustedDependencyView[]> {
  if (check.command !== process.execPath) return [];
  try {
    projectRoot = await realpath(projectRoot);
    const executable = await realpath(check.args[0] ?? "");
    if (
      check.args.length === TYPESCRIPT_ARGUMENTS.length + 2 &&
      TYPESCRIPT_ARGUMENTS.every(
        (argument, index) => check.args[index + 1] === argument,
      )
    ) {
      const projectPath = check.args.at(-1);
      if (!projectPath?.endsWith(".json")) return [];
      assertAgentPathAllowed(projectPath);
      const source = await realpath(path.join(projectRoot, "node_modules"));
      if (
        !isWithinRoot(source, executable) ||
        executable.split(path.sep).slice(-4).join("/") !==
          "node_modules/typescript/bin/tsc"
      )
        return [];
      return [{ source, relativePath: "node_modules" }];
    }

    if (
      check.args.length !== 7 ||
      check.args[1] !== "--minimumFailingSeverity" ||
      check.args[2] !== "error" ||
      check.args[3] !== "--root" ||
      check.args[5] !== "--tsconfig" ||
      check.args[6] !== "tsconfig.json"
    )
      return [];
    const relativeRoot = check.args[4];
    if (relativeRoot === undefined) return [];
    if (relativeRoot !== ".") assertAgentPathAllowed(relativeRoot);
    const requestedRoot = path.resolve(projectRoot, relativeRoot);
    const appRoot = await realpath(requestedRoot);
    if (appRoot !== requestedRoot || !isWithinRoot(projectRoot, appRoot)) return [];
    const fromHost = createRequire(path.join(appRoot, "package.json"));
    const installedCli = await realpath(
      path.join(
        path.dirname(fromHost.resolve("@astrojs/check")),
        "..",
        "bin",
        "astro-check.js",
      ),
    );
    if (executable !== installedCli) return [];

    // Preserve the dependency lookup chain of nested workspace applications.
    // No package-manager execution, install, config load, or Agent-time link.
    const views: TrustedDependencyView[] = [];
    for (
      let directory = appRoot;
      isWithinRoot(projectRoot, directory);
      directory = path.dirname(directory)
    ) {
      const dependencyPath = path.join(directory, "node_modules");
      const source = await realpath(dependencyPath).catch(() => undefined);
      if (source !== undefined && isWithinRoot(projectRoot, source)) {
        views.push({
          source,
          relativePath: path.relative(projectRoot, dependencyPath),
        });
      }
      if (directory === projectRoot) break;
    }
    // Reject global/unrelated checker resolution even when Node can find it.
    return views.some((view) => isWithinRoot(view.source, executable)) ? views : [];
  } catch {
    return [];
  }
}
