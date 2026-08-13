import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { isInsideRoot, isSameFilePath } from "./typescript-utils.js";

let fixtureRoot: string | undefined;

afterEach(async () => {
  if (fixtureRoot !== undefined) {
    await rm(fixtureRoot, { recursive: true, force: true });
    fixtureRoot = undefined;
  }
});

describe("TypeScript path utilities", () => {
  it("recognizes a physical root reached through a different directory alias", async () => {
    fixtureRoot = await mkdtemp(path.join(tmpdir(), "spotpatch-paths-"));
    const physicalRoot = path.join(fixtureRoot, "physical-root");
    const aliasRoot = path.join(fixtureRoot, "alias-root");
    const sourcePath = path.join(physicalRoot, "Example.tsx");
    const outsidePath = path.join(fixtureRoot, "Outside.tsx");
    await mkdir(physicalRoot);
    await Promise.all([
      writeFile(sourcePath, "export const Example = 1;", "utf8"),
      writeFile(outsidePath, "export const Outside = 1;", "utf8"),
    ]);

    try {
      await symlink(physicalRoot, aliasRoot, "junction");
    } catch (error: unknown) {
      if (
        process.platform === "win32" &&
        error instanceof Error &&
        "code" in error &&
        error.code === "EPERM"
      ) {
        return;
      }
      throw error;
    }

    expect(isSameFilePath(aliasRoot, physicalRoot)).toBe(true);
    expect(isInsideRoot(aliasRoot, sourcePath)).toBe(true);
    expect(isInsideRoot(aliasRoot, outsidePath)).toBe(false);
  });
});
