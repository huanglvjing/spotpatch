import {
  ERROR_CODES,
  SpotPatchError,
  type AgentCheckResult,
  type ResolvedAgentCheckDefinition,
  redactSensitiveText,
} from "@spotpatch/shared";

import { minimalProcessEnvironment, runCommand } from "../process/command.js";

interface RunCheckOptions {
  readonly check: ResolvedAgentCheckDefinition;
  readonly maxOutputCharacters: number;
  readonly signal: AbortSignal;
  readonly worktreeRoot: string;
  readonly now?: () => number;
}

function stripAnsiSequences(value: string): string {
  let output = "";

  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 27 || value[index + 1] !== "[") {
      output += value[index] ?? "";
      continue;
    }

    index += 2;

    while (index < value.length) {
      const code = value.charCodeAt(index);

      if (code >= 64 && code <= 126) {
        break;
      }

      index += 1;
    }
  }

  return output;
}

function cleanControlCharacters(value: string): string {
  let output = "";

  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;

    if (character === "\n" || character === "\t" || code >= 32) {
      output += character;
    }
  }

  return output;
}

export function sanitizeCheckOutput(value: string, worktreeRoot: string): string {
  return redactSensitiveText(
    cleanControlCharacters(stripAnsiSequences(value)).replaceAll(
      worktreeRoot,
      "<workspace>",
    ),
  ).trim();
}

export async function runConfiguredCheck(
  options: RunCheckOptions,
): Promise<AgentCheckResult> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const result = await runCommand({
    command: options.check.command,
    args: options.check.args,
    cwd: options.worktreeRoot,
    env: minimalProcessEnvironment(),
    maxOutputCharacters: options.maxOutputCharacters,
    signal: options.signal,
    timeoutMs: options.check.timeoutMs,
  });
  const sanitizedOutput = sanitizeCheckOutput(
    [result.stdout, result.stderr].filter((part) => part.length > 0).join("\n"),
    options.worktreeRoot,
  );
  const output =
    sanitizedOutput.length <= options.maxOutputCharacters
      ? sanitizedOutput
      : `${sanitizedOutput.slice(0, options.maxOutputCharacters)}\n[output truncated]`;
  const status: AgentCheckResult["status"] = result.cancelled
    ? "cancelled"
    : result.timedOut
      ? "timed-out"
      : result.exitCode === 0
        ? "passed"
        : "failed";

  return Object.freeze({
    checkId: options.check.id,
    label: options.check.label,
    status,
    durationMs: Math.max(0, now() - startedAt),
    output,
  });
}

export function requireConfiguredCheck(
  checkId: string,
  checks: Readonly<Record<string, ResolvedAgentCheckDefinition>>,
): ResolvedAgentCheckDefinition {
  const check = checks[checkId];

  if (check === undefined) {
    throw new SpotPatchError(ERROR_CODES.TOOL_DENIED);
  }

  return check;
}
