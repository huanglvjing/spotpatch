import { mkdir, mkdtemp, open, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  AGENT_WORKSPACE_SNAPSHOT_LIMITS,
  DEFAULT_AGENT_LIMITS,
  ERROR_CODES,
  type AgentJobResult,
} from "@spotpatch/shared";

import { createTestGitRepository } from "../test-utils/git-repository.js";
import { applyAgentPatch, collectAgentChangeSet } from "./change-set.js";
import { runGitCommand } from "./git-command.js";
import { assertCleanGitBaseline, createIsolatedGitWorktree } from "./git-worktree.js";
import {
  applyPreparedAgentChange,
  captureAgentFileHashes,
  createPreparedAgentChange,
  revertPreparedAgentChange,
} from "./prepared-change.js";
import { inspectAgentWorkspace } from "./workspace-health.js";

const GIT_WORKTREE_INTEGRATION_TIMEOUT_MS = 15_000;

vi.setConfig({ testTimeout: GIT_WORKTREE_INTEGRATION_TIMEOUT_MS });

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

const updateDirtyBaselinePatch = `diff --git a/src/App.tsx b/src/App.tsx
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -1 +1 @@
-export const App = () => <button>Local worktree</button>;
+export const App = () => <button>Agent result</button>;
`;

const updateUntrackedBaselinePatch = `diff --git a/src/local.ts b/src/local.ts
--- a/src/local.ts
+++ b/src/local.ts
@@ -1 +1 @@
-export const localValue = "user draft";
+export const localValue = "agent result";
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
        baselineHashes: await captureAgentFileHashes(
          repository.root,
          changeSet.touchedPaths,
        ),
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

  it("reports local changes and blocks an in-progress Git operation", async () => {
    const repository = await createTestGitRepository();

    try {
      await repository.write(
        "src/App.tsx",
        "export const App = () => <button>Local</button>;\n",
      );
      await runGitCommand({
        cwd: repository.root,
        args: ["add", "--", "src/App.tsx"],
      });
      await repository.write(
        "src/App.tsx",
        "export const App = () => <button>Local worktree</button>;\n",
      );
      await repository.write("notes.txt", "local note\n");
      const dirty = await inspectAgentWorkspace(repository.root);

      expect(dirty).toMatchObject({
        state: "consent-required",
        canIncludeLocalChanges: true,
        changes: {
          staged: 1,
          unstaged: 1,
          untracked: 1,
          conflicted: 0,
          total: 2,
        },
      });

      const head = (
        await runGitCommand({
          cwd: repository.root,
          args: ["rev-parse", "--verify", "HEAD"],
        })
      ).trim();
      await repository.write(".git/MERGE_HEAD", `${head}\n`);
      await expect(inspectAgentWorkspace(repository.root)).resolves.toMatchObject({
        state: "blocked",
        canIncludeLocalChanges: false,
        errorCode: ERROR_CODES.WORKTREE_OPERATION_IN_PROGRESS,
      });
    } finally {
      await repository.cleanup();
    }
  });

  it("reports non-repository and oversized untracked workspace failures precisely", async () => {
    const nonRepository = await mkdtemp(path.join(os.tmpdir(), "spotpatch-non-git-"));
    const repository = await createTestGitRepository();

    try {
      await expect(inspectAgentWorkspace(nonRepository)).resolves.toMatchObject({
        state: "blocked",
        canIncludeLocalChanges: false,
        errorCode: ERROR_CODES.WORKTREE_NOT_REPOSITORY,
      });

      const oversizedPath = path.join(repository.root, "oversized-local-draft.txt");
      const oversized = await open(oversizedPath, "w");

      try {
        await oversized.truncate(AGENT_WORKSPACE_SNAPSHOT_LIMITS.maxUntrackedBytes + 1);
      } finally {
        await oversized.close();
      }

      await expect(inspectAgentWorkspace(repository.root)).resolves.toMatchObject({
        state: "blocked",
        canIncludeLocalChanges: false,
        errorCode: ERROR_CODES.WORKTREE_LOCAL_CHANGES_TOO_LARGE,
      });
    } finally {
      await rm(nonRepository, { recursive: true, force: true });
      await repository.cleanup();
    }
  });

  it("preserves staged, unstaged, and untracked user changes across Apply and Revert", async () => {
    const repository = await createTestGitRepository();
    const signal = new AbortController().signal;

    try {
      await repository.write(
        "src/App.tsx",
        "export const App = () => <button>Local staged</button>;\n",
      );
      await runGitCommand({
        cwd: repository.root,
        args: ["add", "--", "src/App.tsx"],
      });
      await repository.write(
        "src/App.tsx",
        "export const App = () => <button>Local worktree</button>;\n",
      );
      await repository.write("notes.txt", "keep this untracked note\n");
      const statusBefore = await runGitCommand({
        cwd: repository.root,
        args: ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      });
      const indexBefore = await runGitCommand({
        cwd: repository.root,
        args: ["show", ":src/App.tsx"],
      });
      const worktree = await createIsolatedGitWorktree({
        root: repository.root,
        signal,
        workingTreeMode: "include-local-changes",
      });

      try {
        expect(await repository.read("src/App.tsx")).toContain("Local worktree");
        expect(await repository.read("notes.txt")).toBe("keep this untracked note\n");
        expect(
          await runGitCommand({ cwd: worktree.root, args: ["status", "--short"] }),
        ).toBe("");
        const touched = await applyAgentPatch(
          worktree.root,
          updateDirtyBaselinePatch,
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
          baselineHashes: await captureAgentFileHashes(
            repository.root,
            changeSet.touchedPaths,
          ),
          expectedHashes: await captureAgentFileHashes(
            worktree.root,
            changeSet.touchedPaths,
          ),
          result: {
            jobId: "job-dirty-baseline",
            summary: "dirty baseline test",
            diff: changeSet.diff,
            files: changeSet.files,
            checks: [],
          },
          root: repository.root,
          validationPassed: true,
        });
        await worktree.cleanup();

        await applyPreparedAgentChange(prepared);
        expect(await repository.read("src/App.tsx")).toContain("Agent result");
        expect(
          await runGitCommand({
            cwd: repository.root,
            args: ["show", ":src/App.tsx"],
          }),
        ).toBe(indexBefore);
        expect(await repository.read("notes.txt")).toBe("keep this untracked note\n");

        await revertPreparedAgentChange(prepared);
        expect(await repository.read("src/App.tsx")).toContain("Local worktree");
        expect(
          await runGitCommand({
            cwd: repository.root,
            args: ["show", ":src/App.tsx"],
          }),
        ).toBe(indexBefore);
        expect(
          await runGitCommand({
            cwd: repository.root,
            args: ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
          }),
        ).toBe(statusBefore);
      } finally {
        await worktree.cleanup();
      }
    } finally {
      await repository.cleanup();
    }
  });

  it("modifies and reverts a user-created untracked source without staging or deleting it", async () => {
    const repository = await createTestGitRepository();
    const signal = new AbortController().signal;

    try {
      await repository.write(
        "src/local.ts",
        'export const localValue = "user draft";\n',
      );
      const statusBefore = await runGitCommand({
        cwd: repository.root,
        args: ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      });
      const worktree = await createIsolatedGitWorktree({
        root: repository.root,
        signal,
        workingTreeMode: "include-local-changes",
      });

      try {
        const touched = await applyAgentPatch(
          worktree.root,
          updateUntrackedBaselinePatch,
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
          baselineHashes: await captureAgentFileHashes(
            repository.root,
            changeSet.touchedPaths,
          ),
          expectedHashes: await captureAgentFileHashes(
            worktree.root,
            changeSet.touchedPaths,
          ),
          result: {
            jobId: "job-untracked-baseline",
            summary: "untracked baseline test",
            diff: changeSet.diff,
            files: changeSet.files,
            checks: [],
          },
          root: repository.root,
          validationPassed: true,
        });
        await worktree.cleanup();

        await applyPreparedAgentChange(prepared);
        expect(await repository.read("src/local.ts")).toContain("agent result");
        expect(
          await runGitCommand({
            cwd: repository.root,
            args: ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
          }),
        ).toBe(statusBefore);

        await revertPreparedAgentChange(prepared);
        expect(await repository.read("src/local.ts")).toContain("user draft");
        expect(
          await runGitCommand({
            cwd: repository.root,
            args: ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
          }),
        ).toBe(statusBefore);
      } finally {
        await worktree.cleanup();
      }
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

  it("allows unrelated concurrent edits while preserving them during Apply", async () => {
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
        baselineHashes: await captureAgentFileHashes(
          repository.root,
          changeSet.touchedPaths,
        ),
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

      await expect(applyPreparedAgentChange(prepared)).resolves.toBeUndefined();
      expect(await repository.read("src/App.tsx")).toContain("After");
      expect(await repository.read("README.md")).toBe("concurrent change\n");
    } finally {
      await worktree.cleanup();
      await repository.cleanup();
    }
  });

  it("refuses Apply when an Agent-touched file changed after baseline capture", async () => {
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
        baselineHashes: await captureAgentFileHashes(
          repository.root,
          changeSet.touchedPaths,
        ),
        expectedHashes: await captureAgentFileHashes(
          worktree.root,
          changeSet.touchedPaths,
        ),
        result: {
          jobId: "job-touched-conflict",
          summary: "touched conflict test",
          diff: changeSet.diff,
          files: changeSet.files,
          checks: [],
        },
        root: repository.root,
        validationPassed: true,
      });
      await worktree.cleanup();
      await repository.write("src/App.tsx", "changed after baseline\n");

      await expect(applyPreparedAgentChange(prepared)).rejects.toMatchObject({
        code: ERROR_CODES.APPLY_CONFLICT,
      });
      expect(await repository.read("src/App.tsx")).toBe("changed after baseline\n");
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
        baselineHashes: await captureAgentFileHashes(
          repository.root,
          changeSet.touchedPaths,
        ),
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
