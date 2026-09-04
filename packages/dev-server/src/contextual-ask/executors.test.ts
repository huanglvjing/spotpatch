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

describe("composeContextualAskExecutors", () => {
  it("keeps configured Key first by default and always includes Managed Codex", () => {
    const key = executor("key");
    const managed = executor("managed");
    expect(
      composeContextualAskExecutors({
        configuredKey: [key],
        managedCodex: managed,
      }).map((value) => value.executorId),
    ).toEqual(["key", "managed"]);
  });

  it("places Managed Codex first only when explicitly preferred", () => {
    const values = composeContextualAskExecutors({
      configuredKey: [executor("key")],
      managedCodex: executor("managed"),
      defaultExecutor: { kind: "managed-codex" },
    });
    expect(values.map((value) => value.executorId)).toEqual(["managed", "key"]);
    expect(Object.isFrozen(values)).toBe(true);
  });
});
