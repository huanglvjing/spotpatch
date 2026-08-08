import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_AGENT_LIMITS,
  ERROR_CODES,
  type ResolvedAiExecutionOptions,
  type ResolvedOpenAICompatibleProviderOptions,
  type SpotAnnotation,
} from "@spotpatch/shared";

import { createProviderCredential } from "../provider/provider-credential.js";
import { createTestGitRepository } from "../test-utils/git-repository.js";
import { GIT_PROCESS_INTEGRATION_TIMEOUT_MS } from "../test-utils/test-timeouts.js";
import {
  applyPreparedAgentChange,
  revertPreparedAgentChange,
} from "../worktree/prepared-change.js";
import { executeAgentChange } from "./execute-agent-change.js";

const updatePatch = `diff --git a/src/App.tsx b/src/App.tsx
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -1 +1 @@
-export const App = () => <button>Before</button>;
+export const App = () => <button>After</button>;
`;

const annotation = Object.freeze({
  schemaVersion: 3,
  id: "annotation-1",
  locale: "en-US",
  page: Object.freeze({
    url: "http://localhost:5173/",
    pathname: "/",
    title: "Fixture",
    viewportWidth: 1_440,
    viewportHeight: 900,
    devicePixelRatio: 2,
  }),
  targets: Object.freeze([
    Object.freeze({
      instruction: "Change the selected button label from Before to After.",
      source: Object.freeze({
        relativePath: "src/App.tsx",
        line: 1,
        column: 25,
        origin: "jsx-host",
        confidence: "exact",
      }),
      react: Object.freeze({
        supported: true,
        version: "18.3.1",
        componentName: "App",
        componentStack: Object.freeze(["App"]),
      }),
      element: Object.freeze({
        tagName: "button",
        selector: "button",
        sanitizedHtml: "<button>Before</button>",
        textPreview: "Before",
        rect: Object.freeze({ x: 0, y: 0, width: 100, height: 40 }),
      }),
      styles: Object.freeze({
        classNames: Object.freeze([]),
        matchedRules: Object.freeze([]),
        computed: Object.freeze({ display: "inline-block" }),
        warnings: Object.freeze([]),
      }),
      code: Object.freeze({
        relativePath: "src/App.tsx",
        language: "tsx",
        startLine: 1,
        endLine: 1,
        excerpt: "export const App = () => <button>Before</button>;",
        boundary: "component",
      }),
      warnings: Object.freeze([]),
    }),
  ]),
  createdAt: "2026-08-07T00:00:00.000Z",
} satisfies SpotAnnotation);

function provider(): ResolvedOpenAICompatibleProviderOptions {
  return Object.freeze({
    id: "relay",
    type: "openai-compatible",
    label: "Test relay",
    protocol: "chat-completions",
    authentication: "bearer",
    baseURL: "https://relay.example.test/v1",
    apiKeyEnv: "SPOTPATCH_TEST_KEY",
    models: Object.freeze({
      coding: Object.freeze({
        id: "coding",
        label: "Coding model",
        model: "coding-model",
      }),
    }),
    defaultModel: "coding",
  });
}

function execution(
  checkScript: string,
  applyMode: "review" | "auto" = "review",
): ResolvedAiExecutionOptions {
  return Object.freeze({
    isolation: "git-worktree",
    applyMode,
    checks: Object.freeze({
      verify: Object.freeze({
        id: "verify",
        label: "Verify change",
        command: process.execPath,
        args: Object.freeze(["-e", checkScript]),
        required: true,
        timeoutMs: 2_000,
      }),
    }),
    limits: DEFAULT_AGENT_LIMITS,
  });
}

