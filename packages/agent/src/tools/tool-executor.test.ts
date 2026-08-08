import { readFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_AGENT_LIMITS,
  ERROR_CODES,
  type ResolvedAgentCheckDefinition,
} from "@spotpatch/shared";

import type { ProviderToolCall } from "../provider/provider-types.js";
import {
  createTestGitRepository,
  type TestGitRepository,
} from "../test-utils/git-repository.js";
import {
  createIsolatedGitWorktree,
  type IsolatedGitWorktree,
} from "../worktree/git-worktree.js";
import { createAgentToolExecutor } from "./tool-executor.js";

const updatePatch = `diff --git a/src/App.tsx b/src/App.tsx
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -1 +1 @@
-export const App = () => <button>Before</button>;
+export const App = () => <button>After</button>;
`;

function call(
  id: string,
  name: string,
  argumentsValue: Readonly<Record<string, unknown>>,
): ProviderToolCall {
  return Object.freeze({ id, name, arguments: argumentsValue });
}

describe("Agent tool executor", () => {
  let repository: TestGitRepository;
  let worktree: IsolatedGitWorktree;

  beforeEach(async () => {
    repository = await createTestGitRepository({
      "src/App.tsx": "export const App = () => <button>Before</button>;\n",
      "src/other.ts": "export const value = 'needle';\n",
      ".env.local": "SECRET=hidden\n",
    });
    worktree = await createIsolatedGitWorktree({
      root: repository.root,
      signal: new AbortController().signal,
    });
  });

  afterEach(async () => {
    await worktree.cleanup();
    await repository.cleanup();
  });

  it("lists, searches, and reads only allowed bounded text", async () => {
    const executor = createAgentToolExecutor({
      checks: {},
      limits: DEFAULT_AGENT_LIMITS,
      worktreeRoot: worktree.root,
    });
    const signal = new AbortController().signal;
    const listed = await executor.execute(
      call("list", "list_files", { glob: "**/*", maxResults: 100 }),
      signal,
    );
    const searched = await executor.execute(
      call("search", "search_text", {
        query: "needle",
        glob: "src/**/*.ts",
        maxResults: 10,
      }),
      signal,
    );
    const read = await executor.execute(
      call("read", "read_file", { path: "src/App.tsx" }),
      signal,
    );

    expect(listed.output).toMatchObject({ files: ["src/App.tsx", "src/other.ts"] });
    expect(JSON.stringify(listed.output)).not.toContain(".env.local");
    expect(searched.output).toMatchObject({
      matches: [{ path: "src/other.ts", line: 1 }],
    });
    expect(read.output).toMatchObject({ path: "src/App.tsx" });
    expect(JSON.stringify(read.output)).toContain("Before");
  });

  it("applies each toolCallId once and rejects changed duplicate arguments", async () => {
    const executor = createAgentToolExecutor({
      checks: {},
      limits: DEFAULT_AGENT_LIMITS,
      worktreeRoot: worktree.root,
    });
    const signal = new AbortController().signal;
    const patchCall = call("patch", "apply_patch", { patch: updatePatch });
    const first = await executor.execute(patchCall, signal);
    const duplicate = await executor.execute(patchCall, signal);

    expect(duplicate).toBe(first);
    expect(await worktreeFile()).toContain("After");
    await expect(
      executor.execute(
        call("patch", "apply_patch", { patch: `${updatePatch}\n` }),
        signal,
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.TOOL_INPUT_INVALID });
    expect(executor.touchedPaths()).toEqual(new Set(["src/App.tsx"]));
  });

  it("returns an unchanged patch rejection for a bounded model retry", async () => {
    const executor = createAgentToolExecutor({
      checks: {},
      limits: DEFAULT_AGENT_LIMITS,
      worktreeRoot: worktree.root,
    });
    const signal = new AbortController().signal;
    const rejected = await executor.execute(
      call("patch-rejected", "apply_patch", {
        patch: updatePatch.replace("Before", "Missing"),
      }),
      signal,
    );

    expect(rejected.output).toMatchObject({
      errorCode: ERROR_CODES.PATCH_REJECTED,
      retryable: true,
    });
    expect(await worktreeFile()).toContain("Before");
    expect(executor.touchedPaths()).toEqual(new Set());

    const applied = await executor.execute(
      call("patch-corrected", "apply_patch", { patch: updatePatch }),
      signal,
    );

    expect(applied.output).toEqual({ paths: ["src/App.tsx"] });
    expect(await worktreeFile()).toContain("After");
    expect(executor.touchedPaths()).toEqual(new Set(["src/App.tsx"]));
  });

  it("replaces one exact fragment without requiring the model to synthesize a diff", async () => {
    const executor = createAgentToolExecutor({
      checks: {},
      limits: DEFAULT_AGENT_LIMITS,
      worktreeRoot: worktree.root,
    });
    const signal = new AbortController().signal;
    const replacementCall = call("replace", "replace_text", {
      path: "src/App.tsx",
      oldText: "<button>Before</button>",
      newText: "<button>After</button>",
    });
    const first = await executor.execute(replacementCall, signal);
    const duplicate = await executor.execute(replacementCall, signal);

    expect(first.output).toEqual({
      paths: ["src/App.tsx"],
      replacements: 1,
    });
    expect(duplicate).toBe(first);
    expect(await worktreeFile()).toContain("After");
    expect(executor.touchedPaths()).toEqual(new Set(["src/App.tsx"]));
  });

  it("rejects missing, ambiguous, unchanged, whole-file, and whitespace-invalid replacements without mutation", async () => {
    const executor = createAgentToolExecutor({
      checks: {},
      limits: DEFAULT_AGENT_LIMITS,
      worktreeRoot: worktree.root,
    });
    const signal = new AbortController().signal;
    const rejectedCalls = [
      call("missing", "replace_text", {
        path: "src/App.tsx",
        oldText: "Missing",
        newText: "After",
      }),
      call("ambiguous", "replace_text", {
        path: "src/App.tsx",
        oldText: "e",
        newText: "E",
      }),
      call("unchanged", "replace_text", {
        path: "src/App.tsx",
        oldText: "Before",
        newText: "Before",
      }),
      call("whole-file", "replace_text", {
        path: "src/App.tsx",
        oldText: "export const App = () => <button>Before</button>;\n",
        newText: "export const App = () => <button>After</button>;\n",
      }),
      call("whitespace", "replace_text", {
        path: "src/App.tsx",
        oldText: "Before</button>;",
        newText: "After</button>;  ",
      }),
    ];

    for (const rejectedCall of rejectedCalls) {
      await expect(executor.execute(rejectedCall, signal)).resolves.toMatchObject({
        output: {
          errorCode: ERROR_CODES.PATCH_REJECTED,
          retryable: true,
        },
      });
      expect(await worktreeFile()).toContain("Before");
    }

    expect(executor.touchedPaths()).toEqual(new Set());
  });

  it("keeps protected files outside the exact replacement tool", async () => {
    const executor = createAgentToolExecutor({
      checks: {},
      limits: DEFAULT_AGENT_LIMITS,
      worktreeRoot: worktree.root,
    });

    await expect(
      executor.execute(
        call("replace-secret", "replace_text", {
          path: ".env.local",
          oldText: "SECRET=hidden",
          newText: "SECRET=exposed",
        }),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.TOOL_PATH_DENIED });
    expect(executor.touchedPaths()).toEqual(new Set());
  });

  it("does not allow a configured check to mutate the proposed diff", async () => {
    const mutateCheck = Object.freeze({
      id: "mutate",
      label: "Mutating check",
      command: process.execPath,
      args: Object.freeze([
        "-e",
        "require('node:fs').appendFileSync('src/App.tsx', '\\nchanged by check')",
      ]),
      required: true,
      timeoutMs: 2_000,
    } satisfies ResolvedAgentCheckDefinition);
    const executor = createAgentToolExecutor({
      checks: { mutate: mutateCheck },
      limits: DEFAULT_AGENT_LIMITS,
      worktreeRoot: worktree.root,
    });

    await expect(
      executor.execute(
        call("check", "run_check", { checkId: "mutate" }),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
  });

  async function worktreeFile(): Promise<string> {
    return readFile(`${worktree.root}/src/App.tsx`, "utf8");
  }
});
