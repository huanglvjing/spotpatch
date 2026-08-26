import { lstat, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ERROR_CODES, SpotPatchError } from "@spotpatch/shared";

import { runGitCommand, runRawGitCommand, samePath } from "./git-command.js";
import { inspectGitWorkspace } from "./workspace-health.js";

const SNAPSHOT_DIRECTORY_PREFIX = "spotpatch-managed-";

export interface IndependentGitSnapshot {
  readonly baseline: Readonly<{ head: string; root: string }>;
  readonly metadataRoot: string;
  readonly root: string;
  readonly workspacePrefix: string;
  readonly workspaceRoot: string;
  assertIntegrity(signal: AbortSignal): Promise<void>;
  cleanup(): Promise<void>;
}

export interface CreateIndependentGitSnapshotOptions {
  readonly requiredCleanPaths?: readonly string[];
  readonly root: string;
  readonly signal: AbortSignal;
  readonly temporaryBase?: string;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) < 32) return true;
  }
  return false;
}

function workspacePath(root: string, relativePath: string): string {
  if (
    relativePath.length === 0 ||
    relativePath.includes("\0") ||
    relativePath.includes("\\") ||
    path.posix.isAbsolute(relativePath)
  ) {
    throw new SpotPatchError(ERROR_CODES.WORKTREE_LOCAL_CHANGES_UNSUPPORTED);
  }

  const segments = relativePath.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        hasControlCharacter(segment),
    ) ||
    path.posix.normalize(relativePath) !== relativePath
  ) {
    throw new SpotPatchError(ERROR_CODES.WORKTREE_LOCAL_CHANGES_UNSUPPORTED);
  }

  return path.resolve(root, ...segments);
}

async function requiredRepositoryPaths(
  sourceWorkspaceRoot: string,
  repositoryRoot: string,
  requiredCleanPaths: readonly string[],
): Promise<readonly string[]> {
  if (requiredCleanPaths.length === 0) {
    throw new SpotPatchError(ERROR_CODES.WORKTREE_LOCAL_CHANGES_UNSUPPORTED);
  }

  const result: string[] = [];
  const seen = new Set<string>();

  for (const requiredPath of requiredCleanPaths) {
    const candidate = workspacePath(sourceWorkspaceRoot, requiredPath);
    const metadata = await lstat(candidate).catch(() => undefined);
    if (metadata === undefined || !metadata.isFile() || metadata.isSymbolicLink()) {
      throw new SpotPatchError(ERROR_CODES.WORKTREE_DIRTY);
    }

    const canonical = await realpath(candidate);
    if (!samePath(candidate, canonical)) {
      throw new SpotPatchError(ERROR_CODES.WORKTREE_LOCAL_CHANGES_UNSUPPORTED);
    }
    const repositoryPath = path.relative(repositoryRoot, canonical);
    if (
      repositoryPath.length === 0 ||
      repositoryPath === ".." ||
      repositoryPath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(repositoryPath)
    ) {
      throw new SpotPatchError(ERROR_CODES.WORKTREE_LOCAL_CHANGES_UNSUPPORTED);
    }

    const normalized = repositoryPath.split(path.sep).join("/");
    const identity =
      process.platform === "win32" ? normalized.toLowerCase() : normalized;
    if (seen.has(identity)) {
      throw new SpotPatchError(ERROR_CODES.WORKTREE_LOCAL_CHANGES_UNSUPPORTED);
    }
    seen.add(identity);
    result.push(normalized);
  }

  return Object.freeze(result);
}

