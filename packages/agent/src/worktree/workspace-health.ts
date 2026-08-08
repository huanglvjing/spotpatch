import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import {
  AGENT_WORKSPACE_SNAPSHOT_LIMITS,
  ERROR_CODES,
  SpotPatchError,
  type AgentWorkspaceChangeSummary,
  type AgentWorkspaceHealthSnapshot,
  type ErrorCode,
} from "@spotpatch/shared";

import { runGitCommand, runRawGitCommand, samePath } from "./git-command.js";

const CONFLICTED_STATUSES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
const OPERATION_MARKERS = Object.freeze([
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "rebase-apply",
  "rebase-merge",
]);

export interface GitWorkspaceInspection {
  readonly root: string;
  readonly head: string;
  readonly health: AgentWorkspaceHealthSnapshot;
  readonly untrackedPaths: readonly string[];
}

interface ParsedStatus {
  readonly changes: AgentWorkspaceChangeSummary;
  readonly untrackedPaths: readonly string[];
}

function emptyChanges(): AgentWorkspaceChangeSummary {
  return Object.freeze({
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    total: 0,
  });
}

function blockedHealth(errorCode: ErrorCode): AgentWorkspaceHealthSnapshot {
  return Object.freeze({
    state: "blocked",
    checkedAt: new Date().toISOString(),
    changes: emptyChanges(),
    canIncludeLocalChanges: false,
    errorCode,
  });
}

function parsePorcelainStatus(value: string): ParsedStatus {
  const records = value.split("\0");
  const untrackedPaths: string[] = [];
  let staged = 0;
  let unstaged = 0;
  let conflicted = 0;
  let total = 0;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? "";

    if (record.length === 0) {
      continue;
    }

    if (record.length < 4 || record[2] !== " ") {
      throw new SpotPatchError(ERROR_CODES.WORKTREE_LOCAL_CHANGES_UNSUPPORTED);
    }

    const status = record.slice(0, 2);
    const relativePath = record.slice(3);

    if (relativePath.length === 0) {
      throw new SpotPatchError(ERROR_CODES.WORKTREE_LOCAL_CHANGES_UNSUPPORTED);
    }

    total += 1;

    if (status === "??") {
      untrackedPaths.push(relativePath);
      continue;
    }

    const indexStatus = status[0] ?? " ";
    const worktreeStatus = status[1] ?? " ";

    if (
      CONFLICTED_STATUSES.has(status) ||
      indexStatus === "U" ||
      worktreeStatus === "U"
    ) {
      conflicted += 1;
    }

    if (indexStatus !== " ") {
      staged += 1;
    }

    if (worktreeStatus !== " ") {
      unstaged += 1;
    }

    if (indexStatus === "R" || indexStatus === "C") {
      index += 1;

      if ((records[index] ?? "").length === 0) {
        throw new SpotPatchError(ERROR_CODES.WORKTREE_LOCAL_CHANGES_UNSUPPORTED);
      }
    }
  }

  return Object.freeze({
    changes: Object.freeze({
      staged,
      unstaged,
      untracked: untrackedPaths.length,
      conflicted,
      total,
    }),
    untrackedPaths: Object.freeze(untrackedPaths),
  });
}

async function operationInProgress(
  root: string,
  signal?: AbortSignal,
): Promise<boolean> {
  for (const marker of OPERATION_MARKERS) {
    const markerPath = (
      await runGitCommand({
        cwd: root,
        args: ["rev-parse", "--git-path", marker],
        errorCode: ERROR_CODES.WORKTREE_NOT_REPOSITORY,
        ...(signal === undefined ? {} : { signal }),
      })
    ).trim();

    if (
      (await lstat(path.resolve(root, markerPath)).catch(() => undefined)) !== undefined
    ) {
      return true;
    }
  }

  return false;
}

