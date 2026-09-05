import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  ContextualAskExecutorError,
  type ContextualAskExecutor,
} from "@spotpatch/agent";
import {
  CONTEXTUAL_ASK_SCHEMA_VERSION,
  CONTEXTUAL_ASK_LIMITS,
  spotAskTaskEnvelopeSchema,
  type AskJobCreateRequest,
  type SpotAskTaskEnvelope,
} from "@spotpatch/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSourceRegistry } from "../registry/source-registry.js";
import { createWorkspaceActivityCoordinator } from "../workspace/activity-coordinator.js";
import { createContextualAskManager } from "./manager.js";
import type { CapturedAskReadSnapshot } from "./read-snapshot.js";

const roots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map(async (root) => rm(root, { recursive: true })));
});

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "spotpatch-manager-"));
  roots.push(root);
  await mkdir(path.join(root, "src"));
  const sourcePath = path.join(root, "src/App.tsx");
  await writeFile(sourcePath, "export const App = () => <button>Save</button>;\n");
  const registry = createSourceRegistry();
  const fileId = registry.register(sourcePath);
  return { root, registry, fileId };
}

function envelope(
  fileId: string,
  question = "这个组件是什么？",
  reactSource?: Readonly<{ componentSourceId: string; sourceVersion: string }>,
): SpotAskTaskEnvelope {
  return spotAskTaskEnvelopeSchema.parse({
    schemaVersion: 1,
    taskId: "task-1",
    createdAt: "2026-09-01T00:00:00.000Z",
    task: { kind: "ask", question },
    selection: {
      schemaVersion: 1,
      selectionId: "selection-1",
      locale: "zh-CN",
      createdAt: "2026-09-01T00:00:00.000Z",
      targets: [
        {
          targetId: "target-1",
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
            origin: "jsx-host",
            confidence: "exact",
          },
          react: {
            supported: true,
            componentStack: ["App"],
            ...(reactSource ?? {}),
          },
          element: {
            tagName: "button",
            selector: "button",
            sanitizedHtml: "<button>Save</button>",
            rect: { x: 0, y: 0, width: 100, height: 40 },
          },
          styles: { classNames: [], matchedRules: [], computed: {}, warnings: [] },
          warnings: [],
        },
      ],
    },
  });
}

function request(fileId: string, requestId = "request-1"): AskJobCreateRequest {
  return {
    schemaVersion: CONTEXTUAL_ASK_SCHEMA_VERSION,
    requestId,
    envelope: envelope(fileId),
    executorId: "fake-key",
    providerDataConsent: true,
  };
}

function fakeExecutor(
  execute: ContextualAskExecutor["execute"],
): ContextualAskExecutor {
  return {
    executorId: "fake-key",
    capability() {
      return Promise.resolve({
        executorId: "fake-key",
        kind: "configured-key",
        label: "Fake Key",
        requestedModelLabel: "fake-model",
        effectiveModelLabel: "fake-model",
        state: "ready",
        providerDataConsentRequired: true,
        readOnlyProven: true,
      });
    },
    execute,
  };
}

