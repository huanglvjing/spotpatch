import { lstat } from "node:fs/promises";

import {
  ERROR_CODES,
  SpotPatchError,
  type AgentChangedFile,
  type AgentLimits,
} from "@spotpatch/shared";

import {
  assertAgentPathAllowed,
  resolveWritableAgentPath,
} from "../security/path-policy.js";
import { readAgentTextFile } from "../security/text-file.js";
import { runGitCommand } from "./git-command.js";
import { parseUnifiedPatch, type ParsedPatchFile } from "./patch-parser.js";

export interface AgentChangeSet {
  readonly diff: string;
  readonly files: readonly AgentChangedFile[];
  readonly hasDeletion: boolean;
  readonly touchedPaths: readonly string[];
}

function parseNumstat(value: string): ReadonlyMap<string, readonly [number, number]> {
  const result = new Map<string, readonly [number, number]>();

  for (const record of value.split("\0")) {
    if (record.length === 0) {
      continue;
    }

    const firstTab = record.indexOf("\t");
    const secondTab = record.indexOf("\t", firstTab + 1);

    if (firstTab <= 0 || secondTab <= firstTab) {
      throw new SpotPatchError(ERROR_CODES.PATCH_REJECTED);
    }

    const additionsText = record.slice(0, firstTab);
    const deletionsText = record.slice(firstTab + 1, secondTab);
    const relativePath = assertAgentPathAllowed(record.slice(secondTab + 1));
    const additions = Number(additionsText);
    const deletions = Number(deletionsText);

    if (
      !Number.isSafeInteger(additions) ||
      !Number.isSafeInteger(deletions) ||
      additions < 0 ||
      deletions < 0
    ) {
      throw new SpotPatchError(ERROR_CODES.PATCH_REJECTED);
    }

    result.set(relativePath, Object.freeze([additions, deletions]));
  }

  return result;
}

async function assertResultingFile(
  worktreeRoot: string,
  file: ParsedPatchFile,
  maximumBytes: number,
): Promise<void> {
  const absolutePath = await resolveWritableAgentPath(worktreeRoot, file.relativePath);
  const metadata = await lstat(absolutePath).catch(() => undefined);

  if (file.kind === "deleted") {
    if (metadata !== undefined) {
      throw new SpotPatchError(ERROR_CODES.PATCH_REJECTED);
    }

    return;
  }

  if (metadata === undefined || !metadata.isFile() || metadata.isSymbolicLink()) {
    throw new SpotPatchError(ERROR_CODES.PATCH_REJECTED);
  }

  await readAgentTextFile(worktreeRoot, file.relativePath, maximumBytes);
}

export async function applyAgentPatch(
  worktreeRoot: string,
  patch: string,
  limits: Readonly<AgentLimits>,
  signal: AbortSignal,
): Promise<readonly string[]> {
  if (Buffer.byteLength(patch, "utf8") > limits.maxDiffBytes) {
    throw new SpotPatchError(ERROR_CODES.AGENT_LIMIT_EXCEEDED);
  }

  const files = parseUnifiedPatch(patch);

  if (files.length > limits.maxChangedFiles) {
    throw new SpotPatchError(ERROR_CODES.AGENT_LIMIT_EXCEEDED);
  }

  await Promise.all(
    files.map(async (file) => {
      await resolveWritableAgentPath(worktreeRoot, file.relativePath);

      if (file.kind !== "added") {
        await readAgentTextFile(
          worktreeRoot,
          file.relativePath,
          limits.maxReadBytesPerFile,
        );
      }
    }),
  );
  await runGitCommand({
    cwd: worktreeRoot,
    args: ["apply", "--check", "--whitespace=error-all", "-"],
    stdin: patch,
    signal,
    errorCode: ERROR_CODES.PATCH_REJECTED,
  });
  await runGitCommand({
    cwd: worktreeRoot,
    args: ["apply", "--whitespace=error-all", "-"],
    stdin: patch,
    signal,
    errorCode: ERROR_CODES.PATCH_REJECTED,
  });

  for (const file of files) {
    await assertResultingFile(worktreeRoot, file, limits.maxReadBytesPerFile);

    if (file.kind === "added") {
      await runGitCommand({
        cwd: worktreeRoot,
        args: ["add", "--intent-to-add", "--", file.relativePath],
        signal,
        errorCode: ERROR_CODES.PATCH_REJECTED,
      });
    }
  }

  return Object.freeze(files.map((file) => file.relativePath));
}

export async function collectAgentChangeSet(
  worktreeRoot: string,
  allowedTouchedPaths: ReadonlySet<string>,
  limits: Readonly<AgentLimits>,
  signal: AbortSignal,
): Promise<AgentChangeSet> {
  const untrackedOutput = await runGitCommand({
    cwd: worktreeRoot,
    args: ["ls-files", "--others", "--exclude-standard", "-z"],
    signal,
  });

  for (const pathValue of untrackedOutput.split("\0")) {
    if (pathValue.length === 0) {
      continue;
    }

    const relativePath = assertAgentPathAllowed(pathValue);

    if (!allowedTouchedPaths.has(relativePath)) {
      throw new SpotPatchError(ERROR_CODES.PATCH_REJECTED);
    }
  }

  const diff = await runGitCommand({
    cwd: worktreeRoot,
    args: [
      "diff",
      "--no-ext-diff",
      "--no-color",
      "--no-renames",
      "--full-index",
      "HEAD",
      "--",
    ],
    signal,
    maxOutputCharacters: limits.maxDiffBytes + 1,
  });

  if (Buffer.byteLength(diff, "utf8") > limits.maxDiffBytes) {
    throw new SpotPatchError(ERROR_CODES.AGENT_LIMIT_EXCEEDED);
  }

  if (diff.length === 0) {
    return Object.freeze({
      diff: "",
      files: Object.freeze([]),
      hasDeletion: false,
      touchedPaths: Object.freeze([]),
    });
  }

  const parsedFiles = parseUnifiedPatch(diff);

  if (parsedFiles.length > limits.maxChangedFiles) {
    throw new SpotPatchError(ERROR_CODES.AGENT_LIMIT_EXCEEDED);
  }

  for (const file of parsedFiles) {
    if (!allowedTouchedPaths.has(file.relativePath)) {
      throw new SpotPatchError(ERROR_CODES.PATCH_REJECTED);
    }

    await assertResultingFile(worktreeRoot, file, limits.maxReadBytesPerFile);
  }

  const stats = parseNumstat(
    await runGitCommand({
      cwd: worktreeRoot,
      args: ["diff", "--numstat", "-z", "--no-renames", "HEAD", "--"],
      signal,
    }),
  );
  const files = parsedFiles.map((file) => {
    const counts = stats.get(file.relativePath);

    if (counts === undefined) {
      throw new SpotPatchError(ERROR_CODES.PATCH_REJECTED);
    }

    return Object.freeze({
      relativePath: file.relativePath,
      kind: file.kind,
      additions: counts[0],
      deletions: counts[1],
    });
  });

  return Object.freeze({
    diff,
    files: Object.freeze(files),
    hasDeletion: files.some((file) => file.kind === "deleted"),
    touchedPaths: Object.freeze(files.map((file) => file.relativePath)),
  });
}
