import { createHash } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ContextualAskExecutorInput } from "@spotpatch/agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createManagedCodexAskExecutor } from "./ask-adapter.js";
import { fakeSchemaCommandSource } from "./test-schema-fixture.js";

interface Scenario {
  readonly answerDelayMs?: number;
  readonly cleanupThreadMissing?: boolean;
  readonly crashOnTurn?: boolean;
  readonly duplicateFinal?: boolean;
  readonly ephemeralDelete?: boolean;
  readonly hookConfigured?: boolean;
  readonly mcpConfigured?: boolean;
  readonly reverseRequest?: string;
  readonly lateWriteDiff?: boolean;
  readonly turnStatus?: "completed" | "failed" | "interrupted";
  readonly writeDiff?: boolean;
}

const SOURCE = "export function Card() {\n  return <article>Card</article>;\n}\n";
const SOURCE_HASH = createHash("sha256").update(SOURCE).digest("hex");
const ANSWER = {
  blocks: [
    {
      kind: "paragraph",
      text: "Card is a presentational component.",
      citations: [{ handleId: "source_handle", startLine: 1, endLine: 2 }],
    },
  ],
  warnings: [],
};
const WIRE_ANSWER = {
  blocks: ANSWER.blocks.map((block) => ({
    kind: block.kind,
    text: block.text,
    listItems: [],
    code: null,
    language: null,
    citations: block.citations,
  })),
  warnings: ANSWER.warnings,
};

const FAKE_ASK_APP_SERVER = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

if (process.argv[2] === "--version") {
  process.stdout.write("codex-cli 0.151.0\n");
  process.exit(0);
}
${fakeSchemaCommandSource()}
if (process.argv[process.argv.length - 1] !== "app-server") process.exit(64);

const scenario = JSON.parse(fs.readFileSync(path.join(__dirname, "scenario.json"), "utf8"));
const capturePath = path.join(__dirname, "capture.jsonl");
const capture = (value) => fs.appendFileSync(capturePath, JSON.stringify(value) + "\n");
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
capture({ kind: "launch", argv: process.argv.slice(2), codexHome: process.env.CODEX_HOME });

