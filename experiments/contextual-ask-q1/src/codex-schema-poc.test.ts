import { access } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { inspectCodexAppServerSchema } from "./codex-schema-poc.js";

const CODEX_EXECUTABLE = process.env.SPOTPATCH_Q1_CODEX_PATH ?? "codex";

describe("Q1 Managed Codex generated-schema gate", () => {
  it("proves the locked executable exposes answer, terminal, deletion and isolation fields", async () => {
    if (CODEX_EXECUTABLE.includes("/")) await access(CODEX_EXECUTABLE);

    const report = await inspectCodexAppServerSchema(CODEX_EXECUTABLE);

    expect(report.version).toMatch(/^codex-cli \d+\.\d+\.\d+/u);
    expect(report.appServerMethods).toEqual({
      itemAgentMessageDelta: true,
      itemCompleted: true,
      threadDelete: true,
      turnCompleted: true,
      turnStarted: true,
    });
    expect(report.schema).toMatchObject({
      agentMessageFinalItem: true,
      namedPermissionProfilesSelectable: true,
      readOnlySandbox: true,
      threadStartEphemeral: true,
      turnOutputSchema: true,
    });
    expect(report.managedAskSchemaCandidate).toBe(true);
    expect(report.generatedSchemaSha256).toMatch(/^[a-f0-9]{64}$/u);
  });
});
