import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";

import { ERROR_CODES, SpotPatchError, type AgentJobResult } from "@spotpatch/shared";

import {
  assertAgentPathAllowed,
  resolveWritableAgentPath,
} from "../security/path-policy.js";
import { runGitCommand } from "./git-command.js";
import { inspectGitWorkspace } from "./workspace-health.js";

export interface PreparedAgentChange {
  readonly kind: "prepared-agent-change";
  readonly result: AgentJobResult;
  readonly validationPassed: boolean;
  readonly autoApplyEligible: boolean;
}

type PreparedState = "prepared" | "applying" | "applied" | "reverting" | "reverted";

interface PrivatePreparedChange {
  readonly baselineHead: string;
  readonly baselineHashes: ReadonlyMap<string, string>;
  readonly diff: string;
  readonly expectedHashes: ReadonlyMap<string, string>;
  readonly root: string;
  readonly touchedPaths: readonly string[];
  appliedHashes?: ReadonlyMap<string, string>;
  state: PreparedState;
}

const privateChanges = new WeakMap<PreparedAgentChange, PrivatePreparedChange>();
const DELETED_HASH = "<deleted>";

interface CreatePreparedChangeOptions {
  readonly autoApplyEligible: boolean;
  readonly baselineHead: string;
  readonly baselineHashes: ReadonlyMap<string, string>;
  readonly expectedHashes: ReadonlyMap<string, string>;
  readonly result: AgentJobResult;
  readonly root: string;
  readonly validationPassed: boolean;
}

export function createPreparedAgentChange(
  options: CreatePreparedChangeOptions,
): PreparedAgentChange {
  const touchedPaths = Object.freeze(
    options.result.files.map((file) => file.relativePath),
  );

  if (
    options.baselineHashes.size !== touchedPaths.length ||
    options.expectedHashes.size !== touchedPaths.length ||
    touchedPaths.some(
      (relativePath) =>
        !options.baselineHashes.has(relativePath) ||
        !options.expectedHashes.has(relativePath),
    )
  ) {
    throw new SpotPatchError(ERROR_CODES.INTERNAL_ERROR);
  }

  const change = Object.freeze({
    kind: "prepared-agent-change",
    result: options.result,
    validationPassed: options.validationPassed,
    autoApplyEligible: options.autoApplyEligible,
  } as const);
  privateChanges.set(change, {
    baselineHead: options.baselineHead,
    baselineHashes: new Map(options.baselineHashes),
    diff: options.result.diff,
    expectedHashes: new Map(options.expectedHashes),
    root: options.root,
    state: "prepared",
    touchedPaths,
  });
  return change;
}

function requirePrivateChange(change: PreparedAgentChange): PrivatePreparedChange {
  const privateChange = privateChanges.get(change);

  if (privateChange === undefined) {
    throw new SpotPatchError(ERROR_CODES.INTERNAL_ERROR);
  }

  return privateChange;
}

async function assertWorkspaceOperationSafe(
  root: string,
  expectedHead: string,
): Promise<void> {
  const inspection = await inspectGitWorkspace(root).catch(() => {
    throw new SpotPatchError(ERROR_CODES.APPLY_CONFLICT);
  });
  const blockingOperation =
    inspection.health.errorCode === ERROR_CODES.WORKTREE_OPERATION_IN_PROGRESS ||
    inspection.health.errorCode === ERROR_CODES.WORKTREE_CONFLICTED;

  if (inspection.head !== expectedHead || blockingOperation) {
    throw new SpotPatchError(ERROR_CODES.APPLY_CONFLICT);
  }
}

async function fileHash(root: string, relativePath: string): Promise<string> {
  const normalized = assertAgentPathAllowed(relativePath);
  const absolutePath = await resolveWritableAgentPath(root, normalized);
  const metadata = await lstat(absolutePath).catch(() => undefined);

  if (metadata === undefined) {
    return DELETED_HASH;
  }

  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new SpotPatchError(ERROR_CODES.APPLY_CONFLICT);
  }

  return createHash("sha256")
    .update(await readFile(absolutePath))
    .digest("hex");
}

