import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

import type { ContextualAskExecutorInput } from "@spotpatch/agent";
import type { AskAnswerDraft } from "@spotpatch/shared";
import { describe, expect, it } from "vitest";

import { createClaudeCodeAskExecutor } from "./ask-adapter.js";

const runLive = process.env.SPOTPATCH_RUN_CLAUDE_ASK_LIVE === "1";
const RELATIVE_PATHS = [
  "src/main.tsx",
  "src/business-card.tsx",
  "src/styles.css",
] as const;

async function liveInput(repositoryRoot: string): Promise<ContextualAskExecutorInput> {
  const playgroundRoot = path.join(repositoryRoot, "playgrounds/minimal-react-18");
  const contents = await Promise.all(
    RELATIVE_PATHS.map((relativePath) =>
      readFile(path.join(playgroundRoot, relativePath), "utf8"),
    ),
  );
  const sources = RELATIVE_PATHS.map((relativePath, index) => {
    const content = contents[index] ?? "";
    return Object.freeze({
      handleId: `claude_live_source_${String(index)}`,
      fileId: `claude_live_file_${String(index)}`,
      relativePath,
      label: path.basename(relativePath),
      lineCount: content.split("\n").length,
      size: Buffer.byteLength(content),
      contentHash: createHash("sha256").update(content).digest("hex"),
      confidence: "exact" as const,
      targetIds: Object.freeze(["claude_live_target"]),
    });
  });
  const primary = sources[1];
  const primaryContent = contents[1];
  if (primary === undefined || primaryContent === undefined) {
    throw new Error("Claude Code live fixture is incomplete.");
  }
  const contextHash = createHash("sha256")
    .update(sources.map((source) => source.contentHash).join("\n"))
    .digest("hex");

  return {
    jobId: "claude_live_job",
    envelope: {
      schemaVersion: 1,
      taskId: "claude_live_task",
      task: { kind: "ask", question: "What does the selected business card render?" },
      selection: {
        schemaVersion: 1,
        selectionId: "claude_live_selection",
        locale: "en-US",
        createdAt: "2026-09-27T00:00:00.000Z",
        targets: [
          {
            targetId: "claude_live_target",
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
              line: 1,
              column: 1,
              origin: "jsx-host",
              confidence: "exact",
            },
            react: {
              supported: true,
              componentName: "BusinessCard",
              componentStack: [],
            },
            element: {
              tagName: "article",
              selector: "article",
              sanitizedHtml: "<article>…</article>",
              rect: { x: 0, y: 0, width: 400, height: 240 },
            },
            styles: { classNames: [], matchedRules: [], computed: {}, warnings: [] },
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
      createdAt: "2026-09-27T00:00:00.000Z",
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
        return { handleId, startLine: 1, endLine: source.lineCount, content };
      },
      search: () => [],
    },
  };
}

function citations(draft: AskAnswerDraft) {
  return draft.blocks.flatMap((block) =>
    block.kind === "list"
      ? block.items.flatMap((item) => item.citations)
      : block.citations,
  );
}

describe.skipIf(!runLive)("Claude Code Ask executor live gate", () => {
  it("answers a multi-file question with citations inside the granted sources", async () => {
    const repositoryRoot = await realpath(
      path.resolve(import.meta.dirname, "../../../../.."),
    );
    const executor = createClaudeCodeAskExecutor({ projectRoot: repositoryRoot });
    const capability = await executor.capability(new AbortController().signal);
    expect(capability).toMatchObject({ state: "ready", readOnlyProven: true });

    const input = await liveInput(repositoryRoot);
    const draft = await executor.execute(input, new AbortController().signal);
    const lineCounts = new Map(
      input.grant.sources.map((source) => [source.handleId, source.lineCount]),
    );
    const cited = citations(draft);
    expect(cited.length).toBeGreaterThan(0);
    for (const citation of cited) {
      const lineCount = lineCounts.get(citation.handleId);
      expect(lineCount).toBeDefined();
      expect(citation.startLine).toBeGreaterThanOrEqual(1);
      expect(citation.endLine).toBeGreaterThanOrEqual(citation.startLine);
      expect(citation.endLine).toBeLessThanOrEqual(lineCount ?? 0);
    }
    expect(executor.effectiveModelLabel?.()).toMatch(/^claude-/u);
  }, 300_000);
});
