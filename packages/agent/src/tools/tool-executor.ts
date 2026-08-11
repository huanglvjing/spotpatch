import { createHash } from "node:crypto";

import {
  ERROR_CODES,
  SpotPatchError,
  type AgentCheckResult,
  type AgentLimits,
  type ResolvedAgentCheckDefinition,
} from "@spotpatch/shared";
import { z } from "zod";

import type {
  ProviderToolCall,
  ProviderToolResult,
} from "../provider/provider-types.js";
import {
  readAgentTextFile,
  writeAgentTextFileIfContentMatches,
  type ReadTextFileResult,
} from "../security/text-file.js";
import {
  requireConfiguredCheck,
  runConfiguredCheck,
} from "../validation/check-runner.js";
import { applyAgentPatch } from "../worktree/change-set.js";
import { runGitCommand } from "../worktree/git-command.js";
import { createAgentFileCatalog } from "./file-discovery.js";
import { AGENT_TOOL_NAMES } from "./tool-definitions.js";

const SEARCH_READ_CONCURRENCY = 8;

const listFilesSchema = z.strictObject({
  glob: z.string().min(1).max(256),
  maxResults: z.number().int().min(1).max(500),
});
const searchTextSchema = z.strictObject({
  query: z.string().min(1).max(512),
  glob: z.string().min(1).max(256),
  maxResults: z.number().int().min(1).max(500),
});
const readFileSchema = z.strictObject({
  path: z.string().min(1).max(1_024),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
});
const replaceTextSchema = z.strictObject({
  path: z.string().min(1).max(1_024),
  oldText: z.string().min(1),
  newText: z.string(),
});
const applyPatchSchema = z.strictObject({ patch: z.string().min(1) });
const runCheckSchema = z.strictObject({
  checkId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
});

interface AgentToolExecutorOptions {
  readonly checks: Readonly<Record<string, ResolvedAgentCheckDefinition>>;
  readonly limits: Readonly<AgentLimits>;
  readonly worktreeRoot: string;
  readonly onCheck?: (result: AgentCheckResult) => void;
}

export interface AgentToolExecutor {
  readonly execute: (
    call: ProviderToolCall,
    scope: AgentToolExecutionScope,
    signal: AbortSignal,
  ) => Promise<ProviderToolResult>;
  readonly latestCheckResult: (checkId: string) => AgentCheckResult | undefined;
  readonly touchedPaths: () => ReadonlySet<string>;
}

export interface AgentToolExecutionScope {
  readonly turn: number;
}

interface CachedToolResult {
  readonly signature: string;
  readonly result: ProviderToolResult;
}

interface VersionedCheckResult {
  readonly changeRevision: number;
  readonly result: AgentCheckResult;
}

function invalidTool(): never {
  throw new SpotPatchError(ERROR_CODES.TOOL_ARGUMENTS_INVALID);
}

function parseArguments<T>(
  schema: z.ZodType<T>,
  value: Readonly<Record<string, unknown>>,
): T {
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    return invalidTool();
  }

  return parsed.data;
}

function truncate(
  value: string,
  maximum: number,
): Readonly<{
  text: string;
  truncated: boolean;
}> {
  if (value.length <= maximum) {
    return Object.freeze({ text: value, truncated: false });
  }

  return Object.freeze({
    text: value.slice(0, maximum),
    truncated: true,
  });
}

async function worktreeFingerprint(root: string, signal: AbortSignal): Promise<string> {
  const [status, diff] = await Promise.all([
    runGitCommand({
      cwd: root,
      args: ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      signal,
    }),
    runGitCommand({
      cwd: root,
      args: ["diff", "--no-ext-diff", "--no-color", "HEAD", "--"],
      signal,
    }),
  ]);

  return createHash("sha256").update(status).update("\0").update(diff).digest("hex");
}

function countOccurrences(content: string, search: string): number {
  let count = 0;
  let offset = 0;

  while (offset <= content.length - search.length) {
    const index = content.indexOf(search, offset);

    if (index === -1) {
      break;
    }

    count += 1;

    if (count > 1) {
      break;
    }

    offset = index + search.length;
  }

  return count;
}

