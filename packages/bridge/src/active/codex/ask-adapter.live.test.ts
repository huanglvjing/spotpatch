import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ContextualAskExecutorInput } from "@spotpatch/agent";
import { describe, expect, it } from "vitest";

import { createManagedCodexAskExecutor } from "./ask-adapter.js";

const runLive = process.env.SPOTPATCH_RUN_CODEX_Q6_LIVE === "1";
const SOURCE = [
  'import type { JSX } from "react";',
  "",
  "export function Card(): JSX.Element {",
  '  return <article data-component="Card">Selected card</article>;',
  "}",
].join("\n");

function liveInput(jobId: string): ContextualAskExecutorInput {
  const contentHash = createHash("sha256").update(SOURCE).digest("hex");
  const source = Object.freeze({
    handleId: "managed_live_source",
    fileId: "managed_live_file",
    relativePath: "src/Card.tsx",
    label: "Card.tsx",
    lineCount: 5,
    size: Buffer.byteLength(SOURCE),
    contentHash,
    confidence: "exact" as const,
    targetIds: Object.freeze(["managed_live_target"]),
  });
  return {
    jobId,
    envelope: {
      schemaVersion: 1,
      taskId: `${jobId}_task`,
      task: { kind: "ask", question: "What is the selected Card component?" },
      selection: {
        schemaVersion: 1,
        selectionId: `${jobId}_selection`,
        locale: "en-US",
        createdAt: "2026-09-02T00:00:00.000Z",
        targets: [
          {
            targetId: "managed_live_target",
            page: {
              url: "http://127.0.0.1:3000/card",
              pathname: "/card",
              title: "Card fixture",
              viewportWidth: 1200,
              viewportHeight: 800,
              devicePixelRatio: 2,
            },
            source: {
              fileId: source.fileId,
              relativePath: source.relativePath,
              line: 3,
              column: 1,
              origin: "jsx-host",
              confidence: "exact",
            },
            react: {
              supported: true,
              componentName: "Card",
              componentStack: [],
            },
            element: {
              tagName: "article",
              selector: '[data-component="Card"]',
              sanitizedHtml: '<article data-component="Card">Selected card</article>',
              rect: { x: 0, y: 0, width: 200, height: 80 },
            },
            styles: { classNames: [], matchedRules: [], computed: {}, warnings: [] },
            code: {
              relativePath: source.relativePath,
              language: "tsx",
              startLine: 1,
              endLine: 5,
              excerpt: SOURCE,
              boundary: "component",
            },
            warnings: [],
          },
        ],
      },
      createdAt: "2026-09-02T00:00:00.000Z",
    },
    grant: { contextHash: contentHash, truncated: false, sources: [source] },
    snapshot: {
      manifest: () => [source],
      read: () => ({
        handleId: source.handleId,
        startLine: 1,
        endLine: source.lineCount,
        content: SOURCE,
      }),
      search: () => [],
    },
  };
}

