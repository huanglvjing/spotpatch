import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import {
  ERROR_CODES,
  SpotPatchError,
  type AgentWorkingTreeMode,
} from "@spotpatch/shared";

import { runGitCommand, runRawGitCommand, samePath } from "./git-command.js";
import { inspectGitWorkspace } from "./workspace-health.js";

export interface GitBaseline {
  readonly head: string;
  readonly root: string;
  readonly workingTreeMode: AgentWorkingTreeMode;
}

export interface IsolatedGitWorktree {
  readonly baseline: GitBaseline;
  readonly root: string;
  readonly cleanup: () => Promise<void>;
}

interface AssertGitBaselineOptions {
  readonly expectedHead?: string;
  readonly root: string;
  readonly signal?: AbortSignal;
}

export async function assertCleanGitBaseline(
  options: AssertGitBaselineOptions,
): Promise<GitBaseline> {
  const inspection = await inspectGitWorkspace(options.root, options.signal);
  const { head, root } = inspection;

  if (options.expectedHead !== undefined && head !== options.expectedHead) {
    throw new SpotPatchError(ERROR_CODES.APPLY_CONFLICT);
  }

  if (inspection.health.state !== "ready") {
    throw new SpotPatchError(
      options.expectedHead === undefined
        ? ERROR_CODES.WORKTREE_DIRTY
        : ERROR_CODES.APPLY_CONFLICT,
    );
  }

  return Object.freeze({ root, head, workingTreeMode: "require-clean" });
}

interface CreateIsolatedWorktreeOptions {
  readonly root: string;
  readonly signal: AbortSignal;
  readonly temporaryBase?: string;
  readonly workingTreeMode?: AgentWorkingTreeMode;
}

function workspacePath(root: string, relativePath: string): string {
  const candidate = path.resolve(root, relativePath);
  const relative = path.relative(root, candidate);

  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new SpotPatchError(ERROR_CODES.WORKTREE_LOCAL_CHANGES_UNSUPPORTED);
  }

  return candidate;
}

async function fileDigest(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

async function copyUntrackedFiles(
  sourceRoot: string,
  worktreeRoot: string,
  relativePaths: readonly string[],
): Promise<void> {
  for (const relativePath of relativePaths) {
    const sourcePath = workspacePath(sourceRoot, relativePath);
    const targetPath = workspacePath(worktreeRoot, relativePath);
    const metadata = await lstat(sourcePath).catch(() => undefined);

    if (metadata === undefined || !metadata.isFile() || metadata.isSymbolicLink()) {
      throw new SpotPatchError(ERROR_CODES.WORKTREE_LOCAL_CHANGES_UNSUPPORTED);
    }

    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);

    const [sourceDigest, targetDigest] = await Promise.all([
      fileDigest(sourcePath),
      fileDigest(targetPath),
    ]).catch(() => {
      throw new SpotPatchError(ERROR_CODES.APPLY_CONFLICT);
    });

    if (sourceDigest !== targetDigest) {
      throw new SpotPatchError(ERROR_CODES.APPLY_CONFLICT);
    }
  }
}

async function assertUntrackedFilesUnchanged(
  sourceRoot: string,
  worktreeRoot: string,
  relativePaths: readonly string[],
): Promise<void> {
  for (const relativePath of relativePaths) {
    const sourcePath = workspacePath(sourceRoot, relativePath);
    const targetPath = workspacePath(worktreeRoot, relativePath);

    const [sourceDigest, targetDigest] = await Promise.all([
      fileDigest(sourcePath),
      fileDigest(targetPath),
    ]).catch(() => {
      throw new SpotPatchError(ERROR_CODES.APPLY_CONFLICT);
    });

    if (sourceDigest !== targetDigest) {
      throw new SpotPatchError(ERROR_CODES.APPLY_CONFLICT);
    }
  }
}

