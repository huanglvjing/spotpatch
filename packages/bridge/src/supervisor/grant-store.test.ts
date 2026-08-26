import { chmod, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createManagedGrantStore } from "./grant-store.js";

let configBase = "";
let projectRoot = "";

beforeEach(async () => {
  configBase = await mkdtemp(path.join(os.tmpdir(), "spotpatch-grant-config-"));
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "spotpatch-grant-project-"));
  await chmod(configBase, 0o700);
});

afterEach(async () => {
  await Promise.all([
    rm(configBase, { recursive: true, force: true }),
    rm(projectRoot, { recursive: true, force: true }),
  ]);
});

describe("managed grant store", () => {
  it("persists only a project key and fixed policy facts", async () => {
    const clock = new Date("2026-08-25T00:00:00.000Z");
    const store = await createManagedGrantStore({
      configBase,
      root: projectRoot,
      now: () => clock,
    });

    expect(await store.read()).toBe("missing");
    await store.grant();
    expect(await store.read()).toBe("valid");
    const directory = path.join(configBase, "external-agent-grants");
    const [fileName] = await readdir(directory);
    if (fileName === undefined) throw new Error("Expected a grant file.");
    const content = await readFile(path.join(directory, fileName), "utf8");

    expect(content).toContain('"profile":"managed-apply-v1"');
    expect(content).toContain(store.projectKey);
    expect(content).not.toContain(projectRoot);
    expect(content).not.toContain("token");
    await store.revoke();
    expect(await store.read()).toBe("missing");
  });

  it.runIf(process.platform !== "win32")(
    "fails closed when a grant becomes group-readable",
    async () => {
      const store = await createManagedGrantStore({ configBase, root: projectRoot });
      await store.grant();
      const directory = path.join(configBase, "external-agent-grants");
      const [fileName] = await readdir(directory);
      if (fileName === undefined) throw new Error("Expected a grant file.");
      await chmod(path.join(directory, fileName), 0o644);

      expect(await store.read()).toBe("invalid");
      await expect(store.touch()).rejects.toThrow();
    },
  );
});
