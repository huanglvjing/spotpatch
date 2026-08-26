import { chmod, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createManagedThreadCleanupJournal } from "./thread-cleanup-journal.js";

let configBase = "";
let projectRoot = "";

beforeEach(async () => {
  configBase = await mkdtemp(path.join(os.tmpdir(), "spotpatch-cleanup-config-"));
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "spotpatch-cleanup-project-"));
  await chmod(configBase, 0o700);
});

afterEach(async () => {
  await Promise.all([
    rm(configBase, { recursive: true, force: true }),
    rm(projectRoot, { recursive: true, force: true }),
  ]);
});

describe("managed thread cleanup journal", () => {
  it("persists only bounded opaque cleanup identifiers and removes the file when empty", async () => {
    const journal = await createManagedThreadCleanupJournal({
      configBase,
      root: projectRoot,
      now: () => new Date("2026-08-25T00:00:00.000Z"),
    });

    await journal.add("thread:opaque-1");
    await journal.add("thread:opaque-1");
    await expect(journal.list()).resolves.toEqual([
      {
        threadId: "thread:opaque-1",
        createdAt: "2026-08-25T00:00:00.000Z",
      },
    ]);

    const directory = path.join(configBase, "external-agent-cleanup");
    const [fileName] = await readdir(directory);
    if (fileName === undefined) throw new Error("Expected a cleanup journal file.");
    const serialized = await readFile(path.join(directory, fileName), "utf8");
    expect(serialized).toContain("thread:opaque-1");
    expect(serialized).not.toContain(projectRoot);

    await journal.remove("thread:opaque-1");
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it.runIf(process.platform !== "win32")(
    "fails closed when the journal becomes group-readable",
    async () => {
      const journal = await createManagedThreadCleanupJournal({
        configBase,
        root: projectRoot,
      });
      await journal.add("thread-1");
      const directory = path.join(configBase, "external-agent-cleanup");
      const [fileName] = await readdir(directory);
      if (fileName === undefined) throw new Error("Expected a cleanup journal file.");
      await chmod(path.join(directory, fileName), 0o640);

      await expect(journal.list()).rejects.toThrow("not private or bounded");
    },
  );
});