async function materializeLocalBaseline(
  sourceRoot: string,
  worktreeRoot: string,
  expectedHead: string,
  untrackedPaths: readonly string[],
  signal: AbortSignal,
): Promise<void> {
  const sourceDiff = await runGitCommand({
    cwd: sourceRoot,
    args: [
      "diff",
      "--binary",
      "--full-index",
      "--no-ext-diff",
      "--no-color",
      "--no-renames",
      "HEAD",
      "--",
    ],
    signal,
    errorCode: ERROR_CODES.WORKTREE_LOCAL_CHANGES_UNSUPPORTED,
  });

  if (sourceDiff.length > 0) {
    await runGitCommand({
      cwd: worktreeRoot,
      args: ["apply", "--binary", "--whitespace=nowarn", "-"],
      stdin: sourceDiff,
      signal,
      errorCode: ERROR_CODES.WORKTREE_LOCAL_CHANGES_UNSUPPORTED,
    });
  }

  await copyUntrackedFiles(sourceRoot, worktreeRoot, untrackedPaths);
  const confirmation = await inspectGitWorkspace(sourceRoot, signal);
  const confirmationDiff = await runGitCommand({
    cwd: sourceRoot,
    args: [
      "diff",
      "--binary",
      "--full-index",
      "--no-ext-diff",
      "--no-color",
      "--no-renames",
      "HEAD",
      "--",
    ],
    signal,
    errorCode: ERROR_CODES.APPLY_CONFLICT,
  });

  if (
    confirmation.head !== expectedHead ||
    confirmationDiff !== sourceDiff ||
    confirmation.untrackedPaths.length !== untrackedPaths.length ||
    confirmation.untrackedPaths.some((value, index) => value !== untrackedPaths[index])
  ) {
    throw new SpotPatchError(ERROR_CODES.APPLY_CONFLICT);
  }

  await assertUntrackedFilesUnchanged(sourceRoot, worktreeRoot, untrackedPaths);

  await runGitCommand({
    cwd: worktreeRoot,
    args: ["add", "--all"],
    signal,
    errorCode: ERROR_CODES.WORKTREE_LOCAL_CHANGES_UNSUPPORTED,
  });
  await runGitCommand({
    cwd: worktreeRoot,
    args: [
      "-c",
      "user.name=SpotPatch Agent",
      "-c",
      "user.email=spotpatch-agent@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "SpotPatch local workspace baseline",
    ],
    signal,
    errorCode: ERROR_CODES.WORKTREE_LOCAL_CHANGES_UNSUPPORTED,
  });
}

async function defaultTemporaryBase(root: string): Promise<string> {
  const dependencyDirectory = path.join(root, "node_modules");

  try {
    const stats = await lstat(dependencyDirectory);

    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      return os.tmpdir();
    }

    return await realpath(dependencyDirectory);
  } catch {
    return os.tmpdir();
  }
}

export async function createIsolatedGitWorktree(
  options: CreateIsolatedWorktreeOptions,
): Promise<IsolatedGitWorktree> {
  const workingTreeMode = options.workingTreeMode ?? "require-clean";
  const inspection = await inspectGitWorkspace(options.root, options.signal);

  if (inspection.health.state === "blocked") {
    throw new SpotPatchError(
      inspection.health.errorCode ?? ERROR_CODES.WORKTREE_LOCAL_CHANGES_UNSUPPORTED,
    );
  }

  if (
    inspection.health.state === "consent-required" &&
    workingTreeMode === "require-clean"
  ) {
    throw new SpotPatchError(ERROR_CODES.WORKTREE_DIRTY);
  }

  const baseline = Object.freeze({
    root: inspection.root,
    head: inspection.head,
    workingTreeMode,
  });
  const temporaryBase =
    options.temporaryBase ?? (await defaultTemporaryBase(baseline.root));
  const temporaryDirectory = await mkdtemp(
    path.join(temporaryBase, "spotpatch-agent-"),
  );
  const worktreePath = path.join(temporaryDirectory, "worktree");
  let registered = false;
  let cleaned = false;

  const cleanup = async (): Promise<void> => {
    if (cleaned) {
      return;
    }

    cleaned = true;

    if (registered) {
      await runRawGitCommand({
        cwd: baseline.root,
        args: ["worktree", "remove", "--force", worktreePath],
        timeoutMs: 30_000,
      }).catch(() => undefined);
    }

    if (path.basename(temporaryDirectory).startsWith("spotpatch-agent-")) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  };

  try {
    await runGitCommand({
      cwd: baseline.root,
      args: ["worktree", "add", "--detach", worktreePath, baseline.head],
      errorCode: ERROR_CODES.INTERNAL_ERROR,
      signal: options.signal,
      timeoutMs: 30_000,
    });
    registered = true;
    const worktreeRoot = await realpath(worktreePath);
    const actualHead = (
      await runGitCommand({
        cwd: worktreeRoot,
        args: ["rev-parse", "--verify", "HEAD"],
        signal: options.signal,
      })
    ).trim();
    const actualRoot = (
      await runGitCommand({
        cwd: worktreeRoot,
        args: ["rev-parse", "--show-toplevel"],
        signal: options.signal,
      })
    ).trim();

    if (actualHead !== baseline.head || !samePath(actualRoot, worktreeRoot)) {
      throw new SpotPatchError(ERROR_CODES.INTERNAL_ERROR);
    }

    if (inspection.health.state === "consent-required") {
      await materializeLocalBaseline(
        baseline.root,
        worktreeRoot,
        baseline.head,
        inspection.untrackedPaths,
        options.signal,
      );
    }

    return Object.freeze({ baseline, root: worktreeRoot, cleanup });
  } catch (error: unknown) {
    await cleanup();
    throw error;
  }
}