async function assertRequiredPathsClean(
  repositoryRoot: string,
  requiredPaths: readonly string[],
  signal: AbortSignal,
): Promise<void> {
  await runGitCommand({
    cwd: repositoryRoot,
    args: [
      "--literal-pathspecs",
      "ls-files",
      "--error-unmatch",
      "--",
      ...requiredPaths,
    ],
    errorCode: ERROR_CODES.WORKTREE_DIRTY,
    signal,
  });
  const status = await runGitCommand({
    cwd: repositoryRoot,
    args: [
      "--literal-pathspecs",
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      ...requiredPaths,
    ],
    errorCode: ERROR_CODES.WORKTREE_LOCAL_CHANGES_UNSUPPORTED,
    signal,
  });
  if (status.length > 0) {
    throw new SpotPatchError(ERROR_CODES.WORKTREE_DIRTY);
  }
}

async function assertIndependentRepository(
  snapshotRoot: string,
  temporaryDirectory: string,
  expectedMetadataRoot: string,
  expectedGitPointer: string,
  expectedHead: string,
  signal: AbortSignal,
): Promise<void> {
  const gitPointerPath = path.join(snapshotRoot, ".git");
  const [gitPointerMetadata, gitPointer] = await Promise.all([
    lstat(gitPointerPath),
    readFile(gitPointerPath, "utf8"),
  ]);
  if (
    !gitPointerMetadata.isFile() ||
    gitPointerMetadata.isSymbolicLink() ||
    gitPointer !== expectedGitPointer
  ) {
    throw new SpotPatchError(ERROR_CODES.WORKTREE_LOCAL_CHANGES_UNSUPPORTED);
  }

  const [actualHead, topLevel, commonDirectory, remote] = await Promise.all([
    runGitCommand({
      cwd: snapshotRoot,
      args: ["rev-parse", "--verify", "HEAD"],
      signal,
    }),
    runGitCommand({
      cwd: snapshotRoot,
      args: ["rev-parse", "--show-toplevel"],
      signal,
    }),
    runGitCommand({
      cwd: snapshotRoot,
      args: ["rev-parse", "--git-common-dir"],
      signal,
    }),
    runRawGitCommand({
      cwd: snapshotRoot,
      args: ["remote"],
      signal,
    }),
  ]);
  const canonicalTemporaryDirectory = await realpath(temporaryDirectory);
  const canonicalCommonDirectory = await realpath(
    path.resolve(snapshotRoot, commonDirectory.trim()),
  );
  const relativeCommonDirectory = path.relative(
    canonicalTemporaryDirectory,
    canonicalCommonDirectory,
  );
  const alternates = await lstat(
    path.join(canonicalCommonDirectory, "objects", "info", "alternates"),
  ).catch(() => undefined);

  if (
    actualHead.trim() !== expectedHead ||
    !samePath(topLevel.trim(), snapshotRoot) ||
    !samePath(canonicalCommonDirectory, expectedMetadataRoot) ||
    remote.exitCode !== 0 ||
    remote.stdout.trim().length > 0 ||
    relativeCommonDirectory === ".." ||
    relativeCommonDirectory.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeCommonDirectory) ||
    alternates !== undefined
  ) {
    throw new SpotPatchError(ERROR_CODES.WORKTREE_LOCAL_CHANGES_UNSUPPORTED);
  }
}

