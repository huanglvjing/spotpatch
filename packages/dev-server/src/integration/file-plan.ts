import { randomBytes } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export interface IntegrationFileChange {
  readonly absolutePath: string;
  readonly nextContent: string;
  readonly previousContent?: string;
  readonly relativePath: string;
}

export interface IntegrationPlan {
  readonly appRoot: string;
  readonly changes: readonly IntegrationFileChange[];
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function isPathWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);

  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function relativePathWithin(root: string, target: string): string {
  const relative = path.relative(root, target);

  if (relative.length === 0 || !isPathWithin(root, target)) {
    throw new Error("SpotPatch init refuses to modify a path outside the app root.");
  }

  return relative.split(path.sep).join("/");
}

export async function integrationPathExists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

export async function readIntegrationFile(absolutePath: string): Promise<string> {
  const metadata = await lstat(absolutePath);

  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(
      `SpotPatch refuses to modify the non-regular file ${path.basename(absolutePath)}.`,
    );
  }

  return readFile(absolutePath, "utf8");
}

export function createIntegrationFileChange(
  appRoot: string,
  absolutePath: string,
  nextContent: string,
  previousContent: string | undefined,
): IntegrationFileChange | undefined {
  if (previousContent === nextContent) {
    return undefined;
  }

  const root = path.resolve(appRoot);
  const target = path.resolve(absolutePath);

  return Object.freeze({
    absolutePath: target,
    nextContent,
    ...(previousContent === undefined ? {} : { previousContent }),
    relativePath: relativePathWithin(root, target),
  });
}

function temporaryPath(absolutePath: string, label: string): string {
  return path.join(
    path.dirname(absolutePath),
    `.${path.basename(absolutePath)}.spotpatch-${label}-${String(process.pid)}-${randomBytes(8).toString("hex")}`,
  );
}

async function writeAtomic(
  absolutePath: string,
  content: string,
  mode: number,
): Promise<void> {
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const stagedPath = temporaryPath(absolutePath, "stage");

  try {
    await writeFile(stagedPath, content, { encoding: "utf8", flag: "wx", mode });
    await rename(stagedPath, absolutePath);
  } catch (error: unknown) {
    await unlink(stagedPath).catch(() => undefined);
    throw error;
  }
}

async function rollbackChange(change: IntegrationFileChange): Promise<void> {
  const currentContent = await readIntegrationFile(change.absolutePath);

  if (currentContent !== change.nextContent) {
    throw new Error(
      `SpotPatch init cannot restore ${change.relativePath} because it changed during initialization.`,
    );
  }

  if (change.previousContent === undefined) {
    await unlink(change.absolutePath);
    return;
  }

  const mode = (await stat(change.absolutePath)).mode & 0o777;
  await writeAtomic(change.absolutePath, change.previousContent, mode);
}

async function assertSafeTarget(
  appRoot: string,
  realAppRoot: string,
  change: IntegrationFileChange,
): Promise<void> {
  const target = path.resolve(change.absolutePath);
  const relativePath = relativePathWithin(appRoot, target);

  if (
    target !== change.absolutePath ||
    relativePath !== change.relativePath ||
    path.dirname(target) === target
  ) {
    throw new Error("SpotPatch init received an invalid integration file plan.");
  }

  let targetMetadata;

  try {
    targetMetadata = await lstat(target);
  } catch (error: unknown) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }

  if (targetMetadata?.isSymbolicLink()) {
    throw new Error(
      `SpotPatch refuses to modify the symbolic link ${change.relativePath}.`,
    );
  }

  const containmentAnchor = await realpath(
    targetMetadata === undefined ? path.dirname(target) : target,
  );

  if (!isPathWithin(realAppRoot, containmentAnchor)) {
    throw new Error("SpotPatch init refuses to modify a path outside the app root.");
  }
}

async function assertCurrentBaseline(change: IntegrationFileChange): Promise<void> {
  if (change.previousContent === undefined) {
    try {
      await lstat(change.absolutePath);
    } catch (error: unknown) {
      if (isMissingPathError(error)) {
        return;
      }

      throw error;
    }

    throw new Error(
      `SpotPatch init cannot create ${change.relativePath} because it now exists.`,
    );
  }

  const currentContent = await readIntegrationFile(change.absolutePath);

  if (currentContent !== change.previousContent) {
    throw new Error(
      `SpotPatch init cannot update ${change.relativePath} because it changed after the preview.`,
    );
  }
}

export async function applyIntegrationPlan(plan: IntegrationPlan): Promise<void> {
  if (plan.changes.length === 0) {
    return;
  }

  const appRoot = path.resolve(plan.appRoot);
  const realAppRoot = await realpath(appRoot);
  const targets = new Set<string>();

  for (const change of plan.changes) {
    if (targets.has(change.absolutePath)) {
      throw new Error("SpotPatch init received duplicate integration file changes.");
    }

    targets.add(change.absolutePath);
    await assertSafeTarget(appRoot, realAppRoot, change);
    await assertCurrentBaseline(change);
  }

  const applied: IntegrationFileChange[] = [];

  try {
    for (const change of plan.changes) {
      await assertCurrentBaseline(change);
      const mode =
        change.previousContent === undefined
          ? 0o600
          : (await stat(change.absolutePath)).mode & 0o777;
      await writeAtomic(change.absolutePath, change.nextContent, mode);
      applied.push(change);
    }
  } catch (error: unknown) {
    const rollbackResults = await Promise.allSettled(
      applied.reverse().map(rollbackChange),
    );

    if (rollbackResults.some((result) => result.status === "rejected")) {
      throw new Error(
        "SpotPatch init failed and could not completely restore the previous files.",
        { cause: error },
      );
    }

    throw new Error("SpotPatch init failed; all written files were restored.", {
      cause: error,
    });
  }
}
