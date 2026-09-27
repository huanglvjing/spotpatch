import { constants as fsConstants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { ContextualAskExecutorError } from "@spotpatch/agent";

import { isPathWithin } from "../trusted-path.js";
import { BoundedProcessError, runBoundedProcess } from "./process.js";

/**
 * Oldest Claude Code release verified against the flags the Ask executor
 * relies on (`--tools ""`, `--json-schema`, `--setting-sources`,
 * `--no-session-persistence`) and the stream-json `init` event it audits.
 */
export const MINIMUM_CLAUDE_CODE_VERSION = Object.freeze([2, 1, 283] as const);

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+) \(Claude Code\)$/u;
const PROBE_OUTPUT_LIMIT_BYTES = 8 * 1_024;
const PROBE_TIMEOUT_MS = 10_000;

export interface ResolvedClaudeCodeExecutable {
  readonly path: string;
  readonly version: string;
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR" || error.code === "EACCES")
  );
}

async function findOnPath(pathValue: string): Promise<string> {
  const name = process.platform === "win32" ? "claude.exe" : "claude";
  for (const entry of pathValue.split(path.delimiter)) {
    if (entry.length === 0 || !path.isAbsolute(entry)) continue;
    try {
      const canonical = await realpath(path.join(entry, name));
      if (!(await stat(canonical)).isFile()) continue;
      await access(canonical, fsConstants.X_OK);
      return canonical;
    } catch (error: unknown) {
      if (isMissingFileError(error)) continue;
      throw new ContextualAskExecutorError("ASK_EXECUTOR_UNAVAILABLE", {
        cause: error,
      });
    }
  }
  throw new ContextualAskExecutorError("ASK_EXECUTOR_UNAVAILABLE");
}

function supportsMinimumVersion(version: readonly number[]): boolean {
  for (const [index, minimum] of MINIMUM_CLAUDE_CODE_VERSION.entries()) {
    const actual = version[index] ?? 0;
    if (actual !== minimum) return actual > minimum;
  }
  return true;
}

/**
 * Finds Claude Code on absolute PATH entries only, and refuses any binary
 * that resolves inside the project, so a project cannot substitute its own
 * `claude` for the one the developer installed.
 */
export async function resolveClaudeCodeExecutable(
  projectRoot: string,
  options: Readonly<{ pathValue?: string | undefined }> = {},
): Promise<ResolvedClaudeCodeExecutable> {
  const canonicalRoot = await realpath(projectRoot);
  const executable = await findOnPath(options.pathValue ?? process.env.PATH ?? "");
  if (isPathWithin(canonicalRoot, executable)) {
    throw new ContextualAskExecutorError("ASK_EXECUTOR_UNAVAILABLE");
  }

  let output: string;
  try {
    const result = await runBoundedProcess(executable, ["--version"], {
      cwd: path.dirname(executable),
      environment: process.env,
      outputLimitBytes: PROBE_OUTPUT_LIMIT_BYTES,
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    if (result.exitCode !== 0)
      throw new ContextualAskExecutorError("ASK_EXECUTOR_UNAVAILABLE");
    output = result.stdout.trim();
  } catch (error: unknown) {
    if (error instanceof ContextualAskExecutorError) throw error;
    if (error instanceof BoundedProcessError) {
      throw new ContextualAskExecutorError("ASK_EXECUTOR_UNAVAILABLE", {
        cause: error,
      });
    }
    throw error;
  }

  const match = VERSION_PATTERN.exec(output);
  const version = match?.slice(1, 4).map(Number) ?? [];
  if (match === null || !supportsMinimumVersion(version)) {
    throw new ContextualAskExecutorError("ASK_PROTOCOL_INCOMPATIBLE");
  }
  return Object.freeze({ path: executable, version: version.join(".") });
}