export async function createIndependentGitSnapshot(
  options: CreateIndependentGitSnapshotOptions,
): Promise<IndependentGitSnapshot> {
  const sourceWorkspaceRoot = await realpath(options.root);
  const repositoryRoot = await realpath(
    (
      await runGitCommand({
        cwd: sourceWorkspaceRoot,
        args: ["rev-parse", "--show-toplevel"],
        errorCode: ERROR_CODES.WORKTREE_NOT_REPOSITORY,
        signal: options.signal,
      })
    ).trim(),
  );
  const workspaceFromRepository = path.relative(repositoryRoot, sourceWorkspaceRoot);
  if (
    workspaceFromRepository === ".." ||
    workspaceFromRepository.startsWith(`..${path.sep}`) ||
    path.isAbsolute(workspaceFromRepository)
  ) {
    throw new SpotPatchError(ERROR_CODES.WORKTREE_NOT_REPOSITORY);
  }
  const inspection = await inspectGitWorkspace(repositoryRoot, options.signal);

  if (inspection.health.state === "blocked") {
    throw new SpotPatchError(inspection.health.errorCode ?? ERROR_CODES.WORKTREE_DIRTY);
  }
  if (options.requiredCleanPaths === undefined) {
    if (inspection.health.state !== "ready") {
      throw new SpotPatchError(ERROR_CODES.WORKTREE_DIRTY);
    }
  } else {
    const requiredPaths = await requiredRepositoryPaths(
      sourceWorkspaceRoot,
      repositoryRoot,
      options.requiredCleanPaths,
    );
    await assertRequiredPathsClean(repositoryRoot, requiredPaths, options.signal);
  }

  const temporaryBase = await realpath(options.temporaryBase ?? os.tmpdir());
  const temporaryDirectory = await mkdtemp(
    path.join(temporaryBase, SNAPSHOT_DIRECTORY_PREFIX),
  );
  const snapshotPath = path.join(temporaryDirectory, "repository");
  const metadataPath = path.join(temporaryDirectory, "metadata");
  let cleaned = false;

  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    const parent = path.dirname(temporaryDirectory);

    if (
      samePath(parent, temporaryBase) &&
      path.basename(temporaryDirectory).startsWith(SNAPSHOT_DIRECTORY_PREFIX)
    ) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  };

  try {
    await runGitCommand({
      cwd: temporaryBase,
      args: [
        "clone",
        "--quiet",
        "--no-hardlinks",
        "--no-checkout",
        "--separate-git-dir",
        metadataPath,
        "--",
        inspection.root,
        snapshotPath,
      ],
      errorCode: ERROR_CODES.WORKTREE_LOCAL_CHANGES_UNSUPPORTED,
      signal: options.signal,
      timeoutMs: 120_000,
    });
    const expectedGitPointer = await readFile(path.join(snapshotPath, ".git"), "utf8");
    await runGitCommand({
      cwd: snapshotPath,
      args: ["checkout", "--quiet", "--detach", inspection.head],
      errorCode: ERROR_CODES.WORKTREE_LOCAL_CHANGES_UNSUPPORTED,
      signal: options.signal,
      timeoutMs: 60_000,
    });
    await runGitCommand({
      cwd: snapshotPath,
      args: ["remote", "remove", "origin"],
      errorCode: ERROR_CODES.WORKTREE_LOCAL_CHANGES_UNSUPPORTED,
      signal: options.signal,
    });
    const snapshotRoot = await realpath(snapshotPath);
    const metadataRoot = await realpath(metadataPath);
    const relativeWorkspace = path.relative(inspection.root, sourceWorkspaceRoot);
    if (
      relativeWorkspace === ".." ||
      relativeWorkspace.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeWorkspace)
    ) {
      throw new SpotPatchError(ERROR_CODES.WORKTREE_LOCAL_CHANGES_UNSUPPORTED);
    }
    const workspaceRoot = await realpath(path.join(snapshotRoot, relativeWorkspace));
    const workspacePrefix = relativeWorkspace.split(path.sep).join("/");
    const assertIntegrity = (signal: AbortSignal): Promise<void> =>
      assertIndependentRepository(
        snapshotRoot,
        temporaryDirectory,
        metadataRoot,
        expectedGitPointer,
        inspection.head,
        signal,
      );
    await assertIndependentRepository(
      snapshotRoot,
      temporaryDirectory,
      metadataRoot,
      expectedGitPointer,
      inspection.head,
      options.signal,
    );

    return Object.freeze({
      baseline: Object.freeze({ root: inspection.root, head: inspection.head }),
      metadataRoot,
      root: snapshotRoot,
      workspacePrefix,
      workspaceRoot,
      assertIntegrity,
      cleanup,
    });
  } catch (error: unknown) {
    await cleanup();
    throw error;
  }
}
