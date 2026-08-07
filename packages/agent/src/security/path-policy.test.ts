import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ERROR_CODES } from "@spotpatch/shared";

import {
  assertAgentPathAllowed,
  normalizeAgentPath,
  resolveExistingAgentPath,
  resolveWritableAgentPath,
} from "./path-policy.js";
import { readAgentTextFile, writeAgentTextFileIfContentMatches } from "./text-file.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "spotpatch-path-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Agent path policy", () => {
  it("accepts normalized project-relative source paths", () => {
    expect(normalizeAgentPath("src/components/App.tsx")).toBe("src/components/App.tsx");
    expect(assertAgentPathAllowed("docs/README.md")).toBe("docs/README.md");
  });

  it.each([
    "",
    "/etc/passwd",
    "../secret",
    "src/../secret",
    "src\\App.tsx",
    "src/%2e%2e/secret",
    "src//App.tsx",
    "src:\\App.tsx",
    ".git/config",
    ".env.local",
    ".envrc",
    ".npmrc",
    "config/private.pem",
    "config/private.p12",
    "keys/id_rsa_test",
    ".ssh/config",
    "node_modules/pkg/index.js",
    "dist/bundle.js",
    "pnpm-lock.yaml",
  ])("rejects unsafe path %s", (value) => {
    expect(() => assertAgentPathAllowed(value)).toThrowError(ERROR_CODES.TOOL_DENIED);
  });

  it("rejects a symlink escape for reads and writes", async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    await writeFile(path.join(outside, "secret.txt"), "secret", "utf8");
    await symlink(outside, path.join(root, "linked"));

    await expect(
      resolveExistingAgentPath(root, "linked/secret.txt"),
    ).rejects.toMatchObject({ code: ERROR_CODES.TOOL_DENIED });
    await expect(
      resolveWritableAgentPath(root, "linked/new.txt"),
    ).rejects.toMatchObject({ code: ERROR_CODES.TOOL_DENIED });
  });

  it("reads bounded UTF-8 text and rejects binary or oversized files", async () => {
    const root = await temporaryDirectory();
    await writeFile(path.join(root, "text.txt"), "你好 SpotPatch", "utf8");
    await writeFile(path.join(root, "binary.bin"), Buffer.from([1, 0, 2]));

    await expect(readAgentTextFile(root, "text.txt", 100)).resolves.toMatchObject({
      content: "你好 SpotPatch",
    });
    await expect(readAgentTextFile(root, "text.txt", 2)).rejects.toMatchObject({
      code: ERROR_CODES.AGENT_LIMIT_EXCEEDED,
    });
    await expect(readAgentTextFile(root, "binary.bin", 100)).rejects.toMatchObject({
      code: ERROR_CODES.TOOL_DENIED,
    });
  });

  it("atomically writes only a matching bounded UTF-8 file and preserves its BOM", async () => {
    const root = await temporaryDirectory();
    const target = path.join(root, "text.txt");
    const byteOrderMark = Buffer.from([0xef, 0xbb, 0xbf]);
    await writeFile(target, Buffer.concat([byteOrderMark, Buffer.from("Before")]));

    await writeAgentTextFileIfContentMatches(root, "text.txt", "Before", "After", 100);
    expect(await readFile(target)).toEqual(
      Buffer.concat([byteOrderMark, Buffer.from("After")]),
    );
    await expect(
      writeAgentTextFileIfContentMatches(
        root,
        "text.txt",
        "Before",
        "Stale overwrite",
        100,
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.PATCH_REJECTED });
    await expect(
      writeAgentTextFileIfContentMatches(
        root,
        "text.txt",
        "After",
        "Result exceeds the configured byte limit",
        10,
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.AGENT_LIMIT_EXCEEDED });
    expect(await readFile(target)).toEqual(
      Buffer.concat([byteOrderMark, Buffer.from("After")]),
    );
  });
});
