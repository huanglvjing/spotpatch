import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  CONTEXTUAL_ASK_SCHEMA_VERSION,
  spotAskTaskEnvelopeSchema,
  type AskJobCreateRequest,
} from "@spotpatch/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveOptions } from "../options.js";
import { createSourceRegistry } from "../registry/source-registry.js";
import { createWorkspaceActivityCoordinator } from "../workspace/activity-coordinator.js";
import { createConfiguredKeyAskExecutors } from "./configured-key-executors.js";
import { createContextualAskManager } from "./manager.js";

const runFile = promisify(execFile);
const roots: string[] = [];
const TEST_KEY = "integration-key-never-serialize";

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => rm(root, { recursive: true, force: true })),
  );
});

function toolTurn(
  responseId: string,
  callId: string,
  name: string,
  arguments_: Readonly<Record<string, unknown>>,
): Response {
  const item = {
    type: "function_call",
    call_id: callId,
    name,
    arguments: JSON.stringify(arguments_),
  };
  const events = [
    { type: "response.created", response: { id: responseId } },
    { type: "response.output_item.done", item },
    {
      type: "response.completed",
      response: { id: responseId, status: "completed", output: [item] },
    },
  ];
  return new Response(
    `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
}

function answer(handleId: string): Readonly<Record<string, unknown>> {
  return {
    blocks: [
      {
        kind: "paragraph",
        text: "这是 App 按钮组件。",
        citations: [{ handleId, startLine: 1, endLine: 1 }],
      },
    ],
    warnings: [],
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function providerPrompt(body: Readonly<Record<string, unknown>>): string {
  const input: unknown = body.input;
  if (!Array.isArray(input)) throw new Error("Expected Responses input.");
  const first: unknown = input[0];
  if (!isRecord(first) || typeof first.content !== "string") {
    throw new Error("Expected Provider user prompt.");
  }
  return first.content;
}

function firstSourceId(prompt: string): string {
  const parsed = JSON.parse(prompt) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Expected normalized source manifest.");
  }
  const manifest: unknown = parsed.sourceManifest;
  if (!isRecord(manifest) || !Array.isArray(manifest.sources)) {
    throw new Error("Expected normalized sources.");
  }
  const first: unknown = manifest.sources[0];
  if (!isRecord(first) || typeof first.sourceId !== "string") {
    throw new Error("Expected opaque source ID.");
  }
  return first.sourceId;
}

describe("Configured Key Ask integration", () => {
  it("answers through Manager while leaving the project root and Git state unchanged", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spotpatch-key-ask-"));
    roots.push(root);
    await mkdir(path.join(root, "src"));
    const sourcePath = path.join(root, "src/App.tsx");
    const source = "export const App = () => <button>Save</button>;\n";
    await writeFile(sourcePath, source);
    await runFile("git", ["init", "--quiet"], { cwd: root });
    await runFile("git", ["config", "user.email", "spotpatch@example.test"], {
      cwd: root,
    });
    await runFile("git", ["config", "user.name", "SpotPatch Test"], { cwd: root });
    await runFile("git", ["add", "src/App.tsx"], { cwd: root });
    await runFile("git", ["commit", "--quiet", "-m", "fixture"], { cwd: root });
    const beforeStatus = (
      await runFile("git", ["status", "--porcelain=v1"], {
        cwd: root,
      })
    ).stdout;
    const beforeContent = await readFile(sourcePath, "utf8");
    const requests: Readonly<Record<string, unknown>>[] = [];
    let turn = 0;
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation((_request, init) => {
        if (typeof init?.body !== "string") {
          return Promise.reject(new Error("Expected Provider request body."));
        }
        const body = JSON.parse(init.body) as Readonly<Record<string, unknown>>;
        requests.push(body);
        turn += 1;
        if (turn === 1) {
          return Promise.resolve(
            toolTurn("capability-read", "read-1", "read_source", {
              sourceId: "ask_capability_source",
              startLine: 1,
              endLine: 1,
            }),
          );
        }
        if (turn === 2) {
          return Promise.resolve(
            toolTurn(
              "capability-submit",
              "submit-1",
              "submit_answer",
              answer("ask_capability_source"),
            ),
          );
        }
        if (turn === 3) {
          return Promise.resolve(
            toolTurn(
              "answer-submit",
              "submit-2",
              "submit_answer",
              answer(firstSourceId(providerPrompt(body))),
            ),
          );
        }
        return Promise.reject(new Error("Unexpected Provider turn."));
      });
    const resolved = resolveOptions({
      contextualAsk: true,
      ai: {
        baseURL: "https://relay.example.test/v1",
        model: "provider-model",
        protocol: "responses",
      },
    });
    if (resolved.ai === false) throw new Error("Expected AI configuration.");
    const executors = createConfiguredKeyAskExecutors({
      ai: resolved.ai,
      environment: { SPOTPATCH_AI_API_KEY: TEST_KEY },
      fetch,
    });
    const executor = executors[0];
    if (executor === undefined) throw new Error("Expected Key executor.");
    const registry = createSourceRegistry();
    const fileId = registry.register(sourcePath);
    const manager = createContextualAskManager({
      coordinator: createWorkspaceActivityCoordinator(),
      enabled: true,
      executors,
      registry,
      root,
    });
    const envelope = spotAskTaskEnvelopeSchema.parse({
      schemaVersion: CONTEXTUAL_ASK_SCHEMA_VERSION,
      taskId: "task_integration",
      createdAt: "2026-09-01T00:00:00.000Z",
      task: { kind: "ask", question: "这是什么组件？" },
      selection: {
        schemaVersion: CONTEXTUAL_ASK_SCHEMA_VERSION,
        selectionId: "selection_integration",
        locale: "zh-CN",
        createdAt: "2026-09-01T00:00:00.000Z",
        targets: [
          {
            targetId: "target_integration",
            page: {
              url: "http://localhost:3000/",
              pathname: "/",
              title: "Fixture",
              viewportWidth: 1280,
              viewportHeight: 720,
              devicePixelRatio: 1,
            },
            source: {
              fileId,
              relativePath: "src/App.tsx",
              line: 1,
              column: 1,
              origin: "jsx-host",
              confidence: "exact",
            },
            react: { supported: true, componentStack: ["App"] },
            element: {
              tagName: "button",
              selector: "button",
              sanitizedHtml: "<button>Save</button>",
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
              excerpt: source.trimEnd(),
              boundary: "component",
            },
            warnings: [],
          },
        ],
      },
    });
    const request: AskJobCreateRequest = {
      schemaVersion: CONTEXTUAL_ASK_SCHEMA_VERSION,
      requestId: "request_integration",
      envelope,
      executorId: executor.executorId,
      providerDataConsent: true,
    };

    const created = await manager.create(request);
    const result = await manager.result(created.jobId);
    await manager.close();

    expect(result.snapshot.status).toBe("answered");
    expect(result.result?.sources[0]).toMatchObject({
      relativePath: "src/App.tsx",
      startLine: 1,
      endLine: 1,
    });
    expect(await readFile(sourcePath, "utf8")).toBe(beforeContent);
    expect(
      (await runFile("git", ["status", "--porcelain=v1"], { cwd: root })).stdout,
    ).toBe(beforeStatus);
    const serialized = JSON.stringify(requests);
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain(TEST_KEY);
    expect(serialized).not.toMatch(/apply_patch|replace_text|run_check/iu);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