export async function captureAgentFileHashes(
  root: string,
  paths: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const entries = await Promise.all(
    paths.map(async (relativePath) =>
      Object.freeze([relativePath, await fileHash(root, relativePath)] as const),
    ),
  );
  return new Map(entries);
}

function hashesMatch(
  expected: ReadonlyMap<string, string>,
  actual: ReadonlyMap<string, string>,
): boolean {
  return (
    expected.size === actual.size &&
    [...expected].every(([relativePath, hash]) => actual.get(relativePath) === hash)
  );
}

export async function applyPreparedAgentChange(
  change: PreparedAgentChange,
): Promise<void> {
  const privateChange = requirePrivateChange(change);

  if (
    privateChange.state !== "prepared" ||
    !change.validationPassed ||
    privateChange.diff.length === 0
  ) {
    throw new SpotPatchError(
      change.validationPassed
        ? ERROR_CODES.APPLY_CONFLICT
        : ERROR_CODES.VALIDATION_FAILED,
    );
  }

  privateChange.state = "applying";

  try {
    await assertWorkspaceOperationSafe(privateChange.root, privateChange.baselineHead);

    const currentHashes = await captureAgentFileHashes(
      privateChange.root,
      privateChange.touchedPaths,
    );

    if (!hashesMatch(privateChange.baselineHashes, currentHashes)) {
      throw new SpotPatchError(ERROR_CODES.APPLY_CONFLICT);
    }
    await runGitCommand({
      cwd: privateChange.root,
      args: ["apply", "--check", "--whitespace=error-all", "-"],
      stdin: privateChange.diff,
      errorCode: ERROR_CODES.APPLY_CONFLICT,
    });
    await runGitCommand({
      cwd: privateChange.root,
      args: ["apply", "--whitespace=error-all", "-"],
      stdin: privateChange.diff,
      errorCode: ERROR_CODES.APPLY_CONFLICT,
    });
    const appliedHashes = await captureAgentFileHashes(
      privateChange.root,
      privateChange.touchedPaths,
    );

    if (!hashesMatch(privateChange.expectedHashes, appliedHashes)) {
      throw new SpotPatchError(ERROR_CODES.APPLY_CONFLICT);
    }

    privateChange.appliedHashes = appliedHashes;
    privateChange.state = "applied";
  } catch (error: unknown) {
    privateChange.state = "prepared";
    throw error;
  }
}

export async function revertPreparedAgentChange(
  change: PreparedAgentChange,
): Promise<void> {
  const privateChange = requirePrivateChange(change);

  if (privateChange.state !== "applied" || privateChange.appliedHashes === undefined) {
    throw new SpotPatchError(ERROR_CODES.APPLY_CONFLICT);
  }

  privateChange.state = "reverting";

  try {
    await assertWorkspaceOperationSafe(privateChange.root, privateChange.baselineHead);

    const currentHashes = await captureAgentFileHashes(
      privateChange.root,
      privateChange.touchedPaths,
    );

    for (const [relativePath, expectedHash] of privateChange.appliedHashes) {
      if (currentHashes.get(relativePath) !== expectedHash) {
        throw new SpotPatchError(ERROR_CODES.APPLY_CONFLICT);
      }
    }

    await runGitCommand({
      cwd: privateChange.root,
      args: ["apply", "--reverse", "--check", "--whitespace=error-all", "-"],
      stdin: privateChange.diff,
      errorCode: ERROR_CODES.APPLY_CONFLICT,
    });
    await runGitCommand({
      cwd: privateChange.root,
      args: ["apply", "--reverse", "--whitespace=error-all", "-"],
      stdin: privateChange.diff,
      errorCode: ERROR_CODES.APPLY_CONFLICT,
    });
    const revertedHashes = await captureAgentFileHashes(
      privateChange.root,
      privateChange.touchedPaths,
    );

    if (!hashesMatch(privateChange.baselineHashes, revertedHashes)) {
      throw new SpotPatchError(ERROR_CODES.APPLY_CONFLICT);
    }

    privateChange.state = "reverted";
  } catch (error: unknown) {
    privateChange.state = "applied";
    throw error;
  }
}
