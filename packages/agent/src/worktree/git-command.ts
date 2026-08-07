import path from "node:path";

import { ERROR_CODES, SpotPatchError, type ErrorCode } from "@spotpatch/shared";

import {
  minimalProcessEnvironment,
  runCommand,
  type CommandResult,
} from "../process/command.js";

interface GitCommandOptions {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly errorCode?: ErrorCode;
  readonly maxOutputCharacters?: number;
  readonly signal?: AbortSignal;
  readonly stdin?: string;
  readonly timeoutMs?: number;
}

function gitEnvironment(): NodeJS.ProcessEnv {
  const environment = minimalProcessEnvironment();
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null";
  environment.GIT_PAGER = "cat";
  environment.GIT_TERMINAL_PROMPT = "0";
  environment.LC_ALL = "C";
  return environment;
}

export async function runRawGitCommand(
  options: GitCommandOptions,
): Promise<CommandResult> {
  return runCommand({
    command: "git",
    args: options.args,
    cwd: options.cwd,
    env: gitEnvironment(),
    maxOutputCharacters: options.maxOutputCharacters ?? 4_000_000,
    timeoutMs: options.timeoutMs ?? 30_000,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
  });
}

export async function runGitCommand(options: GitCommandOptions): Promise<string> {
  const result = await runRawGitCommand(options);

  if (result.cancelled) {
    throw new SpotPatchError(ERROR_CODES.AGENT_CANCELLED);
  }

  if (result.timedOut || result.exitCode !== 0) {
    throw new SpotPatchError(options.errorCode ?? ERROR_CODES.INTERNAL_ERROR);
  }

  return result.stdout;
}

export function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);

  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}
