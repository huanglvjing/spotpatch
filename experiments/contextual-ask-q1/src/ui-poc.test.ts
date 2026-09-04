import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { JSDOM } from "jsdom";
import { afterAll, describe, expect, it } from "vitest";

import {
  mountAskPanelPoc,
  type AskPanelPocBlock,
  type AskPanelPocCitation,
} from "./ui/ask-panel-poc.js";

const BLOCK_COUNT = 40;
const CITATION_COUNT = 64;
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../..");

interface UiPocEvidence {
  bundle?: Readonly<{
    askGzipBytes: number;
    askRawBytes: number;
    runtimeGzipBytes: number;
    runtimeRawBytes: number;
    runtimeSha256: string;
  }>;
  modeSwitch?: Readonly<{ p95Ms: number }>;
  mount?: Readonly<{
    answerCharacters: number;
    blocks: number;
    citations: number;
    medianMs: number;
    nodes: number;
    p95Ms: number;
  }>;
}

const evidence: UiPocEvidence = {};

afterAll(async () => {
  if (
    evidence.bundle === undefined ||
    evidence.modeSwitch === undefined ||
    evidence.mount === undefined
  ) {
    throw new Error("The UI POC evidence is incomplete.");
  }
  const artifactRoot = path.join(
    REPOSITORY_ROOT,
    "experiments/contextual-ask-q1/.artifacts/ui",
  );
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(
    path.join(artifactRoot, "result.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
});

function fixture(): Readonly<{
  blocks: readonly AskPanelPocBlock[];
  citations: readonly AskPanelPocCitation[];
}> {
  const citations = Object.freeze(
    Array.from({ length: CITATION_COUNT }, (_, index) =>
      Object.freeze({
        sourceId: `source-${String(index)}`,
        path: `src/components/Component${String(index)}.tsx`,
        startLine: index + 1,
        endLine: index + 3,
      }),
    ),
  );
  const blocks = Object.freeze(
    Array.from({ length: BLOCK_COUNT }, (_, index) =>
      Object.freeze({
        kind: index % 8 === 0 ? ("code" as const) : ("paragraph" as const),
        text: `${String(index).padStart(2, "0")} ${"SpotPatch contextual answer evidence. ".repeat(26)}`,
        citations: Object.freeze([
          citations[index % citations.length]?.sourceId ?? "source-0",
        ]),
      }),
    ),
  );
  return Object.freeze({ blocks, citations });
}

function percentile(values: readonly number[], ratio: number): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * ratio) - 1] ?? Number.POSITIVE_INFINITY;
}

describe("Q1 Ask UI size and long-answer performance", () => {
  it("mounts 40 blocks and 64 sources within a bounded DOM and latency budget", () => {
    const data = fixture();
    const durations: number[] = [];
    let finalNodeCount = 0;

    for (let iteration = 0; iteration < 30; iteration += 1) {
      const dom = new JSDOM("<!doctype html><html><body></body></html>");
      const host = dom.window.document.createElement("spotpatch-ask-poc");
      dom.window.document.body.append(host);
      const startedAt = performance.now();
      const panel = mountAskPanelPoc({
        host: host as unknown as HTMLElement,
        question: "What is this selected component?",
        ...data,
      });
      durations.push(performance.now() - startedAt);
      finalNodeCount = panel.root.querySelectorAll("*").length;
      expect(panel.root.querySelectorAll(".answer-block")).toHaveLength(BLOCK_COUNT);
      expect(panel.root.querySelectorAll(".source-link")).toHaveLength(CITATION_COUNT);
      panel.dispose();
      dom.window.close();
    }

    const medianMs = percentile(durations, 0.5);
    const p95Ms = percentile(durations, 0.95);
    evidence.mount = Object.freeze({
      blocks: BLOCK_COUNT,
      citations: CITATION_COUNT,
      answerCharacters: data.blocks.reduce(
        (total, block) => total + block.text.length,
        0,
      ),
      nodes: finalNodeCount,
      medianMs,
      p95Ms,
    });
    expect(medianMs).toBeLessThan(30);
    expect(p95Ms).toBeLessThan(80);
    expect(finalNodeCount).toBeLessThan(400);
  });

  it("switches explicit Ask/Change modes without discarding either draft", () => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    const host = dom.window.document.createElement("spotpatch-ask-poc");
    dom.window.document.body.append(host);
    const panel = mountAskPanelPoc({
      host: host as unknown as HTMLElement,
      question: "Original Ask draft",
      ...fixture(),
    });
    panel.questionInput.value = "Edited Ask draft";
    const durations: number[] = [];
    for (let iteration = 0; iteration < 100; iteration += 1) {
      const startedAt = performance.now();
      panel.setMode(iteration % 2 === 0 ? "change" : "ask");
      durations.push(performance.now() - startedAt);
    }

    expect(panel.questionInput.value).toBe("Edited Ask draft");
    const p95Ms = percentile(durations, 0.95);
    evidence.modeSwitch = Object.freeze({ p95Ms });
    expect(p95Ms).toBeLessThan(2);
    expect(panel.askButton.getAttribute("aria-selected")).toBe("true");
    expect(panel.answerPanel.hidden).toBe(false);
    panel.dispose();
    dom.window.close();
  });

  it("keeps the POC in an optional bundle and records the unchanged core runtime", async () => {
    const [pocBundle, runtimeBundle, runtimePackage] = await Promise.all([
      readFile(
        path.join(
          REPOSITORY_ROOT,
          "experiments/contextual-ask-q1/.artifacts/ui-bundle/ask-panel-poc.global.js",
        ),
      ),
      readFile(path.join(REPOSITORY_ROOT, "packages/runtime/dist/index.js")),
      readFile(path.join(REPOSITORY_ROOT, "packages/runtime/package.json"), "utf8"),
    ]);
    const runtimePackageText = runtimePackage.toString();
    const runtimeSha256 = createHash("sha256").update(runtimeBundle).digest("hex");
    evidence.bundle = Object.freeze({
      askRawBytes: pocBundle.byteLength,
      askGzipBytes: gzipSync(pocBundle).byteLength,
      runtimeRawBytes: runtimeBundle.byteLength,
      runtimeGzipBytes: gzipSync(runtimeBundle).byteLength,
      runtimeSha256,
    });

    expect(evidence.bundle.askGzipBytes).toBeLessThan(8 * 1024);
    expect(runtimePackageText).not.toContain("contextual-ask-q1");
    expect(runtimeBundle.includes(Buffer.from("SpotPatchAskPoc"))).toBe(false);
    expect(runtimeSha256).toMatch(/^[a-f0-9]{64}$/u);
  });
});
