import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { ERROR_CODES } from "@spotpatch/shared";
import { describe, expect, it, vi } from "vitest";

import { createTestGitRepository } from "../test-utils/git-repository.js";
import { GIT_PROCESS_INTEGRATION_TIMEOUT_MS } from "../test-utils/test-timeouts.js";
import { runGitCommand } from "./git-command.js";
import { createIndependentGitSnapshot } from "./independent-snapshot.js";

vi.setConfig({ testTimeout: GIT_PROCESS_INTEGRATION_TIMEOUT_MS });

describe("independent Git snapshot", () => {
  it("creates a detached repository with no source remote or object alternates", async () => {
    const repository = await createTestGitRepository();
    const snapshot = await createIndependentGitSnapshot({
      root: repository.root,
      signal: new AbortController().signal,
    });

    try {
      expect(snapshot.root).not.toContain(repository.root);
      expect(await readFile(path.join(snapshot.root, "src/App.tsx"), "utf8")).toContain(
        "Before",
      );
      expect(
        (await runGitCommand({ cwd: snapshot.root, args: ["remote"] })).trim(),
      ).toBe("");
      expect(
        await lstat(
          path.join(snapshot.metadataRoot, "objects", "info", "alternates"),
        ).catch(() => undefined),
      ).toBeUndefined();
      expect((await lstat(path.join(snapshot.root, ".git"))).isFile()).toBe(true);
      expect(path.dirname(snapshot.metadataRoot)).toBe(path.dirname(snapshot.root));

      await repository.write(
        "src/App.tsx",
        "export const App = () => <button>User change</button>;\n",
      );
      expect(await readFile(path.join(snapshot.root, "src/App.tsx"), "utf8")).toContain(
        "Before",
      );
    } finally {
      await snapshot.cleanup();
      await repository.cleanup();
    }

    await expect(lstat(snapshot.root)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails integrity checks when the workspace Git pointer is modified", async () => {
    const repository = await createTestGitRepository();
    const snapshot = await createIndependentGitSnapshot({
      root: repository.root,
      signal: new AbortController().signal,
    });

    try {
      await writeFile(path.join(snapshot.root, ".git"), "gitdir: /tmp/untrusted\n");
      await expect(
        snapshot.assertIntegrity(new AbortController().signal),
      ).rejects.toMatchObject({
        code: ERROR_CODES.WORKTREE_LOCAL_CHANGES_UNSUPPORTED,
      });
    } finally {
      await snapshot.cleanup();
      await repository.cleanup();
    }
  });

  it("fails closed when the source workspace is dirty", async () => {
    const repository = await createTestGitRepository();

    try {
      await repository.write(
        "src/App.tsx",
        "export const App = () => <button>Dirty</button>;\n",
      );
      await expect(
        createIndependentGitSnapshot({
          root: repository.root,
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.WORKTREE_DIRTY });
    } finally {
      await repository.cleanup();
    }
  });

  it("excludes unrelated local changes while preserving the source index", async () => {
    const repository = await createTestGitRepository({
      "README.md": "Committed documentation.\n",
      "src/App.tsx": "export const App = () => <button>Before</button>;\n",
    });

    try {
      await repository.write("README.md", "Staged local documentation.\n");
      await repository.write("notes.txt", "Untracked local notes.\n");
      await runGitCommand({ cwd: repository.root, args: ["add", "README.md"] });
      const sourceStatus = await runGitCommand({
        cwd: repository.root,
        args: ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      });
      const snapshot = await createIndependentGitSnapshot({
        root: repository.root,
        requiredCleanPaths: ["src/App.tsx"],
        signal: new AbortController().signal,
      });

      try {
        expect(await readFile(path.join(snapshot.root, "README.md"), "utf8")).toBe(
          "Committed documentation.\n",
        );
        expect(
          await lstat(path.join(snapshot.root, "notes.txt")).catch(() => undefined),
        ).toBeUndefined();
        expect(
          await runGitCommand({
            cwd: repository.root,
            args: ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
          }),
        ).toBe(sourceStatus);
      } finally {
        await snapshot.cleanup();
      }
    } finally {
      await repository.cleanup();
    }
  });

  it.each(["staged", "unstaged"] as const)(
    "rejects a %s modification to a required path",
    async (state) => {
      const repository = await createTestGitRepository();

      try {
        await repository.write(
          "src/App.tsx",
          "export const App = () => <button>Local</button>;\n",
        );
        if (state === "staged") {
          await runGitCommand({
            cwd: repository.root,
            args: ["add", "src/App.tsx"],
          });
        }
        await expect(
          createIndependentGitSnapshot({
            root: repository.root,
            requiredCleanPaths: ["src/App.tsx"],
            signal: new AbortController().signal,
          }),
        ).rejects.toMatchObject({ code: ERROR_CODES.WORKTREE_DIRTY });
      } finally {
        await repository.cleanup();
      }
    },
  );

  it("rejects an untracked required path", async () => {
    const repository = await createTestGitRepository();

    try {
      await repository.write("src/New.tsx", "export const New = () => null;\n");
      await expect(
        createIndependentGitSnapshot({
          root: repository.root,
          requiredCleanPaths: ["src/New.tsx"],
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.WORKTREE_DIRTY });
    } finally {
      await repository.cleanup();
    }
  });
});
