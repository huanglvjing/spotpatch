import type { ProviderToolDefinition } from "../provider/provider-types.js";

export const AGENT_TOOL_NAMES = Object.freeze({
  listFiles: "list_files",
  searchText: "search_text",
  readFile: "read_file",
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
    name: AGENT_TOOL_NAMES.applyPatch,
    description:
      "Apply one unified Git patch to allowed files in the isolated worktree. Never send prose or shell commands.",
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
