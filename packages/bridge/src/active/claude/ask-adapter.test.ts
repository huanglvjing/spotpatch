import { createHash } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ContextualAskExecutorInput } from "@spotpatch/agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createClaudeCodeAskExecutor } from "./ask-adapter.js";

interface Scenario {
  readonly version?: string;
  readonly loggedIn?: boolean;
  readonly initTools?: readonly string[];
  readonly initMcpServers?: readonly unknown[];
  readonly skipInit?: boolean;
  readonly toolUse?: string;
  readonly resultSubtype?: string;
  readonly structuredOutput?: unknown;
  readonly answerDelayMs?: number;
}

interface Capture {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly stdin: string;
  readonly disableAutoMemory: string | undefined;
}

const SOURCE = "export function Card() {\n  return <article>Card</article>;\n}";
const SOURCE_HASH = createHash("sha256").update(SOURCE).digest("hex");
const CITATION = Object.freeze({ handleId: "source_handle", startLine: 1, endLine: 3 });
const ANSWER = Object.freeze({
  blocks: [
    {
      kind: "paragraph",
      text: "Card renders an article.",
      listItems: [],
      code: null,
      language: null,
      citations: [CITATION],
    },
  ],
  warnings: [],
});

/** Stands in for the `claude` CLI: version, auth status, and one stream-json run. */
const FAKE_CLAUDE = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const scenario = JSON.parse(fs.readFileSync(path.join(__dirname, "scenario.json"), "utf8"));
const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.stdout.write((scenario.version ?? "2.1.283") + " (Claude Code)\n");
  process.exit(0);
}
if (args[0] === "auth" && args[1] === "status") {
  process.stdout.write(JSON.stringify({ loggedIn: scenario.loggedIn ?? true, authMethod: "claude.ai" }));
  process.exit(0);
}
let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { stdin += chunk; });
process.stdin.on("end", () => {
  fs.writeFileSync(path.join(__dirname, "capture.json"), JSON.stringify({
    args,
    cwd: process.cwd(),
    stdin,
    disableAutoMemory: process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY,
  }));
  const emit = (event) => process.stdout.write(JSON.stringify(event) + "\n");
  const finish = () => {
    if (!scenario.skipInit) {
      emit({
        type: "system",
        subtype: "init",
        model: "claude-sonnet-fixture",
        tools: scenario.initTools ?? ["StructuredOutput"],
        mcp_servers: scenario.initMcpServers ?? [],
      });
    }
    const toolName = scenario.toolUse ?? "StructuredOutput";
    emit({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: toolName, input: {} }] },
    });
    emit({
      type: "result",
      subtype: scenario.resultSubtype ?? "success",
      is_error: false,
      structured_output: scenario.structuredOutput ?? ${JSON.stringify(ANSWER)},
    });
    process.exit(0);
  };
  if (scenario.answerDelayMs) setTimeout(finish, scenario.answerDelayMs);
  else finish();
});
`;

function askInput(model?: string): ContextualAskExecutorInput {
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
    ...(model === undefined ? {} : { model }),
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
            page: {
              url: "http://127.0.0.1:3000/card",
              pathname: "/card",
              title: "Card",
              viewportWidth: 1200,
              viewportHeight: 800,
              devicePixelRatio: 2,
            },
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

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

const describeClaudeAsk = process.platform === "win32" ? describe.skip : describe;

describeClaudeAsk("Claude Code Ask executor", () => {
  let temporaryRoot = "";
  let projectRoot = "";
  let pathValue = "";

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "spotpatch-claude-ask-"));
    projectRoot = path.join(temporaryRoot, "project");
    pathValue = path.join(temporaryRoot, "bin");
    await Promise.all([mkdir(projectRoot), mkdir(pathValue)]);
    pathValue = await realpath(pathValue);
    await installFake(pathValue);
  });

  afterEach(async () => {
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  async function installFake(directory: string): Promise<void> {
    const command = path.join(directory, "claude");
    await writeFile(command, FAKE_CLAUDE);
    await chmod(command, 0o700);
  }

  async function executor(scenario: Scenario = {}, now?: () => number) {
    await writeFile(path.join(pathValue, "scenario.json"), JSON.stringify(scenario));
    return createClaudeCodeAskExecutor({
      projectRoot,
      pathValue,
      ...(now === undefined ? {} : { dependencies: { now } }),
    });
  }

  async function capture(): Promise<Capture> {
    return JSON.parse(
      await readFile(path.join(pathValue, "capture.json"), "utf8"),
    ) as Capture;
  }

  it("reports a ready, consent-gated capability without a model call", async () => {
    const value = await executor();
    await expect(value.capability(new AbortController().signal)).resolves.toMatchObject(
      {
        executorId: "ask_claude_code_v1",
        kind: "claude-code",
        label: "Claude Code",
        models: ["sonnet", "opus", "haiku"],
        requestedModelLabel: "sonnet",
        state: "ready",
        readOnlyProven: true,
        providerDataConsentRequired: true,
      },
    );
    await expect(access(path.join(pathValue, "capture.json"))).rejects.toThrow();
  });

  it("caches the probe and re-probes after the cache expires", async () => {
    let time = 0;
    const value = await executor({}, () => time);
    const signal = new AbortController().signal;
    await expect(value.capability(signal)).resolves.toMatchObject({ state: "ready" });
    await writeFile(
      path.join(pathValue, "scenario.json"),
      JSON.stringify({ loggedIn: false }),
    );
    await expect(value.capability(signal)).resolves.toMatchObject({ state: "ready" });
    time = 5 * 60_000 + 1;
    await expect(value.capability(signal)).resolves.toMatchObject({
      state: "unavailable",
      readOnlyProven: false,
      errorCode: "ASK_EXECUTOR_UNAVAILABLE",
    });
  });

  it.each([
    [{ loggedIn: false }, "ASK_EXECUTOR_UNAVAILABLE"],
    [{ version: "2.1.282" }, "ASK_PROTOCOL_INCOMPATIBLE"],
  ] as const)("reports %j as unavailable with %s", async (scenario, errorCode) => {
    const value = await executor(scenario);
    const capability = await value.capability(new AbortController().signal);
    expect(capability).toMatchObject({ state: "unavailable", errorCode });
    expect(capability).not.toHaveProperty("models");
  });

  it("refuses a claude executable that resolves inside the project", async () => {
    pathValue = path.join(await realpath(projectRoot), "bin");
    await mkdir(pathValue);
    await installFake(pathValue);
    const value = await executor();
    await expect(value.capability(new AbortController().signal)).resolves.toMatchObject(
      {
        state: "unavailable",
        errorCode: "ASK_EXECUTOR_UNAVAILABLE",
      },
    );
  });

  it("answers from embedded sources in a tool-less, disposable session", async () => {
    const value = await executor();
    await expect(
      value.execute(askInput("opus"), new AbortController().signal),
    ).resolves.toEqual({
      blocks: [
        { kind: "paragraph", text: "Card renders an article.", citations: [CITATION] },
      ],
      warnings: [],
    });
    const run = await capture();
    expect(run.args).toEqual(
      expect.arrayContaining([
        "--print",
        "--tools",
        "",
        "--strict-mcp-config",
        "--setting-sources",
        "--disable-slash-commands",
        "--no-session-persistence",
        "--json-schema",
      ]),
    );
    expect(run.args.slice(-2)).toEqual(["--model", "opus"]);
    expect(run.disableAutoMemory).toBe("1");
    expect(run.stdin).toContain("What is this component?");
    expect(run.stdin).toContain(
      '<source handleId="source_handle" path="src/Card.tsx">',
    );
    expect(run.stdin).toContain("2|   return <article>Card</article>;");
    expect(path.basename(run.cwd)).toMatch(/^spotpatch-ask-claude-/u);
    await expect(access(run.cwd)).rejects.toThrow();
    expect(value.effectiveModelLabel?.()).toBe("claude-sonnet-fixture");
  });

  it("defaults to sonnet and rejects models outside the catalog", async () => {
    const value = await executor();
    await value.execute(askInput(), new AbortController().signal);
    expect((await capture()).args.slice(-2)).toEqual(["--model", "sonnet"]);
    await expectCode(
      value.execute(askInput("claude-unknown"), new AbortController().signal),
      "ASK_EXECUTOR_UNAVAILABLE",
    );
  });

  it.each([
    [{ initTools: ["StructuredOutput", "Read"] }, "ASK_WRITE_ATTEMPTED"],
    [
      { initMcpServers: [{ name: "fixture", status: "connected" }] },
      "ASK_WRITE_ATTEMPTED",
    ],
    [{ toolUse: "Bash" }, "ASK_WRITE_ATTEMPTED"],
    [{ skipInit: true }, "ASK_PROTOCOL_INCOMPATIBLE"],
    [{ resultSubtype: "error_max_turns" }, "ASK_EXECUTOR_UNAVAILABLE"],
    [{ structuredOutput: { blocks: "invalid" } }, "ASK_ANSWER_INVALID"],
  ] as const)("fails the run for %j with %s", async (scenario, code) => {
    const value = await executor(scenario);
    await expectCode(value.execute(askInput(), new AbortController().signal), code);
    await expect(access((await capture()).cwd)).rejects.toThrow();
  });

  it("cancels a running session and removes its workspace", async () => {
    const value = await executor({ answerDelayMs: 5_000 });
    const controller = new AbortController();
    const running = value.execute(askInput(), controller.signal);
    await expect
      .poll(() => access(path.join(pathValue, "capture.json")))
      .toBeUndefined();
    controller.abort(new Error("fixture cancel"));
    await expectCode(running, "ASK_CANCELLED");
    await expect(access((await capture()).cwd)).rejects.toThrow();
  });
});