let threadId;
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  const message = JSON.parse(line);
  capture({ kind: "input", message });
  if (message.method === "initialize") {
    send({ id: message.id, result: {
      userAgent: "codex_cli_rs/0.151.0",
      codexHome: process.env.CODEX_HOME,
      platformFamily: "unix",
      platformOs: process.platform,
    } });
    return;
  }
  if (message.method === "initialized") return;
  if (message.method === "account/read") {
    send({ id: message.id, result: { account: { type: "apiKey" }, requiresOpenaiAuth: true } });
    return;
  }
  if (message.method === "model/list") {
    send({ id: message.id, result: { data: [{ model: "gpt-test", isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: "low", description: "Fast" }] }], nextCursor: null } });
    return;
  }
  if (message.method === "configRequirements/read") {
    send({ id: message.id, result: { requirements: null } });
    return;
  }
  if (message.method === "thread/start") {
    threadId = "thread-" + Math.random().toString(16).slice(2);
    capture({ kind: "workspace", files: fs.readdirSync(message.params.cwd, { recursive: true }) });
    send({ id: message.id, result: {
      thread: { id: threadId, ephemeral: true, cwd: message.params.cwd },
      cwd: message.params.cwd,
      runtimeWorkspaceRoots: message.params.runtimeWorkspaceRoots,
      approvalPolicy: message.params.approvalPolicy,
      activePermissionProfile: { id: message.params.permissions, extends: null },
      instructionSources: [],
    } });
    return;
  }
  if (message.method === "hooks/list") {
    send({ id: message.id, result: { data: message.params.cwds.map((cwd) => ({
      cwd,
      hooks: scenario.hookConfigured ? [{ enabled: true }] : [],
      warnings: [],
      errors: [],
    })) } });
    return;
  }
  if (message.method === "mcpServerStatus/list") {
    send({ id: message.id, result: { data: scenario.mcpConfigured ? [{ name: "unsafe" }] : [], nextCursor: null } });
    return;
  }
  if (message.method === "thread/delete" && scenario.cleanupThreadMissing) {
    send({ id: message.id, error: { code: -32600, message: "cleanup failed" } });
    return;
  }
  if (message.method === "thread/delete" && scenario.ephemeralDelete) {
    send({ id: message.id, error: { code: -32600, message: "thread is not persisted and cannot be deleted: " + message.params.threadId } });
    return;
  }
  if (message.method === "thread/delete" || message.method === "turn/interrupt") {
    send({ id: message.id, result: {} });
    return;
  }
  if (message.method !== "turn/start") return;
  const turnId = "turn-1";
  send({ id: message.id, result: { turn: { id: turnId, status: "inProgress" } } });
  send({ method: "turn/started", params: { threadId, turnId, turn: { id: turnId, status: "inProgress" } } });
  if (scenario.crashOnTurn) process.exit(70);
  if (scenario.reverseRequest) {
    send({ id: "reverse-1", method: scenario.reverseRequest, params: {} });
    return;
  }
  if (scenario.writeDiff) {
    send({ method: "turn/diff/updated", params: { threadId, turnId, diff: "diff --git a/x b/x" } });
    return;
  }
  const finish = () => {
    const finalItem = { id: "final-1", type: "agentMessage", phase: "final_answer", text: ${JSON.stringify(JSON.stringify(WIRE_ANSWER))} };
    send({ method: "item/completed", params: { threadId, turnId, item: finalItem } });
    if (scenario.duplicateFinal) {
      send({ method: "item/completed", params: { threadId, turnId, item: { ...finalItem, id: "final-2" } } });
    }
    send({ method: "turn/completed", params: {
      threadId,
      turnId,
      turn: { id: turnId, status: scenario.turnStatus || "completed" },
    } });
    if (scenario.lateWriteDiff) {
      send({ method: "turn/diff/updated", params: { threadId, turnId, diff: "late diff" } });
    }
  };
  if (scenario.answerDelayMs) setTimeout(finish, scenario.answerDelayMs);
  else finish();
});
`;

function askInput(): ContextualAskExecutorInput {
  const page = {
    url: "http://127.0.0.1:3000/card",
    pathname: "/card",
    title: "Card",
    viewportWidth: 1200,
    viewportHeight: 800,
    devicePixelRatio: 2,
  };
  const source = Object.freeze({
    handleId: "source_handle",
    fileId: "source_file",
    relativePath: "src/Card.tsx",
    label: "Card.tsx",
    lineCount: 3,
    size: Buffer.byteLength(SOURCE),
    contentHash: SOURCE_HASH,
    confidence: "exact" as const,
    targetIds: Object.freeze(["target_1"]),
  });
  return {
    jobId: "ask_job",
    envelope: {
      schemaVersion: 1,
      taskId: "ask_task",
      task: { kind: "ask", question: "What is this component?" },
      selection: {
        schemaVersion: 1,
        selectionId: "selection_1",
        locale: "en-US",
        createdAt: "2026-09-02T00:00:00.000Z",
        targets: [
          {
            targetId: "target_1",
            page,
            source: {
              fileId: "source_file",
              relativePath: "src/Card.tsx",
              line: 1,
              column: 1,
              origin: "jsx-host",
              confidence: "exact",
            },
            react: { supported: true, componentStack: [] },
            element: {
              tagName: "article",
              selector: "article",
              sanitizedHtml: "<article>Card</article>",
              rect: { x: 0, y: 0, width: 100, height: 40 },
            },
            styles: { classNames: [], matchedRules: [], computed: {}, warnings: [] },
            code: {
              relativePath: "src/Card.tsx",
              language: "tsx",
              startLine: 1,
              endLine: 3,
              excerpt: SOURCE,
              boundary: "component",
            },
            warnings: [],
          },
        ],
      },
      createdAt: "2026-09-02T00:00:00.000Z",
    },
    grant: { contextHash: SOURCE_HASH, truncated: false, sources: [source] },
    snapshot: {
      manifest: () => [source],
      read: () => ({
        handleId: source.handleId,
        startLine: 1,
        endLine: 3,
        content: SOURCE,
      }),
      search: () => [],
    },
  };
}

const describeManagedAsk = process.platform === "win32" ? describe.skip : describe;

describeManagedAsk("Managed Codex Ask executor", () => {
  let temporaryRoot = "";
  let projectRoot = "";
  let pathValue = "";
  let privateRuntimeBase = "";
  let scenarioPath = "";
  let capturePath = "";

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "spotpatch-ask-adapter-"));
    projectRoot = path.join(temporaryRoot, "project");
    pathValue = path.join(temporaryRoot, "bin");
    privateRuntimeBase = path.join(temporaryRoot, "private-runtime");
    const sourceCodexHome = path.join(temporaryRoot, "source-codex-home");
    await Promise.all([mkdir(projectRoot), mkdir(pathValue), mkdir(sourceCodexHome)]);
    await writeFile(path.join(sourceCodexHome, "auth.json"), "{}\n", { mode: 0o600 });
    const target = path.join(pathValue, "codex-bin");
    await writeFile(target, FAKE_ASK_APP_SERVER);
    await chmod(target, 0o700);
    await symlink(target, path.join(pathValue, "codex"));
    pathValue = await realpath(pathValue);
    scenarioPath = path.join(pathValue, "scenario.json");
    capturePath = path.join(pathValue, "capture.jsonl");
    vi.stubEnv("CODEX_HOME", sourceCodexHome);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  async function executor(scenario: Scenario = {}) {
    await writeFile(scenarioPath, JSON.stringify(scenario));
    return createManagedCodexAskExecutor({
      projectRoot,
      pathValue,
      privateRuntimeBase,
      requestTimeoutMs: 1_000,
      processShutdownTimeoutMs: 500,
    });
  }

  it("proves capability, returns a structured answer, and cleans both private roots", async () => {
    const value = await executor({ ephemeralDelete: true });
    const capability = await value.capability(new AbortController().signal);
    expect(capability).toMatchObject({
      kind: "managed-codex",
      state: "ready",
      readOnlyProven: true,
      requestedModelLabel: "gpt-test",
    });

    const first = await value.execute(askInput(), new AbortController().signal);
    const second = await value.execute(askInput(), new AbortController().signal);
    expect(first).toEqual(ANSWER);
    expect(second).toEqual(first);
    expect(value.effectiveModelLabel?.()).toBe("gpt-test");
    const records = (await readFile(capturePath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records.filter((record) => record.kind === "launch")).toHaveLength(3);
    expect(
      records.filter(
        (record) =>
          typeof record.message === "object" &&
          record.message !== null &&
          "method" in record.message &&
          record.message.method === "thread/start",
      ),
    ).toHaveLength(3);
    expect(JSON.stringify(records)).not.toContain('"method":"thread/resume"');
    expect(JSON.stringify(records)).toContain("spotpatch-ask-readonly");
    expect(JSON.stringify(records)).toContain('"outputSchema"');
    expect(JSON.stringify(records)).toContain('"effort":"low"');
    await expect(access(privateRuntimeBase)).resolves.toBeUndefined();
  });

  it("accepts a newer Codex version after its generated schema passes validation", async () => {
    await writeFile(
      path.join(pathValue, "codex-bin"),
      FAKE_ASK_APP_SERVER.replace("codex-cli 0.151.0", "codex-cli 0.153.2"),
    );
    const value = await executor();

    await expect(value.capability(new AbortController().signal)).resolves.toMatchObject(
      { state: "ready", readOnlyProven: true },
    );
  });

  it.each([
    [{ writeDiff: true }, "ASK_WRITE_ATTEMPTED"],
    [{ reverseRequest: "item/permissions/requestApproval" }, "ASK_WRITE_ATTEMPTED"],
    [{ duplicateFinal: true }, "ASK_ANSWER_INVALID"],
    [{ lateWriteDiff: true }, "ASK_WRITE_ATTEMPTED"],
    [{ turnStatus: "failed" }, "ASK_EXECUTOR_UNAVAILABLE"],
    [{ cleanupThreadMissing: true }, "ASK_EXECUTOR_UNAVAILABLE"],
    [{ crashOnTurn: true }, "ASK_EXECUTOR_UNAVAILABLE"],
  ] as const)("fails closed for scenario %#", async (scenario, code) => {
    const value = await executor(scenario);
    await expect(
      value.execute(askInput(), new AbortController().signal),
    ).rejects.toMatchObject({ code });
  });

  it.each([{ hookConfigured: true }, { mcpConfigured: true }])(
    "reports unavailable when preflight isolation is violated",
    async (scenario) => {
      const value = await executor(scenario);
      await expect(
        value.capability(new AbortController().signal),
      ).resolves.toMatchObject({ state: "unavailable", readOnlyProven: false });
    },
  );

  it("interrupts a cancelled turn and still runs cleanup", async () => {
    const value = await executor({ answerDelayMs: 5_000 });
    const controller = new AbortController();
    const running = value.execute(askInput(), controller.signal);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const capture = await readFile(capturePath, "utf8").catch(() => "");
      if (capture.includes('"method":"turn/start"')) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    controller.abort();
    await expect(running).rejects.toMatchObject({ code: "ASK_CANCELLED" });

    const records = (await readFile(capturePath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { message?: { method?: string } });
    expect(records.some((record) => record.message?.method === "turn/interrupt")).toBe(
      true,
    );
    expect(records.some((record) => record.message?.method === "thread/delete")).toBe(
      true,
    );
  });
});
