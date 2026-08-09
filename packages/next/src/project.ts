import { execFile } from "node:child_process";
import { access, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

import type { SpotPatchNextRouterKind } from "@spotpatch/shared";

const execFileAsync = promisify(execFile);
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/u;

export interface NextProject {
  readonly appRoot: string;
  readonly nextEntry: string;
  readonly nextVersion: string;
  readonly projectRoot: string;
  readonly routerKind: SpotPatchNextRouterKind;
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

function assertSupportedNextVersion(version: string): void {
  const match = VERSION_PATTERN.exec(version);
  const major = Number(match?.[1]);
  const minor = Number(match?.[2]);

  if (
    match === null ||
    !Number.isSafeInteger(major) ||
    !Number.isSafeInteger(minor) ||
    major < 15 ||
    major >= 17 ||
    (major === 15 && minor < 3)
  ) {
    throw new Error(
      `SpotPatch Next requires Next.js >=15.3.0 <17.0.0; found ${version}.`,
    );
  }
}

async function detectRouterKind(appRoot: string): Promise<SpotPatchNextRouterKind> {
  const [appCandidates, pagesCandidates] = await Promise.all([
    Promise.all([
      pathExists(path.join(appRoot, "app")),
      pathExists(path.join(appRoot, "src", "app")),
    ]),
    Promise.all([
      pathExists(path.join(appRoot, "pages")),
      pathExists(path.join(appRoot, "src", "pages")),
    ]),
  ]);
  const hasApp = appCandidates.some(Boolean);
  const hasPages = pagesCandidates.some(Boolean);

  if (hasApp && hasPages) {
    return "hybrid";
  }

  if (hasApp) {
    return "app";
  }

  if (hasPages) {
    return "pages";
  }

  throw new Error("SpotPatch could not find an App or Pages Router directory.");
}

async function findProjectRoot(appRoot: string): Promise<string> {
  try {
    const result = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: appRoot,
      encoding: "utf8",
      timeout: 5_000,
    });
    const candidate = await realpath(result.stdout.trim());
    const relative = path.relative(candidate, appRoot);

    if (
      relative === "" ||
      (!relative.startsWith(`..${path.sep}`) &&
        relative !== ".." &&
        !path.isAbsolute(relative))
    ) {
      return candidate;
    }
  } catch {
    // A non-Git application can still use picker/editor features with AI disabled.
  }

  return appRoot;
}

export async function inspectNextProject(
  directory = process.cwd(),
): Promise<NextProject> {
  const appRoot = await realpath(directory);
  const resolveFromApplication = createRequire(path.join(appRoot, "package.json"));
  let nextEntry: string;
  let manifestPath: string;

  try {
    nextEntry = resolveFromApplication.resolve("next/dist/bin/next");
    manifestPath = resolveFromApplication.resolve("next/package.json");
  } catch (error: unknown) {
    throw new Error("SpotPatch could not resolve the application's local Next.js.", {
      cause: error,
    });
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;

  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("version" in manifest) ||
    typeof manifest.version !== "string"
  ) {
    throw new Error("SpotPatch could not read the local Next.js version.");
  }

  assertSupportedNextVersion(manifest.version);
  const [projectRoot, routerKind] = await Promise.all([
    findProjectRoot(appRoot),
    detectRouterKind(appRoot),
  ]);

  return Object.freeze({
    appRoot,
    nextEntry,
    nextVersion: manifest.version,
    projectRoot,
    routerKind,
  });
}
