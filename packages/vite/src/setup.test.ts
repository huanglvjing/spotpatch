import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createInstallCommand,
  detectPackageManager,
  readCurrentAdapterVersion,
} from "./setup.js";

const roots: string[] = [];

async function fixture(
  manifest: Readonly<Record<string, unknown>> = {},
  lockfiles: readonly string[] = [],
): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "spotpatch-vite-setup-"));
  roots.push(root);
  await writeFile(path.join(root, "package.json"), JSON.stringify(manifest));
  await Promise.all(
    lockfiles.map((name) => writeFile(path.join(root, name), "lockfile\n")),
  );
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Vite one-command setup", () => {
  it("prefers an explicit supported packageManager declaration", async () => {
    const root = await fixture({ packageManager: "pnpm@11.1.1" }, [
      "package-lock.json",
    ]);

    await expect(detectPackageManager(root, "npm/11.0.0")).resolves.toBe("pnpm");
  });

  it("uses the single project lockfile before the invoking user agent", async () => {
    const root = await fixture({}, ["pnpm-lock.yaml"]);

    await expect(detectPackageManager(root, "npm/11.0.0")).resolves.toBe("pnpm");
  });

  it("falls back to the invoking supported package manager", async () => {
    const root = await fixture();

    await expect(detectPackageManager(root, "npm/11.0.0")).resolves.toBe("npm");
  });

  it("rejects ambiguous lockfiles without installing", async () => {
    const root = await fixture({}, ["pnpm-lock.yaml", "package-lock.json"]);

    await expect(detectPackageManager(root, "pnpm/11.1.1")).rejects.toThrow(
      /both pnpm-lock\.yaml and package-lock\.json/u,
    );
  });

  it("installs the running CLI's exact version without a shell", () => {
    expect(createInstallCommand("pnpm", "1.8.1", "darwin")).toEqual({
      executable: "pnpm",
      arguments: ["add", "-D", "@spotpatch/vite@1.8.1"],
    });
    expect(createInstallCommand("npm", "1.8.1", "win32")).toEqual({
      executable: "npm.cmd",
      arguments: ["install", "--save-dev", "@spotpatch/vite@1.8.1"],
    });
  });

  it("reads a valid exact version from the package running the CLI", async () => {
    await expect(readCurrentAdapterVersion()).resolves.toMatch(/^\d+\.\d+\.\d+$/u);
  });

  it("rejects an invalid package version before spawning a package manager", () => {
    expect(() => createInstallCommand("pnpm", "latest", "darwin")).toThrow(
      /could not determine its package version/u,
    );
  });
});
