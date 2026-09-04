import { describe, expect, it } from "vitest";

import type { ContextualAskExecutorError } from "@spotpatch/agent";

import {
  createManagedCodexAnswerCollector,
  MANAGED_CODEX_ASK_OUTPUT_SCHEMA,
} from "./answer-events.js";

const ANSWER = Object.freeze({
  blocks: [
    {
      kind: "paragraph" as const,
      text: "This is the selected component.",
      citations: [{ handleId: "source_handle", startLine: 1, endLine: 2 }],
    },
  ],
  warnings: [],
});
const WIRE_ANSWER = Object.freeze({
  blocks: ANSWER.blocks.map((block) => ({
    kind: block.kind,
    text: block.text,
    listItems: [],
    code: null,
    language: null,
    citations: block.citations,
  })),
  warnings: ANSWER.warnings,
});

function eventBase() {
  return { threadId: "thread-1", turnId: "turn-1" } as const;
}

function expectCode(
  promise: Promise<unknown>,
  code: ContextualAskExecutorError["code"],
): Promise<void> {
  return expect(promise).rejects.toMatchObject({ code });
}

describe("createManagedCodexAnswerCollector", () => {
  it("uses the strict Structured Outputs subset without union keywords", () => {
    const serialized = JSON.stringify(MANAGED_CODEX_ASK_OUTPUT_SCHEMA);
    expect(serialized).not.toContain('"oneOf"');
    expect(serialized).not.toContain('"anyOf"');
    expect(serialized).toContain('"listItems"');
  });

  it("requires both the authoritative final item and completed terminal event", async () => {
    const collector = createManagedCodexAnswerCollector("thread-1");
    collector.setTurnId("turn-1");
    collector.handleNotification("turn/started", {
      ...eventBase(),
      turn: { id: "turn-1", status: "inProgress" },
    });
    collector.handleNotification("item/completed", {
      ...eventBase(),
      item: {
        id: "item-final",
        type: "agentMessage",
        phase: "final_answer",
        text: JSON.stringify(WIRE_ANSWER),
      },
    });
    collector.handleNotification("turn/completed", {
      ...eventBase(),
      turn: { id: "turn-1", status: "completed" },
    });

    await expect(collector.result).resolves.toEqual(ANSWER);
  });

  it("handles terminal events received before turn/start responds", async () => {
    const collector = createManagedCodexAnswerCollector("thread-1");
    collector.handleNotification("turn/started", {
      ...eventBase(),
      turn: { id: "turn-1", status: "inProgress" },
    });
    collector.handleNotification("item/completed", {
      ...eventBase(),
      item: {
        id: "item-final",
        type: "agentMessage",
        text: JSON.stringify(WIRE_ANSWER),
      },
    });
    collector.handleNotification("turn/completed", {
      ...eventBase(),
      turn: { id: "turn-1", status: "completed" },
    });
    collector.setTurnId("turn-1");

    await expect(collector.result).resolves.toEqual(ANSWER);
  });

  it("derives turn correlation from Turn objects in the locked Codex schema", async () => {
    const collector = createManagedCodexAnswerCollector("thread-1");
    collector.setTurnId("turn-1");
    collector.handleNotification("turn/started", {
      threadId: "thread-1",
      turn: { id: "turn-1", status: "inProgress" },
    });
    collector.handleNotification("item/completed", {
      ...eventBase(),
      item: {
        id: "item-final",
        type: "agentMessage",
        phase: "final_answer",
        text: JSON.stringify(WIRE_ANSWER),
      },
    });
    collector.handleNotification("turn/completed", {
      threadId: "thread-1",
      turn: { id: "turn-1", status: "completed" },
    });
    await expect(collector.result).resolves.toEqual(ANSWER);
  });

  it("accepts an exact duplicate item ID but rejects distinct final items", async () => {
    const collector = createManagedCodexAnswerCollector("thread-1");
    collector.setTurnId("turn-1");
    collector.handleNotification("turn/started", {
      ...eventBase(),
      turn: { id: "turn-1", status: "inProgress" },
    });
    const first = {
      ...eventBase(),
      item: {
        id: "item-final",
        type: "agentMessage",
        phase: "final_answer",
        text: JSON.stringify(WIRE_ANSWER),
      },
    };
    collector.handleNotification("item/completed", first);
    collector.handleNotification("item/completed", first);
    collector.handleNotification("item/completed", {
      ...eventBase(),
      item: { ...first.item, id: "item-other" },
    });

    await expectCode(collector.result, "ASK_ANSWER_INVALID");
  });

  it.each([
    [
      "turn/diff/updated",
      { ...eventBase(), diff: "diff --git a/x b/x" },
      "ASK_WRITE_ATTEMPTED",
    ],
    [
      "item/started",
      { ...eventBase(), item: { id: "write", type: "fileChange" } },
      "ASK_WRITE_ATTEMPTED",
    ],
    [
      "item/started",
      { ...eventBase(), item: { id: "agent", type: "collabToolCall" } },
      "ASK_PROTOCOL_INCOMPATIBLE",
    ],
  ] as const)("fails closed on forbidden %s activity", async (method, params, code) => {
    const collector = createManagedCodexAnswerCollector("thread-1");
    collector.setTurnId("turn-1");
    collector.handleNotification(method, params);
    await expectCode(collector.result, code);
  });

  it("ignores unrelated threads and rejects a failed correlated turn", async () => {
    const collector = createManagedCodexAnswerCollector("thread-1");
    collector.setTurnId("turn-1");
    collector.handleNotification("turn/completed", {
      threadId: "other-thread",
      turnId: "turn-1",
      turn: { id: "turn-1", status: "completed" },
    });
    collector.handleNotification("turn/started", {
      ...eventBase(),
      turn: { id: "turn-1", status: "inProgress" },
    });
    collector.handleNotification("turn/completed", {
      ...eventBase(),
      turn: { id: "turn-1", status: "failed" },
    });
    await expectCode(collector.result, "ASK_EXECUTOR_UNAVAILABLE");
  });

  it("rejects a completed turn that has no authoritative final item", async () => {
    const collector = createManagedCodexAnswerCollector("thread-1");
    collector.setTurnId("turn-1");
    collector.handleNotification("turn/started", {
      ...eventBase(),
      turn: { id: "turn-1", status: "inProgress" },
    });
    collector.handleNotification("turn/completed", {
      ...eventBase(),
      turn: { id: "turn-1", status: "completed" },
    });
    await expectCode(collector.result, "ASK_ANSWER_INVALID");
  });

  it("rejects invalid combinations in the normalized wire block", async () => {
    const collector = createManagedCodexAnswerCollector("thread-1");
    collector.setTurnId("turn-1");
    collector.handleNotification("turn/started", {
      ...eventBase(),
      turn: { id: "turn-1", status: "inProgress" },
    });
    collector.handleNotification("item/completed", {
      ...eventBase(),
      item: {
        id: "item-final",
        type: "agentMessage",
        phase: "final_answer",
        text: JSON.stringify({
          ...WIRE_ANSWER,
          blocks: [{ ...WIRE_ANSWER.blocks[0], code: "unexpected" }],
        }),
      },
    });
    collector.handleNotification("turn/completed", {
      ...eventBase(),
      turn: { id: "turn-1", status: "completed" },
    });
    await expectCode(collector.result, "ASK_ANSWER_INVALID");
  });
});