async function inspectUntrackedFiles(
  root: string,
  relativePaths: readonly string[],
): Promise<ErrorCode | undefined> {
  if (relativePaths.length > AGENT_WORKSPACE_SNAPSHOT_LIMITS.maxUntrackedFiles) {
    return ERROR_CODES.WORKTREE_LOCAL_CHANGES_TOO_LARGE;
  }

  let totalBytes = 0;

  for (const relativePath of relativePaths) {
    const absolutePath = path.resolve(root, relativePath);
    const relative = path.relative(root, absolutePath);

    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      return ERROR_CODES.WORKTREE_UNTRACKED_UNSUPPORTED;
    }

    const metadata = await lstat(absolutePath).catch(() => undefined);

    if (metadata === undefined || !metadata.isFile() || metadata.isSymbolicLink()) {
      return ERROR_CODES.WORKTREE_UNTRACKED_UNSUPPORTED;
    }

    totalBytes += metadata.size;

    if (totalBytes > AGENT_WORKSPACE_SNAPSHOT_LIMITS.maxUntrackedBytes) {
      return ERROR_CODES.WORKTREE_LOCAL_CHANGES_TOO_LARGE;
    }
  }

  return undefined;
}

export async function inspectGitWorkspace(
  rootValue: string,
  signal?: AbortSignal,
): Promise<GitWorkspaceInspection> {
  const root = await realpath(rootValue).catch(() => {
    throw new SpotPatchError(ERROR_CODES.WORKTREE_NOT_REPOSITORY);
  });
  const topLevelResult = await runRawGitCommand({
    cwd: root,
    args: ["rev-parse", "--show-toplevel"],
    ...(signal === undefined ? {} : { signal }),
  });

  if (
    topLevelResult.exitCode !== 0 ||
    topLevelResult.cancelled ||
    topLevelResult.timedOut
  ) {
    throw new SpotPatchError(ERROR_CODES.WORKTREE_NOT_REPOSITORY);
  }

  const topLevel = topLevelResult.stdout.trim();

  if (!samePath(root, topLevel)) {
    throw new SpotPatchError(ERROR_CODES.WORKTREE_NOT_REPOSITORY);
  }

  const head = (
    await runGitCommand({
      cwd: root,
      args: ["rev-parse", "--verify", "HEAD"],
      errorCode: ERROR_CODES.WORKTREE_NOT_REPOSITORY,
      ...(signal === undefined ? {} : { signal }),
    })
  ).trim();
  const parsed = parsePorcelainStatus(
    await runGitCommand({
      cwd: root,
      args: ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      errorCode: ERROR_CODES.WORKTREE_NOT_REPOSITORY,
      ...(signal === undefined ? {} : { signal }),
    }),
  );
  const operationActive = await operationInProgress(root, signal);
  const untrackedError = await inspectUntrackedFiles(root, parsed.untrackedPaths);
  const errorCode = operationActive
    ? ERROR_CODES.WORKTREE_OPERATION_IN_PROGRESS
    : parsed.changes.conflicted > 0
      ? ERROR_CODES.WORKTREE_CONFLICTED
      : untrackedError;
  const health = Object.freeze({
    state:
      errorCode !== undefined
        ? "blocked"
        : parsed.changes.total === 0
          ? "ready"
          : "consent-required",
    checkedAt: new Date().toISOString(),
    changes: parsed.changes,
    canIncludeLocalChanges: errorCode === undefined && parsed.changes.total > 0,
    ...(errorCode === undefined ? {} : { errorCode }),
  } satisfies AgentWorkspaceHealthSnapshot);

  return Object.freeze({
    root,
    head,
    health,
    untrackedPaths: parsed.untrackedPaths,
  });
}

export async function inspectAgentWorkspace(
  root: string,
  signal?: AbortSignal,
): Promise<AgentWorkspaceHealthSnapshot> {
  try {
    return (await inspectGitWorkspace(root, signal)).health;
  } catch (error: unknown) {
    if (error instanceof SpotPatchError) {
      return blockedHealth(error.code);
    }

    return blockedHealth(ERROR_CODES.INTERNAL_ERROR);
  }
}
