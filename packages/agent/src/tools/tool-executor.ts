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
import { readAgentTextFile } from "../security/text-file.js";
import {
  requireConfiguredCheck,
  runConfiguredCheck,
} from "../validation/check-runner.js";
import { applyAgentPatch } from "../worktree/change-set.js";
import { runGitCommand } from "../worktree/git-command.js";
import { listAgentFiles } from "./file-discovery.js";
import { AGENT_TOOL_NAMES } from "./tool-definitions.js";

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
    signal: AbortSignal,
  ) => Promise<ProviderToolResult>;
  readonly touchedPaths: () => ReadonlySet<string>;
}

interface CachedToolResult {
  readonly signature: string;
  readonly result: ProviderToolResult;
}

function invalidTool(): never {
  throw new SpotPatchError(ERROR_CODES.TOOL_DENIED);
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

export function createAgentToolExecutor(
  options: AgentToolExecutorOptions,
): AgentToolExecutor {
  const cache = new Map<string, CachedToolResult>();
  const touchedPaths = new Set<string>();

  const executeUncached = async (
    call: ProviderToolCall,
    signal: AbortSignal,
  ): Promise<unknown> => {
    switch (call.name) {
      case AGENT_TOOL_NAMES.listFiles: {
        const input = parseArguments(listFilesSchema, call.arguments);
        const files = await listAgentFiles(
          options.worktreeRoot,
          input.glob,
          input.maxResults,
          signal,
        );
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
        const files = await listAgentFiles(
          options.worktreeRoot,
          input.glob,
          2_000,
          signal,
        );
        const matches: Readonly<{ path: string; line: number; text: string }>[] = [];
        let characters = 0;

        for (const relativePath of files) {
          if (signal.aborted) {
            throw new SpotPatchError(ERROR_CODES.AGENT_CANCELLED);
          }

          let content: string;

          try {
            content = (
              await readAgentTextFile(
                options.worktreeRoot,
                relativePath,
                options.limits.maxReadBytesPerFile,
              )
            ).content;
          } catch (error: unknown) {
            if (error instanceof SpotPatchError) {
              continue;
            }

            throw error;
          }

          const lines = content.split(/\r?\n/u);

          for (const [index, line] of lines.entries()) {
            if (!line.includes(input.query)) {
              continue;
            }

            const preview = truncate(line, 500).text;
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
              Object.freeze({ path: relativePath, line: index + 1, text: preview }),
            );
            characters += nextCharacters;
          }
        }

        return Object.freeze({ matches: Object.freeze(matches), truncated: false });
      }
      case AGENT_TOOL_NAMES.readFile: {
        const input = parseArguments(readFileSchema, call.arguments);
        const file = await readAgentTextFile(
          options.worktreeRoot,
          input.path,
          options.limits.maxReadBytesPerFile,
        );
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
      case AGENT_TOOL_NAMES.applyPatch: {
        const input = parseArguments(applyPatchSchema, call.arguments);
        const paths = await applyAgentPatch(
          options.worktreeRoot,
          input.patch,
          options.limits,
          signal,
        );

        for (const relativePath of paths) {
          touchedPaths.add(relativePath);
        }

        return Object.freeze({ paths });
      }
      case AGENT_TOOL_NAMES.runCheck: {
        const input = parseArguments(runCheckSchema, call.arguments);
        const check = requireConfiguredCheck(input.checkId, options.checks);
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
      signal: AbortSignal,
    ): Promise<ProviderToolResult> {
      const signature = `${call.name}\0${JSON.stringify(call.arguments)}`;
      const cached = cache.get(call.id);

      if (cached !== undefined) {
        if (cached.signature !== signature) {
          return invalidTool();
        }

        return cached.result;
      }

      const result = Object.freeze({
        toolCallId: call.id,
        output: await executeUncached(call, signal),
      });
      cache.set(call.id, Object.freeze({ signature, result }));
      return result;
    },
    touchedPaths() {
      return new Set(touchedPaths);
    },
  });
}