function chatData(payload: Readonly<Record<string, unknown>>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function toolResponse(
  callId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
): Response {
  const source =
    chatData({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: callId,
                type: "function",
                function: { name, arguments: JSON.stringify(args) },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    }) +
    chatData({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }) +
    "data: [DONE]\n\n";
  return new Response(source, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

function toolCallsResponse(
  calls: readonly Readonly<{
    id: string;
    name: string;
    arguments: Readonly<Record<string, unknown>>;
  }>[],
): Response {
  const source =
    chatData({
      choices: [
        {
          delta: {
            tool_calls: calls.map((call, index) => ({
              index,
              id: call.id,
              type: "function",
              function: {
                name: call.name,
                arguments: JSON.stringify(call.arguments),
              },
            })),
          },
          finish_reason: null,
        },
      ],
    }) +
    chatData({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }) +
    "data: [DONE]\n\n";

  return new Response(source, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

function finalResponse(text: string): Response {
  return new Response(
    chatData({
      choices: [{ delta: { content: text }, finish_reason: null }],
    }) +
      chatData({ choices: [{ delta: {}, finish_reason: "stop" }] }) +
      "data: [DONE]\n\n",
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

function queuedFetch(responses: readonly Response[]) {
  const queue = [...responses];

  return vi.fn<typeof globalThis.fetch>().mockImplementation(() => {
    const response = queue.shift();

    return response === undefined
      ? Promise.reject(new Error("Unexpected provider request."))
      : Promise.resolve(response);
  });
}

function codingModel(source: ResolvedOpenAICompatibleProviderOptions) {
  const model = source.models.coding;

  if (model === undefined) {
    throw new Error("Missing model fixture.");
  }

  return model;
}

describe("Agent execution", { timeout: GIT_PROCESS_INTEGRATION_TIMEOUT_MS }, () => {
  it("drives read, exact replace, check, review Apply, and hash-safe Revert", async () => {
    const repository = await createTestGitRepository();
    const temporaryBase = await mkdtemp(
      path.join(os.tmpdir(), "spotpatch-engine-test-"),
    );
    const source = provider();
    const fetch = queuedFetch([
      toolResponse("read-1", "read_file", { path: "src/App.tsx" }),
      toolResponse("replace-1", "replace_text", {
        path: "src/App.tsx",
        oldText: "<button>Before</button>",
        newText: "<button>After</button>",
      }),
      toolResponse("check-1", "run_check", { checkId: "verify" }),
      finalResponse("Changed only the selected button label."),
    ]);
    const toolStates: string[] = [];
    const checkStatuses: string[] = [];

    try {
      const prepared = await executeAgentChange({
        annotation,
        credential: createProviderCredential(
          "synthetic-provider-credential-do-not-use",
        ),
        execution: execution(
          "const fs=require('node:fs'); if(!fs.readFileSync('src/App.tsx','utf8').includes('After')) process.exit(1)",
        ),
        fetch,
        jobId: "job-engine",
        model: codingModel(source),
        provider: source,
        root: repository.root,
        signal: new AbortController().signal,
        temporaryBase,
        callbacks: {
          onTool(event) {
            toolStates.push(`${event.toolName}:${event.state}`);
          },
          onCheck(result) {
            checkStatuses.push(result.status);
          },
        },
      });

      expect(prepared.validationPassed).toBe(true);
      expect(prepared.result).toMatchObject({
        jobId: "job-engine",
        summary: "Changed only the selected button label.",
        files: [
          {
            relativePath: "src/App.tsx",
            kind: "modified",
            additions: 1,
            deletions: 1,
          },
        ],
        checks: [{ checkId: "verify", status: "passed" }],
      });
      expect(await repository.read("src/App.tsx")).toContain("Before");
      expect(toolStates).toEqual([
        "read_file:started",
        "read_file:succeeded",
        "replace_text:started",
        "replace_text:succeeded",
        "run_check:started",
        "run_check:succeeded",
      ]);
      expect(checkStatuses).toEqual(["passed", "passed"]);
      expect(await readdir(temporaryBase)).toEqual([]);

      await applyPreparedAgentChange(prepared);
      expect(await repository.read("src/App.tsx")).toContain("After");
      await revertPreparedAgentChange(prepared);
      expect(await repository.read("src/App.tsx")).toContain("Before");
      expect(fetch).toHaveBeenCalledTimes(4);
    } finally {
      await repository.cleanup();
      await rm(temporaryBase, { recursive: true, force: true });
    }
  });

  it("returns a non-applicable result when a required check fails", async () => {
    const repository = await createTestGitRepository();
    const source = provider();
    const fetch = queuedFetch([
      toolResponse("patch-1", "apply_patch", { patch: updatePatch }),
      finalResponse("Proposed the label change."),
    ]);

    try {
      const prepared = await executeAgentChange({
        annotation,
        credential: createProviderCredential("synthetic-test-credential"),
        execution: execution("process.exit(1)"),
        fetch,
        jobId: "job-failed-check",
        model: codingModel(source),
        provider: source,
        root: repository.root,
        signal: new AbortController().signal,
      });

      expect(prepared.validationPassed).toBe(false);
      expect(prepared.result.checks).toMatchObject([{ status: "failed" }]);
      await expect(applyPreparedAgentChange(prepared)).rejects.toMatchObject({
        code: ERROR_CODES.VALIDATION_FAILED,
      });
      expect(await repository.read("src/App.tsx")).toContain("Before");
    } finally {
      await repository.cleanup();
    }
  });

  it("allows an OpenAI-compatible relay to reuse a tool call ID in a later turn", async () => {
    const repository = await createTestGitRepository();
    const source = provider();
    const fetch = queuedFetch([
      toolResponse("relay-call", "read_file", { path: "src/App.tsx" }),
      toolResponse("relay-call", "replace_text", {
        path: "src/App.tsx",
        oldText: "<button>Before</button>",
        newText: "<button>After</button>",
      }),
      finalResponse("Changed the selected button label."),
    ]);
    const toolStates: string[] = [];

    try {
      const prepared = await executeAgentChange({
        annotation,
        credential: createProviderCredential("synthetic-test-credential"),
        execution: execution("process.exit(0)"),
        fetch,
        jobId: "job-reused-provider-call-id",
        model: codingModel(source),
        provider: source,
        root: repository.root,
        signal: new AbortController().signal,
        callbacks: {
          onTool(event) {
            toolStates.push(`${String(event.turn)}:${event.toolName}:${event.state}`);
          },
        },
      });

      expect(prepared.validationPassed).toBe(true);
      expect(prepared.result.files).toMatchObject([
        { relativePath: "src/App.tsx", kind: "modified" },
      ]);
      expect(toolStates).toEqual([
        "1:read_file:started",
        "1:read_file:succeeded",
        "2:replace_text:started",
        "2:replace_text:succeeded",
      ]);
      expect(await repository.read("src/App.tsx")).toContain("Before");
    } finally {
      await repository.cleanup();
    }
  });

  it("rejects duplicate provider tool call IDs within one turn before mutation", async () => {
    const repository = await createTestGitRepository();
    const source = provider();
    const fetch = queuedFetch([
      toolCallsResponse([
        {
          id: "duplicate-call",
          name: "read_file",
          arguments: { path: "src/App.tsx" },
        },
        {
          id: "duplicate-call",
          name: "replace_text",
          arguments: {
            path: "src/App.tsx",
            oldText: "<button>Before</button>",
            newText: "<button>After</button>",
          },
        },
      ]),
    ]);

    try {
      await expect(
        executeAgentChange({
          annotation,
          credential: createProviderCredential("synthetic-test-credential"),
          execution: execution("process.exit(0)"),
          fetch,
          jobId: "job-duplicate-provider-call-id",
          model: codingModel(source),
          provider: source,
          root: repository.root,
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.TOOL_CALL_ID_CONFLICT });
      expect(await repository.read("src/App.tsx")).toContain("Before");
    } finally {
      await repository.cleanup();
    }
  });

  it("marks safe validated auto-mode changes as eligible without applying them itself", async () => {
    const repository = await createTestGitRepository();
    const source = provider();
    const fetch = queuedFetch([
      toolResponse("patch-1", "apply_patch", { patch: updatePatch }),
      finalResponse("Proposed the label change."),
    ]);

    try {
      const prepared = await executeAgentChange({
        annotation,
        credential: createProviderCredential("synthetic-test-credential"),
        execution: execution("process.exit(0)", "auto"),
        fetch,
        jobId: "job-auto",
        model: codingModel(source),
        provider: source,
        root: repository.root,
        signal: new AbortController().signal,
      });

      expect(prepared.autoApplyEligible).toBe(true);
      expect(await repository.read("src/App.tsx")).toContain("Before");
    } finally {
      await repository.cleanup();
    }
  });

  it("lets the model correct an unchanged rejected patch without weakening policy", async () => {
    const repository = await createTestGitRepository();
    const source = provider();
    const fetch = queuedFetch([
      toolResponse("patch-invalid", "apply_patch", {
        patch: updatePatch.replace("Before", "Missing"),
      }),
      toolResponse("patch-corrected", "apply_patch", { patch: updatePatch }),
      finalResponse("Corrected the patch and changed only the button label."),
    ]);
    const toolStates: string[] = [];

    try {
      const prepared = await executeAgentChange({
        annotation,
        credential: createProviderCredential("synthetic-test-credential"),
        execution: execution("process.exit(0)"),
        fetch,
        jobId: "job-patch-retry",
        model: codingModel(source),
        provider: source,
        root: repository.root,
        signal: new AbortController().signal,
        callbacks: {
          onTool(event) {
            toolStates.push(`${event.toolName}:${event.state}`);
          },
        },
      });

      expect(prepared.validationPassed).toBe(true);
      expect(prepared.result.files).toMatchObject([
        { relativePath: "src/App.tsx", kind: "modified" },
      ]);
      expect(toolStates).toEqual([
        "apply_patch:started",
        "apply_patch:failed",
        "apply_patch:started",
        "apply_patch:succeeded",
      ]);
      expect(JSON.stringify(fetch.mock.calls)).toContain(ERROR_CODES.PATCH_REJECTED);
      expect(await repository.read("src/App.tsx")).toContain("Before");
    } finally {
      await repository.cleanup();
    }
  });

  it("lets the model correct contract-invalid tool arguments without mutation", async () => {
    const repository = await createTestGitRepository();
    const source = provider();
    const fetch = queuedFetch([
      toolResponse("replace-invalid", "replace_text", {
        path: "src/App.tsx",
        old_text: "<button>Before</button>",
        new_text: "<button>After</button>",
      }),
      toolResponse("replace-corrected", "replace_text", {
        path: "src/App.tsx",
        oldText: "<button>Before</button>",
        newText: "<button>After</button>",
      }),
      finalResponse("Corrected the arguments and changed the button label."),
    ]);
    const toolStates: string[] = [];

    try {
      const prepared = await executeAgentChange({
        annotation,
        credential: createProviderCredential("synthetic-test-credential"),
        execution: execution("process.exit(0)"),
        fetch,
        jobId: "job-argument-retry",
        model: codingModel(source),
        provider: source,
        root: repository.root,
        signal: new AbortController().signal,
        callbacks: {
          onTool(event) {
            toolStates.push(`${event.toolName}:${event.state}`);
          },
        },
      });

      expect(prepared.validationPassed).toBe(true);
      expect(prepared.result.files).toMatchObject([
        { relativePath: "src/App.tsx", kind: "modified" },
      ]);
      expect(toolStates).toEqual([
        "replace_text:started",
        "replace_text:failed",
        "replace_text:started",
        "replace_text:succeeded",
      ]);
      expect(JSON.stringify(fetch.mock.calls)).toContain(
        ERROR_CODES.TOOL_ARGUMENTS_INVALID,
      );
      expect(await repository.read("src/App.tsx")).toContain("Before");
    } finally {
      await repository.cleanup();
    }
  });

  it("fails closed on an escaped patch path", async () => {
    const repository = await createTestGitRepository();
    const source = provider();
    const maliciousPatch = updatePatch.replaceAll("src/App.tsx", "../outside.ts");
    const fetch = queuedFetch([
      toolResponse("patch-1", "apply_patch", { patch: maliciousPatch }),
    ]);

    try {
      await expect(
        executeAgentChange({
          annotation,
          credential: createProviderCredential("synthetic-test-credential"),
          execution: execution("process.exit(0)"),
          fetch,
          jobId: "job-malicious",
          model: codingModel(source),
          provider: source,
          root: repository.root,
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.TOOL_PATH_DENIED });
      expect(await repository.read("src/App.tsx")).toContain("Before");
    } finally {
      await repository.cleanup();
    }
  });
});
