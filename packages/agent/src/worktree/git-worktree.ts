import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ERROR_CODES, SpotPatchError } from "@spotpatch/shared";

import { runGitCommand, runRawGitCommand, samePath } from "./git-command.js";

export interface GitBaseline {
  readonly head: string;
  readonly root: string;
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
  const root = await realpath(options.root).catch(() => {
    throw new SpotPatchError(ERROR_CODES.WORKTREE_DIRTY);
  });
  const topLevel = (
    await runGitCommand({
      cwd: root,
      args: ["rev-parse", "--show-toplevel"],
      errorCode: ERROR_CODES.WORKTREE_DIRTY,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  ).trim();

  if (!samePath(root, topLevel)) {
    throw new SpotPatchError(ERROR_CODES.WORKTREE_DIRTY);
  }

  const head = (
    await runGitCommand({
      cwd: root,
      args: ["rev-parse", "--verify", "HEAD"],
      errorCode: ERROR_CODES.WORKTREE_DIRTY,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  ).trim();

  if (options.expectedHead !== undefined && head !== options.expectedHead) {
    throw new SpotPatchError(ERROR_CODES.APPLY_CONFLICT);
  }

  const status = await runGitCommand({
    cwd: root,
    args: ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    errorCode: ERROR_CODES.WORKTREE_DIRTY,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });

  if (status.length > 0) {
    throw new SpotPatchError(
      options.expectedHead === undefined
        ? ERROR_CODES.WORKTREE_DIRTY
        : ERROR_CODES.APPLY_CONFLICT,
    );
  }

  return Object.freeze({ root, head });
}

interface CreateIsolatedWorktreeOptions {
  readonly root: string;
  readonly signal: AbortSignal;
  readonly temporaryBase?: string;
}

export async function createIsolatedGitWorktree(
  options: CreateIsolatedWorktreeOptions,
): Promise<IsolatedGitWorktree> {
  const baseline = await assertCleanGitBaseline({
    root: options.root,
    signal: options.signal,
  });
  const temporaryBase = options.temporaryBase ?? os.tmpdir();
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

    return Object.freeze({ baseline, root: worktreeRoot, cleanup });
  } catch (error: unknown) {
    await cleanup();
    throw error;
  }
}
