import { chmod, lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { publishExternalHandoffDescriptor } from "./discovery.js";

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function privateTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(directory);
  await chmod(directory, 0o700);
  return directory;
}

describe("external handoff descriptor publisher", () => {
  it("atomically publishes only private connection metadata and removes its own file", async () => {
    const runtimeRoot = await privateTemporaryDirectory("spotpatch-xdg-");
    const projectRoot = await privateTemporaryDirectory("spotpatch-project-");
    vi.stubEnv("XDG_RUNTIME_DIR", runtimeRoot);
    const published = await publishExternalHandoffDescriptor({
      bridgeToken: "a".repeat(43),
      endpoint: "http://127.0.0.1:43123",
      framework: "vite",
      root: projectRoot,
      sessionId: "0123456789abcdef012345",
    });
    const runtimeDirectory = path.join(runtimeRoot, "spotpatch");
    const entries = await readdir(runtimeDirectory);
    expect(entries).toEqual(["0123456789abcdef012345.json"]);
    const descriptorPath = path.join(runtimeDirectory, entries[0] ?? "missing");
    const status = await lstat(descriptorPath);
    const content = await readFile(descriptorPath, "utf8");
    expect(status.isFile()).toBe(true);
    expect(status.isSymbolicLink()).toBe(false);
    if (process.platform !== "win32") {
      expect(status.mode & 0o077).toBe(0);
    }
    expect(content).not.toContain(projectRoot);
    expect(content).not.toContain("annotation");
    expect(JSON.parse(content)).toEqual(published.descriptor);

    await published.close();
    expect(await readdir(runtimeDirectory)).toEqual([]);
    await published.close();
  });

  it.runIf(process.platform !== "win32")(
    "fails closed when the configured runtime directory is group-readable",
    async () => {
      const runtimeRoot = await privateTemporaryDirectory("spotpatch-xdg-wide-");
      const projectRoot = await privateTemporaryDirectory("spotpatch-project-");
      await chmod(runtimeRoot, 0o755);
      vi.stubEnv("XDG_RUNTIME_DIR", runtimeRoot);

      await expect(
        publishExternalHandoffDescriptor({
          bridgeToken: "a".repeat(43),
          endpoint: "http://127.0.0.1:43123",
          framework: "next",
          root: projectRoot,
          sessionId: "0123456789abcdef012345",
        }),
      ).rejects.toMatchObject({ code: "BRIDGE_UNAUTHORIZED" });
    },
  );
});
