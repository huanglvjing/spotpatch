import type { ProviderToolDefinition } from "../provider/provider-types.js";

export const AGENT_TOOL_NAMES = Object.freeze({
  listFiles: "list_files",
  searchText: "search_text",
  readFile: "read_file",
  replaceText: "replace_text",
  applyPatch: "apply_patch",
  runCheck: "run_check",
} as const);

const pathProperty = Object.freeze({
  type: "string",
  minLength: 1,
  maxLength: 1_024,
});
const globProperty = Object.freeze({
  type: "string",
  minLength: 1,
  maxLength: 256,
});

export const AGENT_TOOL_DEFINITIONS = Object.freeze([
  Object.freeze({
    name: AGENT_TOOL_NAMES.listFiles,
    description:
      "List allowed text files in the isolated worktree using a simple glob.",
    parameters: Object.freeze({
      type: "object",
      properties: Object.freeze({
        glob: globProperty,
        maxResults: Object.freeze({
          type: "integer",
          minimum: 1,
          maximum: 500,
        }),
      }),
      required: Object.freeze(["glob", "maxResults"]),
      additionalProperties: false,
    }),
  }),
  Object.freeze({
    name: AGENT_TOOL_NAMES.searchText,
    description:
      "Search for an exact text fragment in allowed worktree files and return bounded line matches.",
    parameters: Object.freeze({
      type: "object",
      properties: Object.freeze({
        query: Object.freeze({ type: "string", minLength: 1, maxLength: 512 }),
        glob: globProperty,
        maxResults: Object.freeze({
          type: "integer",
          minimum: 1,
          maximum: 500,
        }),
      }),
      required: Object.freeze(["query", "glob", "maxResults"]),
      additionalProperties: false,
    }),
  }),
  Object.freeze({
    name: AGENT_TOOL_NAMES.readFile,
    description:
      "Read a bounded inclusive line range from one allowed UTF-8 text file.",
    parameters: Object.freeze({
      type: "object",
      properties: Object.freeze({
        path: pathProperty,
        startLine: Object.freeze({ type: "integer", minimum: 1 }),
        endLine: Object.freeze({ type: "integer", minimum: 1 }),
      }),
      required: Object.freeze(["path"]),
      additionalProperties: false,
    }),
  }),
  Object.freeze({
    name: AGENT_TOOL_NAMES.replaceText,
    description:
      "Replace exactly one occurrence of oldText in one existing allowed UTF-8 file. Prefer this for localized edits. Copy oldText exactly from search_text or file content, without read_file line-number prefixes; include enough surrounding text to make it unique. This tool cannot create, delete, or replace an entire file. A retryable PATCH_REJECTED result means no file changed: re-read and retry with a new tool call ID.",
    parameters: Object.freeze({
      type: "object",
      properties: Object.freeze({
        path: pathProperty,
        oldText: Object.freeze({ type: "string", minLength: 1 }),
        newText: Object.freeze({ type: "string" }),
      }),
      required: Object.freeze(["path", "oldText", "newText"]),
      additionalProperties: false,
    }),
  }),
  Object.freeze({
    name: AGENT_TOOL_NAMES.applyPatch,
    description:
      "Apply one raw canonical unified Git diff to allowed files in the isolated worktree. Use this for file creation, deletion, or changes that cannot be expressed as one exact replacement. Begin with 'diff --git a/<path> b/<path>', include matching ---/+++ headers and valid @@ hunks. Never send Markdown fences, prose, shell commands, or '*** Begin Patch' markers. A retryable PATCH_REJECTED result means no file changed: re-read and use replace_text for a localized existing-file edit, or retry a corrected diff with a new tool call ID.",
    parameters: Object.freeze({
      type: "object",
      properties: Object.freeze({
        patch: Object.freeze({ type: "string", minLength: 1 }),
      }),
      required: Object.freeze(["patch"]),
      additionalProperties: false,
    }),
  }),
  Object.freeze({
    name: AGENT_TOOL_NAMES.runCheck,
    description:
      "Run one preconfigured validation check by ID. Commands and arguments cannot be supplied.",
    parameters: Object.freeze({
      type: "object",
      properties: Object.freeze({
        checkId: Object.freeze({
          type: "string",
          pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$",
        }),
      }),
      required: Object.freeze(["checkId"]),
      additionalProperties: false,
    }),
  }),
] satisfies readonly ProviderToolDefinition[]);
