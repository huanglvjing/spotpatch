import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const REPOSITORY_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RUNNER_PATH = path.join(REPOSITORY_ROOT, "scripts", "dev.mjs");
const temporaryDirectories = [];

async function createFakePnpm(directory) {
  const executable = path.join(directory, "fake-pnpm.mjs");
  await writeFile(
    executable,
    `import { appendFileSync, readFileSync } from "node:fs";

const log = process.env.SPOTPATCH_DEV_TEST_LOG;
if (log === undefined) process.exit(90);
const args = process.argv.slice(2);
const role = args.includes("build")
  ? "build"
  : args.includes("@spotpatch/playground")
    ? "playground"
    : "watchers";
appendFileSync(log, JSON.stringify({ role, args }) + "\\n");

if (role === "build") process.exit(0);
if (role === "watchers") {
  process.stdin.on("data", (chunk) => {
    appendFileSync(log, JSON.stringify({ role, input: String(chunk) }) + "\\n");
  });
  process.once("SIGTERM", () => {
    appendFileSync(log, JSON.stringify({ role, signal: "SIGTERM" }) + "\\n");
    process.exit(0);
  });
  setInterval(() => undefined, 1_000);
} else {
  const readyInterval = setInterval(() => {
    if (!readFileSync(log, "utf8").includes('"role":"watchers"')) return;
    clearInterval(readyInterval);
    process.stdout.write("playground-ready\\n");
  }, 5);
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    appendFileSync(log, JSON.stringify({ role, input: chunk }) + "\\n");
    if (chunk.includes("yes")) process.exit(0);
  });
}
`,
    "utf8",
  );
  return executable;
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("development process runner", () => {
  it("reserves stdin for the playground and stops package watchers with it", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "spotpatch-dev-runner-"));
    temporaryDirectories.push(directory);
    const log = path.join(directory, "calls.jsonl");
    const fakePnpm = await createFakePnpm(directory);
    const child = spawn(process.execPath, [RUNNER_PATH], {
      cwd: REPOSITORY_ROOT,
      env: {
        ...process.env,
        npm_execpath: fakePnpm,
        SPOTPATCH_DEV_TEST_LOG: log,
      },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let inputSent = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (!inputSent && stdout.includes("playground-ready")) {
        inputSent = true;
        child.stdin.write("yes\n");
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    const outcome = await waitForExit(child);
    const entries = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(outcome).toEqual({ code: 0, signal: null });
    expect(stderr).toBe("");
    expect(entries).toContainEqual({
      role: "build",
      args: ["--filter", "@spotpatch/vite...", "build"],
    });
    expect(entries).toContainEqual({
      role: "watchers",
      args: [
        "--parallel",
        "--stream",
        "--filter",
        "@spotpatch/vite...",
        "--if-present",
        "dev",
      ],
    });
    expect(entries).toContainEqual({
      role: "playground",
      args: ["--filter", "@spotpatch/playground", "dev"],
    });
    expect(entries).toContainEqual({ role: "playground", input: "yes\n" });
    expect(entries).toContainEqual({ role: "watchers", signal: "SIGTERM" });
    expect(entries.some((entry) => entry.role === "watchers" && "input" in entry)).toBe(
      false,
    );
  });
});