describe("ContextualAskManager", () => {
  it("validates the model allowlist, forwards selection and fingerprints it", async () => {
    const { root, registry, fileId } = await setup();
    const execute = vi.fn<ContextualAskExecutor["execute"]>(() =>
      Promise.resolve({
        blocks: [{ kind: "paragraph", text: "Answer", citations: [] }],
        warnings: [{ code: "insufficient-evidence" }],
      }),
    );
    const base = fakeExecutor(execute);
    const manager = createContextualAskManager({
      enabled: true,
      root,
      registry,
      coordinator: createWorkspaceActivityCoordinator(),
      executors: [
        {
          ...base,
          capability: async (signal) => ({
            ...(await base.capability(signal)),
            models: ["fake-model", "alternate-model"],
          }),
        },
      ],
    });
    try {
      await expect(
        manager.create({ ...request(fileId), model: "unknown" }),
      ).rejects.toMatchObject({ code: "ASK_EXECUTOR_UNAVAILABLE" });
      const created = await manager.create({
        ...request(fileId),
        model: "alternate-model",
      });
      expect(created.executor.modelLabel).toBe("alternate-model");
      await manager.result(created.jobId);
      expect(execute.mock.calls[0]?.[0].model).toBe("alternate-model");
      await expect(
        manager.create({ ...request(fileId), model: "fake-model" }),
      ).rejects.toMatchObject({ code: "ASK_IDEMPOTENCY_CONFLICT" });
    } finally {
      await manager.close();
    }
  });
  it("keeps healthy executors available when another capability probe fails", async () => {
    const { root, registry } = await setup();
    const healthy = fakeExecutor(() =>
      Promise.resolve({
        blocks: [{ kind: "paragraph", text: "unused", citations: [] }],
        warnings: [{ code: "insufficient-evidence" }],
      }),
    );
    const failing: ContextualAskExecutor = {
      executorId: "failing-executor",
      capability: () => Promise.reject(new Error("probe failed")),
      execute: () => Promise.reject(new Error("must not execute")),
    };
    const manager = createContextualAskManager({
      enabled: true,
      executors: [failing, healthy],
      coordinator: createWorkspaceActivityCoordinator(),
      registry,
      root,
    });

    await expect(
      manager.capability(new AbortController().signal),
    ).resolves.toMatchObject({
      enabled: true,
      executors: [{ executorId: "fake-key", state: "ready" }],
    });
    await manager.close();
  });

  it("preserves stable executor security errors in the public job result", async () => {
    const { root, registry, fileId } = await setup();
    const manager = createContextualAskManager({
      enabled: true,
      executors: [
        fakeExecutor(() => {
          throw new ContextualAskExecutorError("ASK_WRITE_ATTEMPTED");
        }),
      ],
      coordinator: createWorkspaceActivityCoordinator(),
      registry,
      root,
    });

    const created = await manager.create(request(fileId));
    await expect(manager.result(created.jobId)).resolves.toMatchObject({
      snapshot: { status: "failed", errorCode: "ASK_WRITE_ATTEMPTED" },
    });
    await manager.close();
  });

  it("projects handle citations and preserves idempotent single-turn results", async () => {
    const { root, registry, fileId } = await setup();
    const execute = vi.fn<ContextualAskExecutor["execute"]>((input) => {
      const source = input.grant.sources[0];
      expect(source).toBeDefined();
      expect(input.snapshot.read(source?.handleId ?? "").content).toContain("button");
      return Promise.resolve({
        blocks: [
          {
            kind: "paragraph",
            text: "这是一个保存按钮组件。",
            citations: [{ handleId: source?.handleId ?? "", startLine: 1, endLine: 1 }],
          },
        ],
        warnings: [],
      });
    });
    let id = 0;
    const manager = createContextualAskManager({
      enabled: true,
      executors: [fakeExecutor(execute)],
      coordinator: createWorkspaceActivityCoordinator(),
      registry,
      root,
      dependencies: { createId: () => `opaque-${String(++id)}` },
    });
    const first = await manager.create(request(fileId));
    const result = await manager.result(first.jobId);
    expect(result.snapshot.status).toBe("answered");
    expect(result.result?.sources).toHaveLength(1);
    expect(result.result?.sources[0]).toMatchObject({
      relativePath: "src/App.tsx",
      startLine: 1,
      endLine: 1,
    });
    expect(JSON.stringify(result)).not.toContain(root);
    const replay = await manager.create(request(fileId));
    expect(replay.jobId).toBe(first.jobId);
    expect(execute).toHaveBeenCalledTimes(1);
    const replacement = await manager.create(request(fileId, "request-replacement"));
    await manager.result(replacement.jobId);
    await expect(manager.result(first.jobId)).rejects.toMatchObject({
      code: "ASK_RESULT_EXPIRED",
    });
    expect(execute).toHaveBeenCalledTimes(2);
    await manager.close();
  });

  it("rejects idempotency conflicts and concurrent workspace tasks", async () => {
    const { root, registry, fileId } = await setup();
    let release: (() => void) | undefined;
    const execute = vi.fn<ContextualAskExecutor["execute"]>(
      async (input, signal) =>
        new Promise((resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              reject(new Error("aborted", { cause: signal.reason }));
            },
            { once: true },
          );
          release = () => {
            resolve({
              blocks: [{ kind: "paragraph", text: "不足", citations: [] }],
              warnings: [{ code: "insufficient-evidence" }],
            });
          };
        }),
    );
    const manager = createContextualAskManager({
      enabled: true,
      executors: [fakeExecutor(execute)],
      coordinator: createWorkspaceActivityCoordinator(),
      registry,
      root,
    });
    const first = await manager.create(request(fileId));
    await expect(
      manager.create({
        ...request(fileId),
        envelope: envelope(fileId, "另一个问题"),
      }),
    ).rejects.toMatchObject({ code: "ASK_IDEMPOTENCY_CONFLICT" });
    await expect(manager.create(request(fileId, "request-2"))).rejects.toMatchObject({
      code: "ASK_BUSY",
    });
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });
    release?.();
    await manager.result(first.jobId);
    await manager.close();
  });

  it("coalesces concurrent identical request IDs before capability resolves", async () => {
    const { root, registry, fileId } = await setup();
    let resolveCapability:
      | ((value: Awaited<ReturnType<ContextualAskExecutor["capability"]>>) => void)
      | undefined;
    const capability = vi.fn<ContextualAskExecutor["capability"]>(
      () =>
        new Promise((resolve) => {
          resolveCapability = resolve;
        }),
    );
    const executor: ContextualAskExecutor = {
      executorId: "fake-key",
      capability,
      execute: () =>
        Promise.resolve({
          blocks: [{ kind: "paragraph", text: "不足", citations: [] }],
          warnings: [{ code: "insufficient-evidence" }],
        }),
    };
    const manager = createContextualAskManager({
      enabled: true,
      executors: [executor],
      coordinator: createWorkspaceActivityCoordinator(),
      registry,
      root,
    });
    const first = manager.create(request(fileId));
    const second = manager.create(request(fileId));
    resolveCapability?.({
      executorId: "fake-key",
      kind: "configured-key",
      label: "Fake Key",
      requestedModelLabel: "fake-model",
      effectiveModelLabel: "fake-model",
      state: "ready",
      providerDataConsentRequired: true,
      readOnlyProven: true,
    });
    const [firstSnapshot, secondSnapshot] = await Promise.all([first, second]);
    expect(secondSnapshot.jobId).toBe(firstSnapshot.jobId);
    expect(capability).toHaveBeenCalledTimes(1);
    await manager.result(firstSnapshot.jobId);
    await manager.close();
  });

  it("cancels a running executor and ignores its missing result", async () => {
    const { root, registry, fileId } = await setup();
    let deliverLateAnswer: (() => void) | undefined;
    const execute = vi.fn<ContextualAskExecutor["execute"]>(
      () =>
        new Promise((resolve) => {
          deliverLateAnswer = () => {
            resolve({
              blocks: [{ kind: "paragraph", text: "迟到答案", citations: [] }],
              warnings: [{ code: "insufficient-evidence" }],
            });
          };
        }),
    );
    const manager = createContextualAskManager({
      enabled: true,
      executors: [fakeExecutor(execute)],
      coordinator: createWorkspaceActivityCoordinator(),
      registry,
      root,
    });
    const created = await manager.create(request(fileId));
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });
    manager.cancel(created.jobId);
    const result = await manager.result(created.jobId);
    deliverLateAnswer?.();
    await Promise.resolve();
    expect(result).toMatchObject({
      snapshot: { status: "cancelled", errorCode: "ASK_CANCELLED" },
    });
    expect(result.result).toBeUndefined();
    await manager.close();
  });

  it("drops an answer when cancellation arrives during stale projection", async () => {
    const { root, registry, fileId } = await setup();
    let releaseStaleCheck: (() => void) | undefined;
    const staleCheckStarted = new Promise<void>((resolve) => {
      releaseStaleCheck = resolve;
    });
    let finishStaleCheck: (() => void) | undefined;
    const staleCheckFinished = new Promise<void>((resolve) => {
      finishStaleCheck = resolve;
    });
    const source = Object.freeze({
      handleId: "projection-handle",
      fileId,
      relativePath: "src/App.tsx",
      label: "App.tsx",
      lineCount: 1,
      size: 1,
      contentHash: "a".repeat(64),
      confidence: "exact" as const,
      targetIds: Object.freeze(["target-1"]),
    });
    let disposed = false;
    const captured: CapturedAskReadSnapshot = {
      grant: Object.freeze({
        contextHash: "b".repeat(64),
        truncated: false,
        sources: Object.freeze([source]),
      }),
      snapshot: Object.freeze({
        manifest: () => Object.freeze([source]),
        read: () => ({
          handleId: source.handleId,
          startLine: 1,
          endLine: 1,
          content: "source",
        }),
        search: () => Object.freeze([]),
      }),
      dispose() {
        disposed = true;
      },
      async isStale() {
        releaseStaleCheck?.();
        await staleCheckFinished;
        return false;
      },
      projectCitation(handleId, startLine, endLine) {
        if (disposed || handleId !== source.handleId) {
          throw new Error("Unexpected citation projection.");
        }
        return Object.freeze({ ...source, startLine, endLine });
      },
    };
    const manager = createContextualAskManager({
      enabled: true,
      executors: [
        fakeExecutor(() =>
          Promise.resolve({
            blocks: [
              {
                kind: "paragraph",
                text: "投影中的答案",
                citations: [{ handleId: source.handleId, startLine: 1, endLine: 1 }],
              },
            ],
            warnings: [],
          }),
        ),
      ],
      coordinator: createWorkspaceActivityCoordinator(),
      registry,
      root,
      dependencies: {
        captureSnapshot: () => Promise.resolve(captured),
      },
    });

    const created = await manager.create(request(fileId));
    await staleCheckStarted;
    manager.cancel(created.jobId);
    finishStaleCheck?.();
    const response = await manager.result(created.jobId);

    expect(response).toMatchObject({
      snapshot: { status: "cancelled", errorCode: "ASK_CANCELLED" },
    });
    expect(response.result).toBeUndefined();
    await manager.close();
  });

  it("never invokes an executor for a forged Registry source", async () => {
    const { root, registry } = await setup();
    const execute = vi.fn<ContextualAskExecutor["execute"]>(() =>
      Promise.reject(new Error("must not run")),
    );
    const manager = createContextualAskManager({
      enabled: true,
      executors: [fakeExecutor(execute)],
      coordinator: createWorkspaceActivityCoordinator(),
      registry,
      root,
    });
    const created = await manager.create(request("forged-file-id"));
    const result = await manager.result(created.jobId);
    expect(result.snapshot).toMatchObject({
      status: "failed",
      errorCode: "ASK_SELECTION_STALE",
    });
    expect(execute).not.toHaveBeenCalled();
    await manager.close();
  });

  it("never invokes an executor for a stale component sourceVersion", async () => {
    const { root, registry } = await setup();
    const sourcePath = path.join(root, "src/App.tsx");
    const fileId = registry.registerDataFlowComponents(sourcePath, "current-version", [
      { componentSourceId: "component-source", line: 1, column: 1 },
    ]);
    const execute = vi.fn<ContextualAskExecutor["execute"]>(() =>
      Promise.reject(new Error("must not run")),
    );
    const manager = createContextualAskManager({
      enabled: true,
      executors: [fakeExecutor(execute)],
      coordinator: createWorkspaceActivityCoordinator(),
      registry,
      root,
    });
    const staleRequest = {
      ...request(fileId),
      envelope: envelope(fileId, "这个组件是什么？", {
        componentSourceId: "component-source",
        sourceVersion: "stale-version",
      }),
    };
    const created = await manager.create(staleRequest);
    const result = await manager.result(created.jobId);
    expect(result.snapshot).toMatchObject({
      status: "failed",
      errorCode: "ASK_SELECTION_STALE",
    });
    expect(execute).not.toHaveBeenCalled();
    await manager.close();
  });

  it("shares the workspace lease with Change", async () => {
    const { root, registry, fileId } = await setup();
    const coordinator = createWorkspaceActivityCoordinator();
    const changeLease = coordinator.acquire("change");
    const manager = createContextualAskManager({
      enabled: true,
      executors: [
        fakeExecutor(() =>
          Promise.resolve({
            blocks: [{ kind: "paragraph", text: "不足", citations: [] }],
            warnings: [{ code: "insufficient-evidence" }],
          }),
        ),
      ],
      coordinator,
      registry,
      root,
    });
    await expect(manager.create(request(fileId))).rejects.toMatchObject({
      code: "ASK_BUSY",
    });
    changeLease?.release();
    await manager.close();
  });

  it("expires the only retained result at the protocol TTL", async () => {
    const { root, registry, fileId } = await setup();
    let nowMs = Date.parse("2026-09-01T00:00:00.000Z");
    const manager = createContextualAskManager({
      enabled: true,
      executors: [
        fakeExecutor(() =>
          Promise.resolve({
            blocks: [{ kind: "paragraph", text: "不足", citations: [] }],
            warnings: [{ code: "insufficient-evidence" }],
          }),
        ),
      ],
      coordinator: createWorkspaceActivityCoordinator(),
      registry,
      root,
      dependencies: { now: () => new Date(nowMs) },
    });
    const created = await manager.create(request(fileId));
    await manager.result(created.jobId);
    nowMs += CONTEXTUAL_ASK_LIMITS.resultTtlMs + 1;
    await expect(manager.result(created.jobId)).rejects.toMatchObject({
      code: "ASK_RESULT_EXPIRED",
    });
    await manager.close();
  });

  it("terminates an executor that ignores abort at the Job timeout", async () => {
    vi.useFakeTimers();
    const { root, registry, fileId } = await setup();
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const manager = createContextualAskManager({
      enabled: true,
      executors: [
        fakeExecutor(
          () =>
            new Promise<never>(() => {
              markStarted?.();
            }),
        ),
      ],
      coordinator: createWorkspaceActivityCoordinator(),
      registry,
      root,
    });
    const created = await manager.create(request(fileId));
    await started;
    await vi.advanceTimersByTimeAsync(CONTEXTUAL_ASK_LIMITS.jobTimeoutMs);
    const result = await manager.result(created.jobId);
    expect(result.snapshot).toMatchObject({
      status: "failed",
      errorCode: "ASK_TIMEOUT",
    });
    await manager.close();
  });

  it("fails the Job when an executor catches and exceeds the read-call limit", async () => {
    const { root, registry, fileId } = await setup();
    const manager = createContextualAskManager({
      enabled: true,
      executors: [
        fakeExecutor((input) => {
          const handleId = input.grant.sources[0]?.handleId ?? "";
          for (
            let index = 0;
            index <= CONTEXTUAL_ASK_LIMITS.maximumToolCalls;
            index += 1
          ) {
            try {
              input.snapshot.read(handleId);
            } catch {
              // A malicious executor cannot turn a caught limit into a valid answer.
            }
          }
          return Promise.resolve({
            blocks: [{ kind: "paragraph", text: "不足", citations: [] }],
            warnings: [{ code: "insufficient-evidence" }],
          });
        }),
      ],
      coordinator: createWorkspaceActivityCoordinator(),
      registry,
      root,
    });
    const created = await manager.create(request(fileId));
    const result = await manager.result(created.jobId);
    expect(result.snapshot).toMatchObject({
      status: "failed",
      errorCode: "ASK_LIMIT_EXCEEDED",
    });
    await manager.close();
  });
});