function retryableWriteRejection(
  reason: string,
  guidance: string,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    errorCode: ERROR_CODES.PATCH_REJECTED,
    retryable: true,
    reason,
    guidance,
  });
}

function retryableArgumentsRejection(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    errorCode: ERROR_CODES.TOOL_ARGUMENTS_INVALID,
    retryable: true,
    reason: "ARGUMENTS_DO_NOT_MATCH_CONTRACT",
    guidance:
      "No files changed. Retry once with a new tool call ID and only the declared fields and value types.",
  });
}

export function createAgentToolExecutor(
  options: AgentToolExecutorOptions,
): AgentToolExecutor {
  const cacheByTurn = new Map<number, Map<string, CachedToolResult>>();
  const fileCatalog = createAgentFileCatalog(options.worktreeRoot);
  const fileContents = new Map<string, Promise<ReadTextFileResult>>();
  const latestChecks = new Map<string, VersionedCheckResult>();
  const touchedPaths = new Set<string>();
  let changeRevision = 0;

  const readTextFile = (relativePath: string): Promise<ReadTextFileResult> => {
    const cached = fileContents.get(relativePath);

    if (cached !== undefined) {
      return cached;
    }

    const pending = readAgentTextFile(
      options.worktreeRoot,
      relativePath,
      options.limits.maxReadBytesPerFile,
    );
    fileContents.set(relativePath, pending);
    return pending;
  };

  const recordMutation = (relativePaths: readonly string[]): void => {
    changeRevision += 1;
    fileCatalog.invalidate();

    for (const relativePath of relativePaths) {
      fileContents.delete(relativePath);
      touchedPaths.add(relativePath);
    }
  };

  const executeUncached = async (
    call: ProviderToolCall,
    signal: AbortSignal,
  ): Promise<unknown> => {
    switch (call.name) {
      case AGENT_TOOL_NAMES.listFiles: {
        const input = parseArguments(listFilesSchema, call.arguments);
        const files = await fileCatalog.list(input.glob, input.maxResults, signal);
        const boundedFiles: string[] = [];
        let characters = 0;

        for (const relativePath of files) {
          if (
            characters + relativePath.length + 4 >
            options.limits.maxToolOutputCharacters
          ) {
            return Object.freeze({
              files: Object.freeze(boundedFiles),
              truncated: true,
            });
          }

          boundedFiles.push(relativePath);
          characters += relativePath.length + 4;
        }

        return Object.freeze({ files: Object.freeze(boundedFiles), truncated: false });
      }
      case AGENT_TOOL_NAMES.searchText: {
        const input = parseArguments(searchTextSchema, call.arguments);
        const files = await fileCatalog.list(input.glob, 2_000, signal);
        const matches: Readonly<{ path: string; line: number; text: string }>[] = [];
        let characters = 0;

        for (let offset = 0; offset < files.length; offset += SEARCH_READ_CONCURRENCY) {
          if (signal.aborted) {
            throw new SpotPatchError(ERROR_CODES.AGENT_CANCELLED);
          }

          const batch = files.slice(offset, offset + SEARCH_READ_CONCURRENCY);
          const contents = await Promise.all(
            batch.map((relativePath) =>
              readTextFile(relativePath).catch((error: unknown) => {
                if (
                  error instanceof SpotPatchError &&
                  (error.code === ERROR_CODES.TOOL_PATH_DENIED ||
                    error.code === ERROR_CODES.AGENT_LIMIT_EXCEEDED)
                ) {
                  return undefined;
                }

                throw error;
              }),
            ),
          );

          for (const [fileIndex, file] of contents.entries()) {
            if (file === undefined) {
              continue;
            }

            for (const [lineIndex, line] of file.content.split(/\r?\n/u).entries()) {
              if (!line.includes(input.query)) {
                continue;
              }

              const preview = truncate(line, 500).text;
              const relativePath = batch[fileIndex] ?? file.relativePath;
              const nextCharacters = relativePath.length + preview.length + 32;

              if (
                matches.length >= input.maxResults ||
                characters + nextCharacters > options.limits.maxToolOutputCharacters
              ) {
                return Object.freeze({
                  matches: Object.freeze(matches),
                  truncated: true,
                });
              }

              matches.push(
                Object.freeze({
                  path: relativePath,
                  line: lineIndex + 1,
                  text: preview,
                }),
              );
              characters += nextCharacters;
            }
          }
        }

        return Object.freeze({ matches: Object.freeze(matches), truncated: false });
      }
      case AGENT_TOOL_NAMES.readFile: {
        const input = parseArguments(readFileSchema, call.arguments);
        const file = await readTextFile(input.path);
        const lines = file.content.split(/\r?\n/u);
        const startLine = input.startLine ?? 1;
        const endLine = input.endLine ?? Math.min(lines.length, startLine + 199);

        if (endLine < startLine || startLine > lines.length) {
          return invalidTool();
        }

        const selected = lines
          .slice(startLine - 1, endLine)
          .map((line, index) => `${String(startLine + index)}: ${line}`)
          .join("\n");
        const bounded = truncate(selected, options.limits.maxToolOutputCharacters);
        return Object.freeze({
          path: file.relativePath,
          startLine,
          endLine: Math.min(endLine, lines.length),
          content: bounded.text,
          truncated: bounded.truncated || endLine < lines.length,
        });
      }
      case AGENT_TOOL_NAMES.replaceText: {
        const input = parseArguments(replaceTextSchema, call.arguments);

        if (
          Buffer.byteLength(input.oldText, "utf8") +
            Buffer.byteLength(input.newText, "utf8") >
          options.limits.maxDiffBytes
        ) {
          throw new SpotPatchError(ERROR_CODES.AGENT_LIMIT_EXCEEDED);
        }

        const before = await worktreeFingerprint(options.worktreeRoot, signal);
        const file = await readTextFile(input.path);
        const occurrences = countOccurrences(file.content, input.oldText);

        if (
          occurrences !== 1 ||
          input.oldText === input.newText ||
          input.oldText === file.content
        ) {
          const after = await worktreeFingerprint(options.worktreeRoot, signal);

          if (before !== after) {
            throw new SpotPatchError(ERROR_CODES.PATCH_REJECTED);
          }

          return retryableWriteRejection(
            occurrences === 0
              ? "EXACT_TEXT_NOT_FOUND"
              : occurrences > 1
                ? "EXACT_TEXT_NOT_UNIQUE"
                : input.oldText === file.content
                  ? "WHOLE_FILE_REPLACEMENT_DENIED"
                  : "REPLACEMENT_UNCHANGED",
            occurrences === 0
              ? "No files changed. Re-read the current file and copy oldText exactly without line-number prefixes."
              : occurrences > 1
                ? "No files changed. Re-read the current file and include more surrounding text so oldText occurs exactly once."
                : input.oldText === file.content
                  ? "No files changed. replace_text only accepts a localized fragment; use apply_patch for a whole-file change."
                  : "No files changed. newText must differ from oldText.",
          );
        }

        const index = file.content.indexOf(input.oldText);
        const nextContent = `${file.content.slice(0, index)}${input.newText}${file.content.slice(index + input.oldText.length)}`;
        let mutated = false;

        try {
          await writeAgentTextFileIfContentMatches(
            options.worktreeRoot,
            file.relativePath,
            file.content,
            nextContent,
            options.limits.maxReadBytesPerFile,
          );
          mutated = true;
          await runGitCommand({
            cwd: options.worktreeRoot,
            args: ["diff", "--check", "--", file.relativePath],
            signal,
            errorCode: ERROR_CODES.PATCH_REJECTED,
          });
        } catch (error: unknown) {
          if (mutated) {
            await writeAgentTextFileIfContentMatches(
              options.worktreeRoot,
              file.relativePath,
              nextContent,
              file.content,
              options.limits.maxReadBytesPerFile,
            );
          }

          if (
            !(error instanceof SpotPatchError) ||
            error.code !== ERROR_CODES.PATCH_REJECTED
          ) {
            throw error;
          }

          const after = await worktreeFingerprint(options.worktreeRoot, signal);

          if (before !== after) {
            throw error;
          }

          return retryableWriteRejection(
            mutated ? "INVALID_RESULTING_DIFF" : "FILE_CHANGED_DURING_EDIT",
            mutated
              ? "No files changed. Re-read the file and retry without introducing Git whitespace errors."
              : "No files changed. Re-read the current file and retry with fresh exact text.",
          );
        }

        recordMutation([file.relativePath]);
        return Object.freeze({
          paths: Object.freeze([file.relativePath]),
          replacements: 1,
        });
      }
      case AGENT_TOOL_NAMES.applyPatch: {
        const input = parseArguments(applyPatchSchema, call.arguments);
        const before = await worktreeFingerprint(options.worktreeRoot, signal);
        let paths: readonly string[];

        try {
          paths = await applyAgentPatch(
            options.worktreeRoot,
            input.patch,
            options.limits,
            signal,
          );
        } catch (error: unknown) {
          if (
            !(error instanceof SpotPatchError) ||
            error.code !== ERROR_CODES.PATCH_REJECTED
          ) {
            throw error;
          }

          const after = await worktreeFingerprint(options.worktreeRoot, signal);

          if (before !== after) {
            throw error;
          }

          return retryableWriteRejection(
            "INVALID_OR_STALE_DIFF",
            "No files changed. Re-read the current file. For a localized existing-file edit, use replace_text with exact unique oldText and a new tool call ID. Otherwise retry a raw canonical unified Git diff beginning with 'diff --git a/<path> b/<path>'; do not include Markdown fences, prose, shell commands, or '*** Begin Patch' markers.",
          );
        }

        recordMutation(paths);

        return Object.freeze({ paths });
      }
      case AGENT_TOOL_NAMES.runCheck: {
        const input = parseArguments(runCheckSchema, call.arguments);
        const check = requireConfiguredCheck(input.checkId, options.checks);
        const cached = latestChecks.get(check.id);

        if (cached?.changeRevision === changeRevision) {
          return cached.result;
        }

        const before = await worktreeFingerprint(options.worktreeRoot, signal);
        const result = await runConfiguredCheck({
          check,
          maxOutputCharacters: options.limits.maxToolOutputCharacters,
          signal,
          worktreeRoot: options.worktreeRoot,
        });
        const after = await worktreeFingerprint(options.worktreeRoot, signal);

        if (before !== after) {
          throw new SpotPatchError(ERROR_CODES.VALIDATION_FAILED);
        }

        latestChecks.set(check.id, Object.freeze({ changeRevision, result }));
        options.onCheck?.(result);
        return result;
      }
      default:
        return invalidTool();
    }
  };

  return Object.freeze({
    async execute(
      call: ProviderToolCall,
      scope: AgentToolExecutionScope,
      signal: AbortSignal,
    ): Promise<ProviderToolResult> {
      if (!Number.isSafeInteger(scope.turn) || scope.turn < 1) {
        throw new SpotPatchError(ERROR_CODES.INTERNAL_ERROR);
      }

      const turnCache =
        cacheByTurn.get(scope.turn) ?? new Map<string, CachedToolResult>();
      cacheByTurn.set(scope.turn, turnCache);
      const signature = `${call.name}\0${JSON.stringify(call.arguments)}`;
      const cached = turnCache.get(call.id);

      if (cached !== undefined) {
        if (cached.signature !== signature) {
          throw new SpotPatchError(ERROR_CODES.TOOL_CALL_ID_CONFLICT);
        }

        return cached.result;
      }

      let output: unknown;

      try {
        output = await executeUncached(call, signal);
      } catch (error: unknown) {
        if (
          error instanceof SpotPatchError &&
          error.code === ERROR_CODES.TOOL_ARGUMENTS_INVALID
        ) {
          output = retryableArgumentsRejection();
        } else {
          throw error;
        }
      }

      const result = Object.freeze({ toolCallId: call.id, output });
      turnCache.set(call.id, Object.freeze({ signature, result }));
      return result;
    },
    latestCheckResult(checkId: string) {
      const cached = latestChecks.get(checkId);
      return cached?.changeRevision === changeRevision ? cached.result : undefined;
    },
    touchedPaths() {
      return new Set(touchedPaths);
    },
  });
}