async function multiFileLiveInput(
  jobId: string,
  repositoryRoot: string,
): Promise<ContextualAskExecutorInput> {
  const relativePaths = [
    "src/main.tsx",
    "src/business-card.tsx",
    "src/fixtures.tsx",
    "src/lazy-panel.tsx",
    "src/styles.css",
    "src/fixture.module.css",
  ] as const;
  const playgroundRoot = path.join(repositoryRoot, "playgrounds/minimal-react-18");
  const contents = await Promise.all(
    relativePaths.map(async (relativePath) =>
      readFile(path.join(playgroundRoot, relativePath), "utf8"),
    ),
  );
  const sources = relativePaths.map((relativePath, index) => {
    const content = contents[index] ?? "";
    return Object.freeze({
      handleId: `managed_multi_source_${String(index)}`,
      fileId: `managed_multi_file_${String(index)}`,
      relativePath,
      label: path.basename(relativePath),
      lineCount: content.split("\n").length,
      size: Buffer.byteLength(content),
      contentHash: createHash("sha256").update(content).digest("hex"),
      confidence: "exact" as const,
      targetIds: Object.freeze(["managed_multi_target"]),
    });
  });
  const primary = sources[0];
  const primaryContent = contents[0];
  if (primary === undefined || primaryContent === undefined) {
    throw new Error("Managed Codex multi-file live fixture is incomplete.");
  }
  const contextHash = createHash("sha256")
    .update(sources.map((source) => source.contentHash).join("\n"))
    .digest("hex");

  return {
    jobId,
    envelope: {
      schemaVersion: 1,
      taskId: `${jobId}_task`,
      task: { kind: "ask", question: "What does the selected App component do?" },
      selection: {
        schemaVersion: 1,
        selectionId: `${jobId}_selection`,
        locale: "en-US",
        createdAt: "2026-09-02T00:00:00.000Z",
        targets: [
          {
            targetId: "managed_multi_target",
            page: {
              url: "http://127.0.0.1:5173/",
              pathname: "/",
              title: "SpotPatch Playground",
              viewportWidth: 1200,
              viewportHeight: 800,
              devicePixelRatio: 2,
            },
            source: {
              fileId: primary.fileId,
              relativePath: primary.relativePath,
              line: 20,
              column: 3,
              origin: "jsx-host",
              confidence: "exact",
            },
            react: { supported: true, componentName: "App", componentStack: [] },
            element: {
              tagName: "main",
              selector: "main.page-shell",
              sanitizedHtml: '<main class="page-shell">…</main>',
              rect: { x: 0, y: 0, width: 1200, height: 800 },
            },
            styles: {
              classNames: ["page-shell"],
              matchedRules: [],
              computed: {},
              warnings: [],
            },
            code: {
              relativePath: primary.relativePath,
              language: "tsx",
              startLine: 1,
              endLine: primary.lineCount,
              excerpt: primaryContent,
              boundary: "component",
            },
            warnings: [],
          },
        ],
      },
      createdAt: "2026-09-02T00:00:00.000Z",
    },
    grant: { contextHash, truncated: false, sources },
    snapshot: {
      manifest: () => sources,
      read: (handleId) => {
        const index = sources.findIndex((source) => source.handleId === handleId);
        const source = sources[index];
        const content = contents[index];
        if (source === undefined || content === undefined) {
          throw new Error(`Unknown live source handle: ${handleId}`);
        }
        return {
          handleId,
          startLine: 1,
          endLine: source.lineCount,
          content,
        };
      },
      search: () => [],
    },
  };
}

describe.skipIf(!runLive)("Q6 Managed Codex production executor live gate", () => {
  it("answers isolated single-file and multi-file turns with citations and removes every runtime home", async () => {
    const repositoryRoot = await realpath(
      path.resolve(import.meta.dirname, "../../../../.."),
    );
    const privateRuntimeBase = await mkdtemp(
      path.join(os.tmpdir(), "spotpatch-q6-live-runtime-"),
    );
    try {
      const executor = createManagedCodexAskExecutor({
        projectRoot: repositoryRoot,
        privateRuntimeBase,
      });
      const capability = await executor.capability(new AbortController().signal);
      expect(capability).toMatchObject({ state: "ready", readOnlyProven: true });

      const inputs = [
        liveInput("managed_live_one"),
        liveInput("managed_live_two"),
        await multiFileLiveInput("managed_live_multi", repositoryRoot),
      ];
      for (const input of inputs) {
        const result = await executor.execute(input, new AbortController().signal);
        expect(result.blocks.length).toBeGreaterThan(0);
        expect(
          result.blocks.some((block) =>
            block.kind === "list"
              ? block.items.some((item) => item.citations.length > 0)
              : block.citations.length > 0,
          ),
        ).toBe(true);
      }

      const runtimeRoot = path.join(
        privateRuntimeBase,
        "external-agent-runtime",
        "codex",
      );
      await expect(readdir(runtimeRoot)).resolves.toEqual([]);
    } finally {
      await rm(privateRuntimeBase, { recursive: true, force: true });
    }
  }, 420_000);
});
