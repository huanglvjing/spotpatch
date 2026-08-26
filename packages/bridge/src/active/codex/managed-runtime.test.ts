import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  prepareManagedCodexRuntimeHome,
  removeManagedCodexRuntimeHome,
} from "./managed-runtime.js";

const RUNTIME_KEY = "a".repeat(64);
const SIBLING_RUNTIME_KEY = "b".repeat(64);

describe.skipIf(process.platform === "win32")("managed Codex runtime", () => {
  let temporaryRoot = "";
  let projectRoot = "";
  let runtimeBase = "";
  let sourceHome = "";

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "spotpatch-codex-runtime-"));
    projectRoot = path.join(temporaryRoot, "project");
    runtimeBase = path.join(temporaryRoot, "private");
    sourceHome = path.join(temporaryRoot, "codex-home");
    await Promise.all([
      mkdir(projectRoot),
      mkdir(runtimeBase, { mode: 0o700 }),
      mkdir(sourceHome, { mode: 0o700 }),
    ]);
    await writeFile(path.join(sourceHome, "auth.json"), "synthetic\n", {
      mode: 0o600,
    });
  });

  afterEach(async () => {
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  it("creates a project-keyed private home and removes only that project", async () => {
    const environment = { CODEX_HOME: sourceHome };
    const runtimeHome = await prepareManagedCodexRuntimeHome({
      environment,
      excludedRoot: projectRoot,
      runtimeBase,
      runtimeKey: RUNTIME_KEY,
    });
    const siblingHome = await prepareManagedCodexRuntimeHome({
      environment,
      excludedRoot: projectRoot,
      runtimeBase,
      runtimeKey: SIBLING_RUNTIME_KEY,
    });

    expect(path.basename(runtimeHome)).toBe(RUNTIME_KEY);
    expect(path.relative(projectRoot, runtimeHome)).toMatch(/^\.\./u);
    expect((await lstat(runtimeHome)).mode & 0o077).toBe(0);
    expect((await lstat(path.join(runtimeHome, "auth.json"))).isSymbolicLink()).toBe(
      true,
    );
    await expect(realpath(path.join(runtimeHome, "auth.json"))).resolves.toBe(
      await realpath(path.join(sourceHome, "auth.json")),
    );

    await removeManagedCodexRuntimeHome({ runtimeBase, runtimeKey: RUNTIME_KEY });

    await expect(lstat(runtimeHome)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(siblingHome)).resolves.toMatchObject({});
  });

  it("rejects a runtime base inside the project without creating it", async () => {
    const nestedRuntimeBase = path.join(projectRoot, ".spotpatch-private");

    await expect(
      prepareManagedCodexRuntimeHome({
        environment: { CODEX_HOME: sourceHome },
        excludedRoot: projectRoot,
        runtimeBase: nestedRuntimeBase,
        runtimeKey: RUNTIME_KEY,
      }),
    ).rejects.toThrow("cannot be stored in the project");
    await expect(lstat(nestedRuntimeBase)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a source authentication file with broad permissions", async () => {
    await chmod(path.join(sourceHome, "auth.json"), 0o644);

    await expect(
      prepareManagedCodexRuntimeHome({
        environment: { CODEX_HOME: sourceHome },
        excludedRoot: projectRoot,
        runtimeBase,
        runtimeKey: RUNTIME_KEY,
      }),
    ).rejects.toThrow("not private and bounded");
  });

  it("does not follow a substituted runtime directory during removal", async () => {
    const runtimeRoot = path.join(runtimeBase, "external-agent-runtime", "codex");
    const outside = path.join(temporaryRoot, "outside");
    await Promise.all([
      mkdir(runtimeRoot, { recursive: true, mode: 0o700 }),
      mkdir(outside),
    ]);
    await writeFile(path.join(outside, "keep.txt"), "keep\n");
    await symlink(outside, path.join(runtimeRoot, RUNTIME_KEY), "dir");

    await expect(
      removeManagedCodexRuntimeHome({ runtimeBase, runtimeKey: RUNTIME_KEY }),
    ).rejects.toThrow("not owned");
    await expect(lstat(path.join(outside, "keep.txt"))).resolves.toMatchObject({});
  });
});
