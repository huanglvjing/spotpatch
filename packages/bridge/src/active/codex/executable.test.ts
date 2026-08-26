import {
  chmod,
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

import { CODEX_ADAPTER_ERROR_CODES } from "./errors.js";
import { resolveCodexExecutable } from "./executable.js";

async function executable(directory: string, version = "0.149.0"): Promise<string> {
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, "codex-bin");
  await writeFile(
    target,
    `#!/usr/bin/env node\nprocess.stdout.write("codex-cli ${version}\\n");\n`,
  );
  await chmod(target, 0o700);
  const command = path.join(directory, "codex");
  await symlink(target, command);
  return target;
}

describe.skipIf(process.platform === "win32")("Codex executable resolution", () => {
  let temporaryRoot: string;
  let projectRoot: string;

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "spotpatch-codex-path-"));
    projectRoot = path.join(temporaryRoot, "project");
    await mkdir(projectRoot);
  });

  afterEach(async () => {
    await rm(temporaryRoot, { force: true, recursive: true });
  });

  it("returns the absolute realpath and detected version inside the supported range", async () => {
    const bin = path.join(temporaryRoot, "trusted-bin");
    const target = await executable(bin, "0.149.7");

    await expect(
      resolveCodexExecutable(projectRoot, { pathValue: bin }),
    ).resolves.toEqual({
      path: await realpath(target),
      version: "0.149.7",
    });
  });

  it("ignores relative PATH entries instead of resolving them against the project", async () => {
    await executable(path.join(projectRoot, "relative-bin"));

    await expect(
      resolveCodexExecutable(projectRoot, { pathValue: "relative-bin" }),
    ).rejects.toMatchObject({
      code: CODEX_ADAPTER_ERROR_CODES.EXECUTABLE_NOT_FOUND,
    });
  });

  it("rejects an executable whose realpath is inside the project root", async () => {
    const bin = path.join(projectRoot, "bin");
    await executable(bin);

    await expect(
      resolveCodexExecutable(projectRoot, { pathValue: bin }),
    ).rejects.toMatchObject({
      code: CODEX_ADAPTER_ERROR_CODES.EXECUTABLE_UNTRUSTED,
    });
  });

  it("rejects a non-executable candidate", async () => {
    const bin = path.join(temporaryRoot, "non-executable-bin");
    await mkdir(bin);
    await writeFile(path.join(bin, "codex"), "codex-cli 0.149.0\n", {
      mode: 0o600,
    });

    await expect(
      resolveCodexExecutable(projectRoot, { pathValue: bin }),
    ).rejects.toMatchObject({
      code: CODEX_ADAPTER_ERROR_CODES.EXECUTABLE_NOT_FOUND,
    });
  });

  it("rejects a version outside the supported semantic range", async () => {
    const bin = path.join(temporaryRoot, "wrong-version-bin");
    await executable(bin, "0.150.0");

    await expect(
      resolveCodexExecutable(projectRoot, { pathValue: bin }),
    ).rejects.toMatchObject({
      code: CODEX_ADAPTER_ERROR_CODES.UNSUPPORTED_VERSION,
    });
  });
});
