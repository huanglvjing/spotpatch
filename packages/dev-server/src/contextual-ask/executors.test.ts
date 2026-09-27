import type { ContextualAskExecutor } from "@spotpatch/agent";
import { describe, expect, it } from "vitest";

import { composeContextualAskExecutors } from "./executors.js";

function executor(executorId: string): ContextualAskExecutor {
  return {
    executorId,
    capability: () => Promise.reject(new Error("not used")),
    execute: () => Promise.reject(new Error("not used")),
  };
}

const managed = Object.freeze({
  codex: executor("codex"),
  claudeCode: executor("claude"),
});

describe("composeContextualAskExecutors", () => {
  it("keeps configured Key first by default and always includes both managed Agents", () => {
    expect(
      composeContextualAskExecutors({
        configuredKey: [executor("key")],
        managed,
      }).map((value) => value.executorId),
    ).toEqual(["key", "codex", "claude"]);
  });

  it("places Managed Codex first only when explicitly preferred", () => {
    const values = composeContextualAskExecutors({
      configuredKey: [executor("key")],
      managed,
      defaultExecutor: { kind: "managed-codex" },
    });
    expect(values.map((value) => value.executorId)).toEqual(["codex", "claude", "key"]);
    expect(Object.isFrozen(values)).toBe(true);
  });

  it("places Claude Code first only when explicitly preferred", () => {
    expect(
      composeContextualAskExecutors({
        configuredKey: [executor("key")],
        managed,
        defaultExecutor: { kind: "claude-code" },
      }).map((value) => value.executorId),
    ).toEqual(["claude", "codex", "key"]);
  });
});
