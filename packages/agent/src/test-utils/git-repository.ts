import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runGitCommand } from "../worktree/git-command.js";

export interface TestGitRepository {
  readonly root: string;
  readonly cleanup: () => Promise<void>;
  readonly read: (relativePath: string) => Promise<string>;
  readonly write: (relativePath: string, content: string) => Promise<void>;
}

async function writeRelativeFile(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const target = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

export async function createTestGitRepository(
  files: Readonly<Record<string, string>> = {
    "src/App.tsx": "export const App = () => <button>Before</button>;\n",
  },
): Promise<TestGitRepository> {
  const root = await mkdtemp(path.join(os.tmpdir(), "spotpatch-repo-test-"));

  for (const [relativePath, content] of Object.entries(files)) {
    await writeRelativeFile(root, relativePath, content);
  }

  await runGitCommand({ cwd: root, args: ["init", "--quiet"] });
  await runGitCommand({ cwd: root, args: ["add", "--all"] });
  await runGitCommand({
    cwd: root,
    args: [
      "-c",
      "user.name=SpotPatch Test",
      "-c",
      "user.email=spotpatch@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "test fixture",
    ],
  });

  return Object.freeze({
    root,
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
    read(relativePath: string): Promise<string> {
      return readFile(path.join(root, ...relativePath.split("/")), "utf8");
    },
    write(relativePath: string, content: string): Promise<void> {
      return writeRelativeFile(root, relativePath, content);
    },
  });
}
