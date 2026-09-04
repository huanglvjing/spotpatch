import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runManagedCodexLivePoc } from "./codex-live-poc.js";

const runLive = process.env.SPOTPATCH_RUN_CODEX_LIVE === "1";
const executable = process.env.SPOTPATCH_Q1_CODEX_PATH ?? "codex";

describe.skipIf(!runLive)("Q1 Managed Codex authenticated read-only gate", () => {
  it("returns a schema-constrained answer and rejects root reads and writes", async () => {
    const repositoryRoot = await realpath(
      path.resolve(import.meta.dirname, "../../.."),
    );
    const report = await runManagedCodexLivePoc({ executable, repositoryRoot });
    const artifactRoot = path.resolve(import.meta.dirname, "../.artifacts/codex-live");
    await mkdir(artifactRoot, { recursive: true });
    await writeFile(
      path.join(artifactRoot, "result.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );

    expect(report).toMatchObject({
      activePermissionProfile: "spotpatch-ask-readonly",
      fileChangeEvents: 0,
      forbiddenValueNotReturned: true,
      hooks: 0,
      instructionSources: 0,
      mcpServers: 0,
      noPersistedThread: true,
      outputSchemaValid: true,
      outsideReadDenied: true,
      sourceRead: true,
      terminalStatus: "completed",
      threadEphemeral: true,
      writeDenied: true,
      writeFileAbsent: true,
    });
    expect(report.answer).toContain("Card");
  });
});
