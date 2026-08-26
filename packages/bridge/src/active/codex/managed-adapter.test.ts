import {
  chmod,
  lstat,
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

import type {
  ManagedExecutionPort,
  ManagedExecutionResult,
  PreparedManagedTask,
} from "@spotpatch/agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AgentDeliveryLifecycle,
  AgentDeliveryPhase,
  AgentHandoffSnapshot,
} from "../types.js";
import type { ManagedThreadCleanupJournal } from "../../supervisor/thread-cleanup-journal.js";
import { connectManagedCodexAppServer } from "./managed-adapter.js";

interface Scenario {
  readonly hookConfigured?: boolean;
  readonly mcpConfigured?: boolean;
  readonly noModels?: boolean;
  readonly outOfOrderTerminal?: boolean;
  readonly signedOut?: boolean;
  readonly turnStatus?: "completed" | "failed" | "interrupted";
  readonly turnStartRejected?: boolean;
  readonly wrongThreadNotification?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const FAKE_MANAGED_APP_SERVER = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

if (process.argv[2] === "--version") {
  process.stdout.write("codex-cli 0.149.1\n");
  process.exit(0);
}
if (process.argv[process.argv.length - 1] !== "app-server") process.exit(64);

const scenario = JSON.parse(fs.readFileSync(path.join(__dirname, "scenario.json"), "utf8"));
const capturePath = path.join(__dirname, "capture.jsonl");
const capture = (value) => fs.appendFileSync(capturePath, JSON.stringify(value) + "\n");
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
capture({ kind: "launch", argv: process.argv.slice(2), cwd: process.cwd(), env: {
  codexHome: process.env.CODEX_HOME,
  home: process.env.HOME,
  noProxy: process.env.NO_PROXY,
  secret: process.env.SPOTPATCH_TEST_SECRET,
  userProfile: process.env.USERPROFILE,
} });

let threadIndex = 0;
let turnIndex = 0;
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  const message = JSON.parse(line);
  capture({ kind: "input", message });
  if (message.method === "initialize") {
    send({ id: message.id, result: {
      userAgent: "codex_cli_rs/0.149.1",
      codexHome: process.env.CODEX_HOME,
      platformFamily: "unix",
      platformOs: process.platform,
    } });
    return;
  }
  if (message.method === "initialized") return;
  if (message.method === "account/read") {
    send({ id: message.id, result: {
      account: scenario.signedOut ? null : { type: "apiKey" },
      requiresOpenaiAuth: true,
    } });
    return;
  }
  if (message.method === "model/list") {
    send({ id: message.id, result: {
      data: scenario.noModels ? [] : [{ model: "gpt-test", isDefault: true }],
      nextCursor: null,
    } });
    return;
  }
  if (message.method === "configRequirements/read") {
    send({ id: message.id, result: { requirements: null } });
    return;
  }
  if (message.method === "thread/start") {
    threadIndex += 1;
    send({ id: message.id, result: {
      thread: { id: "thread-" + threadIndex, ephemeral: false, cwd: message.params.cwd },
      cwd: message.params.cwd,
      runtimeWorkspaceRoots: message.params.runtimeWorkspaceRoots,
      approvalPolicy: message.params.approvalPolicy,
      activePermissionProfile: { id: message.params.permissions, extends: null },
    } });
    return;
  }
  if (message.method === "mcpServerStatus/list") {
    send({ id: message.id, result: {
      data: scenario.mcpConfigured ? [{ name: "unsafe" }] : [],
      nextCursor: null,
    } });
    return;
  }
  if (message.method === "hooks/list") {
    send({ id: message.id, result: {
      data: message.params.cwds.map((cwd) => ({
        cwd,
        hooks: scenario.hookConfigured ? [{ enabled: true }] : [],
        warnings: [],
        errors: [],
      })),
    } });
    return;
  }
  if (message.method === "thread/delete") {
    send({ id: message.id, result: {} });
    return;
  }
  if (message.method === "turn/interrupt") {
    send({ id: message.id, result: {} });
    return;
  }
  if (message.method !== "turn/start") return;
  if (scenario.turnStartRejected) {
    send({ id: message.id, error: { code: -32602, message: "Invalid params" } });
    return;
  }
  turnIndex += 1;
  const turnId = "turn-" + turnIndex;
  const threadId = message.params.threadId;
  if (!scenario.outOfOrderTerminal) {
    send({ method: "turn/started", params: {
      threadId,
      turn: { id: turnId, status: "inProgress" },
    } });
  }
  send({ id: message.id, result: { turn: { id: turnId, status: "inProgress" } } });
  if (scenario.outOfOrderTerminal) {
    setTimeout(() => send({ method: "turn/completed", params: {
      threadId,
      turn: { id: turnId, status: scenario.turnStatus || "completed" },
    } }), 5);
    setTimeout(() => send({ method: "turn/started", params: {
      threadId,
      turn: { id: turnId, status: "inProgress" },
    } }), 10);
  } else if (scenario.wrongThreadNotification) {
    setTimeout(() => send({ method: "turn/completed", params: {
      threadId: "unrelated-thread",
      turn: { id: turnId, status: "completed" },
    } }), 5);
    setTimeout(() => send({ method: "turn/completed", params: {
      threadId,
      turn: { id: turnId, status: scenario.turnStatus || "completed" },
    } }), 10);
  } else {
    send({ method: "turn/completed", params: {
      threadId,
      turn: { id: turnId, status: scenario.turnStatus || "completed" },
    } });
  }
});
`;

function handoff(revision: number): AgentHandoffSnapshot {
  const page = {
    url: "http://127.0.0.1:3000/",
    pathname: "/",
    title: "Fixture",
    viewportWidth: 1_440,
    viewportHeight: 900,
    devicePixelRatio: 2,
  };
  return {
    schemaVersion: 1,
    cursor: `cursor_${String(revision).padStart(22, "0")}`,
    session: { id: "0123456789abcdef012345", framework: "next" },
    revision,
    publishedAt: "2026-08-25T00:00:00.000Z",
    expiresAt: "2026-08-25T00:15:00.000Z",
    annotation: {
      schemaVersion: 3,
      id: "managed-codex-test",
      locale: "en-US",
      page,
      targets: [
        {
          instruction: "Change the selected label.",
          source: {
            relativePath: "src/App.tsx",
            line: 1,
            column: 1,
            origin: "jsx-host",
            confidence: "exact",
          },
          react: { supported: true, componentStack: [] },
          element: {
            tagName: "button",
            selector: "button",
            sanitizedHtml: "<button>Before</button>",
            rect: { x: 0, y: 0, width: 100, height: 40 },
          },
          styles: {
            classNames: [],
            matchedRules: [],
            computed: {},
            warnings: [],
          },
          code: {
            relativePath: "src/App.tsx",
            language: "tsx",
            startLine: 1,
            endLine: 1,
            excerpt: "export const App = () => <button>Before</button>;",
            boundary: "component",
          },
          warnings: [],
        },
      ],
      createdAt: "2026-08-25T00:00:00.000Z",
    },
  };
}

function lifecycle(): Readonly<{
  phases: AgentDeliveryPhase[];
  value: AgentDeliveryLifecycle;
}> {
  const phases: AgentDeliveryPhase[] = [];
  return {
    phases,
    value: {
      report(phase) {
        phases.push(phase);
        return Promise.resolve();
      },
    },
  };
}

function execution(root: string): Readonly<{
  port: ManagedExecutionPort;
  results: ManagedExecutionResult[];
}> {
  const tasks = new Map<number, PreparedManagedTask>();
  const results: ManagedExecutionResult[] = [];
  return {
    results,
    port: {
      prepare(input) {
        const task = {
          kind: "prepared-managed-task",
          revision: input.revision,
          workspaceRoot: root,
          prompt: `Managed revision ${String(input.revision)}`,
        } as const;
        tasks.set(input.revision, task);
        return Promise.resolve(task);
      },
      auditAndApply(task, _signal, onPhase) {
        if (tasks.get(task.revision) !== task) throw new Error("Unknown task.");
        onPhase?.("validating");
        const result = {
          revision: task.revision,
          diff: "diff --git a/src/App.tsx b/src/App.tsx\n",
          files: [],
          checks: [],
          validationOutcome: "not-configured",
          applied: false,
          expiresAt: "2026-08-25T00:30:00.000Z",
          timings: {
            preparing: 1,
            agent: 2,
            auditing: 3,
            validating: 4,
            total: 10,
          },
        } as const;
        results.push(result);
        return Promise.resolve(result);
      },
      dispose: () => Promise.resolve(),
    },
  };
}

function cleanupJournal(): ManagedThreadCleanupJournal {
  const threads = new Map<string, string>();
  return {
    list() {
      return Promise.resolve(
        [...threads].map(([threadId, createdAt]) => ({ threadId, createdAt })),
      );
    },
    add(threadId) {
      threads.set(threadId, "2026-08-25T00:00:00.000Z");
      return Promise.resolve();
    },
    remove(threadId) {
      threads.delete(threadId);
      return Promise.resolve();
    },
  };
}

const describeManaged = process.platform === "win32" ? describe.skip : describe;

describeManaged("managed Codex App Server adapter", () => {
  let temporaryRoot = "";
  let projectRoot = "";
  let workspaceRoot = "";
  let pathValue = "";
  let privateRuntimeBase = "";
  let sourceCodexHome = "";
  let scenarioPath = "";
  let capturePath = "";

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "spotpatch-managed-codex-"));
    projectRoot = path.join(temporaryRoot, "project");
    workspaceRoot = path.join(temporaryRoot, "snapshot");
    pathValue = path.join(temporaryRoot, "bin");
    privateRuntimeBase = path.join(temporaryRoot, "private-runtime");
    sourceCodexHome = path.join(temporaryRoot, "source-codex-home");
    await Promise.all([
      mkdir(projectRoot),
      mkdir(workspaceRoot),
      mkdir(pathValue),
      mkdir(privateRuntimeBase, { mode: 0o700 }),
      mkdir(sourceCodexHome, { mode: 0o700 }),
    ]);
    await writeFile(
      path.join(sourceCodexHome, "auth.json"),
      '{"synthetic":"credential"}\n',
      { mode: 0o600 },
    );
    const target = path.join(pathValue, "codex-bin");
    await writeFile(target, FAKE_MANAGED_APP_SERVER);
    await chmod(target, 0o700);
    await symlink(target, path.join(pathValue, "codex"));
    pathValue = await realpath(pathValue);
    scenarioPath = path.join(pathValue, "scenario.json");
    capturePath = path.join(pathValue, "capture.jsonl");
    vi.stubEnv("SPOTPATCH_TEST_SECRET", "must-not-be-forwarded");
    vi.stubEnv("CODEX_HOME", sourceCodexHome);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  async function connect(
    scenario: Scenario = {},
    journal: ManagedThreadCleanupJournal = cleanupJournal(),
  ) {
    await writeFile(scenarioPath, JSON.stringify(scenario));
    const managed = execution(workspaceRoot);
    const events: unknown[] = [];
    const connection = await connectManagedCodexAppServer({
      bridgeAdapter: "next",
      cleanupJournal: journal,
      execution: managed.port,
      onEvent: (event) => events.push(event),
      pathValue,
      privateRuntimeBase,
      projectRoot,
      requestTimeoutMs: 1_000,
      sessionId: "0123456789abcdef012345",
      signal: new AbortController().signal,
      terminalTimeoutMs: 2_000,
      runtimeKey: "a".repeat(64),
    });
    return { connection, events, managed };
  }

  it("uses isolated process config, per-revision threads, and a fixed permission profile", async () => {
    const { connection, events, managed } = await connect();
    const first = lifecycle();
    const second = lifecycle();

    try {
      await connection.adapter.deliver(
        handoff(1),
        first.value,
        new AbortController().signal,
      );
      await connection.adapter.deliver(
        handoff(2),
        second.value,
        new AbortController().signal,
      );
    } finally {
      await connection.adapter.close();
    }

    expect(connection).toMatchObject({
      authReadiness: "authenticated",
      requestedModel: "gpt-test",
      effectiveModel: "gpt-test",
    });
    expect(first.phases).toEqual(["dispatched", "working", "completed"]);
    expect(second.phases).toEqual(["dispatched", "working", "completed"]);
    expect(managed.results).toHaveLength(2);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "phase", phase: "preparing" }),
        expect.objectContaining({ type: "phase", phase: "running" }),
        expect.objectContaining({ type: "phase", phase: "auditing" }),
        expect.objectContaining({ type: "result" }),
      ]),
    );
    const records = (await readFile(capturePath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const launch = records[0] as {
      argv: string[];
      cwd: string;
      env: {
        codexHome?: string;
        home?: string;
        noProxy?: string;
        secret?: string;
        userProfile?: string;
      };
    };
    expect(launch.cwd).toBe(pathValue);
    expect(launch.argv).toContain("features.hooks=false");
    expect(launch.argv).toContain("features.plugins=false");
    expect(launch.argv).toContain("mcp_servers={}");
    expect(launch.argv).toContainEqual(
      expect.stringContaining("shell_environment_policy="),
    );
    expect(launch.env.codexHome).not.toBe(sourceCodexHome);
    expect(launch.env.home).toBe(launch.env.codexHome);
    expect(launch.env.userProfile).toBe(launch.env.codexHome);
    expect(launch.env.noProxy).toContain("127.0.0.1");
    expect(launch.env.secret).toBeUndefined();
    if (launch.env.codexHome === undefined) {
      throw new Error("The managed CODEX_HOME was not captured.");
    }
    expect(
      (await lstat(path.join(launch.env.codexHome, "auth.json"))).isSymbolicLink(),
    ).toBe(true);
    await expect(realpath(path.join(launch.env.codexHome, "auth.json"))).resolves.toBe(
      await realpath(path.join(sourceCodexHome, "auth.json")),
    );
    const messages = records.flatMap((record) => {
      const message = record.message;
      return isRecord(message) ? [message] : [];
    });
    const threads = messages.filter((message) => message.method === "thread/start");
    const turns = messages.filter((message) => message.method === "turn/start");
    expect(threads).toHaveLength(2);
    expect(threads[0]).toMatchObject({
      params: {
        config: {
          default_permissions: "spotpatch-managed",
          permissions: {
            "spotpatch-managed": {
              filesystem: {
                ":root": "deny",
                ":minimal": "read",
                ":workspace_roots": { ".": "write" },
              },
              network: { enabled: false },
            },
          },
          shell_environment_policy: {
            inherit: "all",
            ignore_default_excludes: false,
          },
        },
      },
    });
    expect(
      messages.filter((message) => message.method === "thread/delete"),
    ).toHaveLength(2);
    expect(turns).toHaveLength(2);
    expect(turns[0]?.params).toMatchObject({
      approvalPolicy: "never",
      cwd: workspaceRoot,
      threadId: "thread-1",
    });
    expect((turns[0]?.params as Record<string, unknown>).permissions).toBeUndefined();
    expect((turns[0]?.params as Record<string, unknown>).sandboxPolicy).toBeUndefined();
    expect(JSON.stringify(turns)).not.toContain(projectRoot);
  });

  it("fails closed before a turn when inherited MCP configuration remains", async () => {
    const { connection, events, managed } = await connect({ mcpConfigured: true });
    const delivery = lifecycle();

    try {
      await connection.adapter.deliver(
        handoff(1),
        delivery.value,
        new AbortController().signal,
      );
    } finally {
      await connection.adapter.close();
    }

    expect(delivery.phases).toEqual(["failed"]);
    expect(managed.results).toHaveLength(0);
    expect(events).toContainEqual({
      type: "failure",
      revision: 1,
      reason: "config-isolation",
    });
  });

  it("treats an explicit turn rejection as a proved protocol failure", async () => {
    const { connection, events, managed } = await connect({
      turnStartRejected: true,
    });
    const delivery = lifecycle();

    try {
      await connection.adapter.deliver(
        handoff(1),
        delivery.value,
        new AbortController().signal,
      );
    } finally {
      await connection.adapter.close();
    }

    expect(delivery.phases).toEqual(["failed"]);
    expect(managed.results).toHaveLength(0);
    expect(events).toContainEqual({
      type: "failure",
      revision: 1,
      reason: "protocol",
    });
  });

  it("fails closed before a turn when an executable hook remains", async () => {
    const { connection, events, managed } = await connect({ hookConfigured: true });
    const delivery = lifecycle();

    try {
      await connection.adapter.deliver(
        handoff(1),
        delivery.value,
        new AbortController().signal,
      );
    } finally {
      await connection.adapter.close();
    }

    expect(delivery.phases).toEqual(["failed"]);
    expect(managed.results).toHaveLength(0);
    expect(events).toContainEqual({
      type: "failure",
      revision: 1,
      reason: "config-isolation",
    });
  });

  it("deletes cleanup-journal threads before accepting managed work", async () => {
    const journal = cleanupJournal();
    await journal.add("thread-from-prior-process");
    const { connection } = await connect({}, journal);

    await connection.adapter.close();

    await expect(journal.list()).resolves.toEqual([]);
    const records = (await readFile(capturePath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(
      records.some((record) => {
        const message = record.message;
        return (
          typeof message === "object" &&
          message !== null &&
          "method" in message &&
          message.method === "thread/delete"
        );
      }),
    ).toBe(true);
  });

  it.each([
    ["ignores notifications for another thread", { wrongThreadNotification: true }],
    [
      "waits for started evidence before a terminal event",
      { outOfOrderTerminal: true },
    ],
  ])("%s", async (_name, scenario) => {
    const { connection, managed } = await connect(scenario);
    const delivery = lifecycle();

    try {
      await connection.adapter.deliver(
        handoff(1),
        delivery.value,
        new AbortController().signal,
      );
    } finally {
      await connection.adapter.close();
    }

    expect(delivery.phases).toEqual(["dispatched", "working", "completed"]);
    expect(managed.results).toHaveLength(1);
  });

  it("rejects a signed-out account during preflight", async () => {
    await writeFile(scenarioPath, JSON.stringify({ signedOut: true }));
    const managed = execution(workspaceRoot);

    await expect(
      connectManagedCodexAppServer({
        bridgeAdapter: "next",
        cleanupJournal: cleanupJournal(),
        execution: managed.port,
        onEvent: () => undefined,
        pathValue,
        privateRuntimeBase,
        projectRoot,
        requestTimeoutMs: 1_000,
        sessionId: "0123456789abcdef012345",
        signal: new AbortController().signal,
        runtimeKey: "a".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "CODEX_AUTH_REQUIRED" });
  });

  it("reports an unavailable model separately from protocol incompatibility", async () => {
    await writeFile(scenarioPath, JSON.stringify({ noModels: true }));
    const managed = execution(workspaceRoot);

    await expect(
      connectManagedCodexAppServer({
        bridgeAdapter: "next",
        cleanupJournal: cleanupJournal(),
        execution: managed.port,
        onEvent: () => undefined,
        pathValue,
        privateRuntimeBase,
        projectRoot,
        requestTimeoutMs: 1_000,
        sessionId: "0123456789abcdef012345",
        signal: new AbortController().signal,
        runtimeKey: "a".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "CODEX_MODEL_UNAVAILABLE" });
  });
});
