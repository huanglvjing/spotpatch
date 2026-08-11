import { execFile } from "node:child_process";
import { access, lstat, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

import type { ResolvedAgentCheckDefinition } from "@spotpatch/shared";

const execFileAsync = promisify(execFile);
const TYPESCRIPT_CHECK_ID = "spotpatch-typecheck";
const TYPESCRIPT_CHECK_LABEL = "TypeScript";

interface ProjectManifest {
  readonly dependencies?: Readonly<Record<string, unknown>>;
  readonly devDependencies?: Readonly<Record<string, unknown>>;
  readonly peerDependencies?: Readonly<Record<string, unknown>>;
}

export interface DiscoverProjectValidationCheckOptions {
  readonly appRoot: string;
  readonly timeoutMs: number;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function isRegularFile(absolutePath: string): Promise<boolean> {
  try {
    const metadata = await lstat(absolutePath);
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

async function readManifest(appRoot: string): Promise<ProjectManifest | undefined> {
  const manifestPath = path.join(appRoot, "package.json");

  if (!(await isRegularFile(manifestPath))) {
    return undefined;
  }

  try {
    const value = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function declaresTypeScript(manifest: ProjectManifest): boolean {
  return [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.peerDependencies,
  ].some(
    (dependencies) =>
      isRecord(dependencies) && typeof dependencies.typescript === "string",
  );
}

async function findGitRoot(appRoot: string): Promise<string | undefined> {
  try {
    const result = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: appRoot,
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    });
    const root = await realpath(result.stdout.trim());
    const relative = path.relative(root, appRoot);

    if (
      relative === "" ||
      (!relative.startsWith(`..${path.sep}`) &&
        relative !== ".." &&
        !path.isAbsolute(relative))
    ) {
      return root;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

async function resolveTypeScriptCli(appRoot: string): Promise<string | undefined> {
  const resolveFromApplication = createRequire(path.join(appRoot, "package.json"));

  try {
    const packagePath = resolveFromApplication.resolve("typescript/package.json");
    const cliPath = path.join(path.dirname(packagePath), "bin", "tsc");
    await access(cliPath);
    return await realpath(cliPath);
  } catch {
    return undefined;
  }
}

function portableRelativePath(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join("/");
}

export async function discoverProjectValidationCheck(
  options: DiscoverProjectValidationCheckOptions,
): Promise<ResolvedAgentCheckDefinition | undefined> {
  const appRoot = await realpath(options.appRoot);
  const tsconfigPath = path.join(appRoot, "tsconfig.json");
  const [manifest, projectRoot, hasTsconfig] = await Promise.all([
    readManifest(appRoot),
    findGitRoot(appRoot),
    isRegularFile(tsconfigPath),
  ]);

  if (
    manifest === undefined ||
    projectRoot === undefined ||
    !hasTsconfig ||
    !declaresTypeScript(manifest)
  ) {
    return undefined;
  }

  const cliPath = await resolveTypeScriptCli(appRoot);

  if (cliPath === undefined) {
    return undefined;
  }

  const projectPath = portableRelativePath(projectRoot, tsconfigPath);

  if (projectPath.length === 0 || projectPath.startsWith("../")) {
    return undefined;
  }

  return Object.freeze({
    id: TYPESCRIPT_CHECK_ID,
    label: TYPESCRIPT_CHECK_LABEL,
    command: process.execPath,
    args: Object.freeze([
      cliPath,
      "--noEmit",
      "--pretty",
      "false",
      "--project",
      projectPath,
    ]),
    required: true,
    timeoutMs: options.timeoutMs,
  });
}
