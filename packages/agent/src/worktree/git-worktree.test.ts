import { mkdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_AGENT_LIMITS,
  ERROR_CODES,
  type AgentJobResult,
} from "@spotpatch/shared";

import { createTestGitRepository } from "../test-utils/git-repository.js";
import { applyAgentPatch, collectAgentChangeSet } from "./change-set.js";
import { assertCleanGitBaseline, createIsolatedGitWorktree } from "./git-worktree.js";
import {
  applyPreparedAgentChange,
  captureAgentFileHashes,
  createPreparedAgentChange,
  revertPreparedAgentChange,
} from "./prepared-change.js";

const updatePatch = `diff --git a/src/App.tsx b/src/App.tsx
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -1 +1 @@
-export const App = () => <button>Before</button>;
+export const App = () => <button>After</button>;
`;

const addAndDeletePatch = `diff --git a/src/App.tsx b/src/App.tsx
deleted file mode 100644
--- a/src/App.tsx
+++ /dev/null
@@ -1 +0,0 @@
-export const App = () => <button>Before</button>;
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1 @@
+export const created = true;
`;

describe("isolated Git changes", () => {
  it("keeps the source repository unchanged until Apply and supports safe Revert", async () => {
    const repository = await createTestGitRepository();
    const signal = new AbortController().signal;
    const worktree = await createIsolatedGitWorktree({
      root: repository.root,
      signal,
    });

    try {
      const touched = await applyAgentPatch(
        worktree.root,
        updatePatch,
        DEFAULT_AGENT_LIMITS,
        signal,
      );
      const changeSet = await collectAgentChangeSet(
        worktree.root,
        new Set(touched),
        DEFAULT_AGENT_LIMITS,
        signal,
      );
      const result = Object.freeze({
        jobId: "job-1",
        summary: "Update button label.",
        diff: changeSet.diff,
        files: changeSet.files,
        checks: Object.freeze([]),
      } satisfies AgentJobResult);
      const prepared = createPreparedAgentChange({
        autoApplyEligible: false,
        baselineHead: worktree.baseline.head,
        expectedHashes: await captureAgentFileHashes(
          worktree.root,
          changeSet.touchedPaths,
        ),
        result,
        root: worktree.baseline.root,
        validationPassed: true,
      });

      expect(await repository.read("src/App.tsx")).toContain("Before");
      expect(changeSet.files).toEqual([
        {
          relativePath: "src/App.tsx",
          kind: "modified",
          additions: 1,
          deletions: 1,
        },
      ]);
      await worktree.cleanup();
      await applyPreparedAgentChange(prepared);
      expect(await repository.read("src/App.tsx")).toContain("After");
      await revertPreparedAgentChange(prepared);
      expect(await repository.read("src/App.tsx")).toContain("Before");
      await expect(
        assertCleanGitBaseline({ root: repository.root }),
      ).resolves.toBeDefined();
    } finally {
      await worktree.cleanup();
      await repository.cleanup();
    }
  });

  it("rejects dirty repositories before creating an Agent worktree", async () => {
    const repository = await createTestGitRepository();

    try {
      await repository.write("src/App.tsx", "dirty\n");
      await expect(
        createIsolatedGitWorktree({
          root: repository.root,
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.WORKTREE_DIRTY });
    } finally {
      await repository.cleanup();
    }
  });

  it("uses an installed dependency directory as the default temporary base", async () => {
    const repository = await createTestGitRepository({
      ".gitignore": "node_modules/\n",
      "src/App.tsx": "export const App = () => <button>Before</button>;\n",
    });
    await mkdir(path.join(repository.root, "node_modules"));
    const worktree = await createIsolatedGitWorktree({
      root: repository.root,
      signal: new AbortController().signal,
    });

    try {
      expect(
        path.relative(worktree.baseline.root, worktree.root).split(path.sep)[0],
      ).toBe("node_modules");
      await expect(
        assertCleanGitBaseline({ root: repository.root }),
      ).resolves.toBeDefined();
    } finally {
      await worktree.cleanup();
      await repository.cleanup();
    }
  });

  it("captures added and deleted text files without losing untracked additions", async () => {
    const repository = await createTestGitRepository();
    const signal = new AbortController().signal;
    const worktree = await createIsolatedGitWorktree({
      root: repository.root,
      signal,
    });

    try {
      const touched = await applyAgentPatch(
        worktree.root,
        addAndDeletePatch,
        DEFAULT_AGENT_LIMITS,
        signal,
      );
      const changeSet = await collectAgentChangeSet(
        worktree.root,
        new Set(touched),
        DEFAULT_AGENT_LIMITS,
        signal,
      );

      expect(changeSet.hasDeletion).toBe(true);
      expect(changeSet.files).toEqual([
        {
          relativePath: "src/App.tsx",
          kind: "deleted",
          additions: 0,
          deletions: 1,
        },
        {
          relativePath: "src/new.ts",
          kind: "added",
          additions: 1,
          deletions: 0,
        },
      ]);
    } finally {
      await worktree.cleanup();
      await repository.cleanup();
    }
  });

  it("refuses Apply after a concurrent source-worktree change", async () => {
    const repository = await createTestGitRepository();
    const signal = new AbortController().signal;
    const worktree = await createIsolatedGitWorktree({
      root: repository.root,
      signal,
    });

    try {
      const touched = await applyAgentPatch(
        worktree.root,
        updatePatch,
        DEFAULT_AGENT_LIMITS,
        signal,
      );
      const changeSet = await collectAgentChangeSet(
        worktree.root,
        new Set(touched),
        DEFAULT_AGENT_LIMITS,
        signal,
      );
      const prepared = createPreparedAgentChange({
        autoApplyEligible: false,
        baselineHead: worktree.baseline.head,
        expectedHashes: await captureAgentFileHashes(
          worktree.root,
          changeSet.touchedPaths,
        ),
        result: {
          jobId: "job-conflict",
          summary: "conflict test",
          diff: changeSet.diff,
          files: changeSet.files,
          checks: [],
        },
        root: repository.root,
        validationPassed: true,
      });
      await worktree.cleanup();
      await repository.write("README.md", "concurrent change\n");

      await expect(applyPreparedAgentChange(prepared)).rejects.toMatchObject({
        code: ERROR_CODES.APPLY_CONFLICT,
      });
      expect(await repository.read("src/App.tsx")).toContain("Before");
    } finally {
      await worktree.cleanup();
      await repository.cleanup();
    }
  });

  it("refuses Revert when an applied file changed again", async () => {
    const repository = await createTestGitRepository();
    const signal = new AbortController().signal;
    const worktree = await createIsolatedGitWorktree({
      root: repository.root,
      signal,
    });

    try {
      const touched = await applyAgentPatch(
        worktree.root,
        updatePatch,
        DEFAULT_AGENT_LIMITS,
        signal,
      );
      const changeSet = await collectAgentChangeSet(
        worktree.root,
        new Set(touched),
        DEFAULT_AGENT_LIMITS,
        signal,
      );
      const prepared = createPreparedAgentChange({
        autoApplyEligible: false,
        baselineHead: worktree.baseline.head,
        expectedHashes: await captureAgentFileHashes(
          worktree.root,
          changeSet.touchedPaths,
        ),
        result: {
          jobId: "job-revert-conflict",
          summary: "revert conflict test",
          diff: changeSet.diff,
          files: changeSet.files,
          checks: [],
        },
        root: repository.root,
        validationPassed: true,
      });
      await worktree.cleanup();
      await applyPreparedAgentChange(prepared);
      await repository.write("src/App.tsx", "changed after apply\n");

      await expect(revertPreparedAgentChange(prepared)).rejects.toMatchObject({
        code: ERROR_CODES.APPLY_CONFLICT,
      });
      expect(await repository.read("src/App.tsx")).toBe("changed after apply\n");
    } finally {
      await worktree.cleanup();
      await repository.cleanup();
    }
  });
});
