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
import {
  resolveCodexExecutable,
  resolveWindowsNpmCodexExecutable,
} from "./executable.js";
import { fakeSchemaCommandSource } from "./test-schema-fixture.js";

const windowsRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    windowsRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function executable(
  directory: string,
  version = "0.149.0",
  omitSchemaMethod?: string,
  schemaRootSymlinkTarget?: string,
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, "codex-bin");
  await writeFile(
    target,
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
if (process.argv[2] === "--version") {
  process.stdout.write("codex-cli ${version}\\n");
  process.exit(0);
}
${fakeSchemaCommandSource(omitSchemaMethod, schemaRootSymlinkTarget)}
process.exit(64);
`,
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

  it.each(["0.151.0", "1.2.3"])(
    "accepts later stable version %s when its generated schema is compatible",
    async (version) => {
      const bin = path.join(
        temporaryRoot,
        `compatible-${version.replaceAll(".", "-")}`,
      );
      const target = await executable(bin, version);

      await expect(
        resolveCodexExecutable(projectRoot, { pathValue: bin }),
      ).resolves.toEqual({
        path: await realpath(target),
        version,
      });
    },
  );

  it("rejects a version below the minimum supported semantic version", async () => {
    const bin = path.join(temporaryRoot, "wrong-version-bin");
    await executable(bin, "0.148.9");

    await expect(
      resolveCodexExecutable(projectRoot, { pathValue: bin }),
    ).rejects.toMatchObject({
      code: CODEX_ADAPTER_ERROR_CODES.UNSUPPORTED_VERSION,
    });
  });

  it.each(["0.149.01", "0.149.0-beta.1", "v0.149.0"])(
    "rejects malformed or prerelease version output %s",
    async (version) => {
      const bin = path.join(temporaryRoot, `malformed-${version.replaceAll(".", "-")}`);
      await executable(bin, version);

      await expect(
        resolveCodexExecutable(projectRoot, { pathValue: bin }),
      ).rejects.toMatchObject({
        code: CODEX_ADAPTER_ERROR_CODES.UNSUPPORTED_VERSION,
      });
    },
  );

  it("rejects a CLI whose generated schema is missing a required method", async () => {
    const bin = path.join(temporaryRoot, "incompatible-schema-bin");
    await executable(bin, "0.150.1", "turn/start");

    await expect(
      resolveCodexExecutable(projectRoot, { pathValue: bin }),
    ).rejects.toMatchObject({
      code: CODEX_ADAPTER_ERROR_CODES.SCHEMA_INCOMPATIBLE,
    });
  });

  it("rejects a generated schema directory redirected outside its private root", async () => {
    const bin = path.join(temporaryRoot, "redirected-schema-bin");
    await executable(
      bin,
      "0.150.1",
      undefined,
      path.join(temporaryRoot, "redirected-schema"),
    );

    await expect(
      resolveCodexExecutable(projectRoot, { pathValue: bin }),
    ).rejects.toMatchObject({
      code: CODEX_ADAPTER_ERROR_CODES.SCHEMA_INCOMPATIBLE,
    });
  });
});

describe("Windows npm Codex executable resolution", () => {
  it("resolves the standard npm shim to the platform package binary", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotpatch-codex-windows-"));
    windowsRoots.push(root);
    const bin = path.join(root, "bin");
    const packageRoot = path.join(bin, "node_modules", "@openai", "codex-win32-x64");
    const executable = path.join(
      packageRoot,
      "vendor",
      "x86_64-pc-windows-msvc",
      "bin",
      "codex.exe",
    );
    await mkdir(path.dirname(executable), { recursive: true });
    await writeFile(path.join(bin, "codex.cmd"), "@echo off\r\n");
    await writeFile(
      path.join(packageRoot, "package.json"),
      '{"name":"@openai/codex","version":"0.151.0-win32-x64"}\n',
    );
    await writeFile(executable, "fixture");
    await chmod(executable, 0o700);

    await expect(
      resolveWindowsNpmCodexExecutable(path.join(bin, "codex.cmd"), "x64"),
    ).resolves.toBe(await realpath(executable));
  });

  it("fails closed when the platform package is absent", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotpatch-codex-windows-"));
    windowsRoots.push(root);
    const shim = path.join(root, "codex.cmd");
    await writeFile(shim, "@echo off\r\n");

    await expect(resolveWindowsNpmCodexExecutable(shim, "x64")).resolves.toBe(
      undefined,
    );
  });

  it("rejects a malformed platform package without exposing filesystem errors", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotpatch-codex-windows-"));
    windowsRoots.push(root);
    const bin = path.join(root, "bin");
    const packageRoot = path.join(bin, "node_modules", "@openai", "codex-win32-x64");
    await mkdir(packageRoot, { recursive: true });
    await writeFile(path.join(bin, "codex.cmd"), "@echo off\r\n");
    await writeFile(
      path.join(packageRoot, "package.json"),
      '{"name":"@openai/codex","version":"0.151.0-win32-x64"}\n',
    );

    await expect(
      resolveWindowsNpmCodexExecutable(path.join(bin, "codex.cmd"), "x64"),
    ).rejects.toMatchObject({
      code: CODEX_ADAPTER_ERROR_CODES.EXECUTABLE_UNTRUSTED,
    });
  });
});

it.runIf(process.env.SPOTPATCH_RUN_CODEX_DISTRIBUTION === "1")(
  "validates the installed stable Codex distribution and generated schema",
  async () => {
    const resolved = await resolveCodexExecutable(process.cwd());
    expect(resolved.version).toMatch(
      /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u,
    );
  },
  20_000,
);
