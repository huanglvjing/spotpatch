import { describe, expect, it } from "vitest";

import { adaptChangeEnvelopeToSpotAnnotationV3 } from "../contextual-ask-node.js";
import {
  askAnswerDraftSchema,
  askAnswerResultSchema,
  contextualAskCapabilitySchema,
  spotAskTaskEnvelopeSchema,
  spotChangeTaskEnvelopeSchema,
  spotSelectionContextSchema,
  type SpotChangeTaskEnvelope,
} from "../model/contextual-ask.js";
import { CONTEXTUAL_ASK_LIMITS } from "./contextual-ask-constants.js";
import {
  askJobCreateRequestSchema,
  askJobEventSchema,
  askJobEventsRequestSchema,
  askJobResultResponseSchema,
  askJobSnapshotSchema,
  contextualAskCapabilityRequestSchema,
} from "./contextual-ask.js";

const now = "2026-09-01T08:00:00.000Z";
const later = "2026-09-01T08:15:00.000Z";
const hash = "a".repeat(64);

function target(targetId: string, pathname = "/settings") {
  return {
    targetId,
    page: {
      url: `http://localhost:5173${pathname}`,
      pathname,
      title: "Settings",
      viewportWidth: 1_440,
      viewportHeight: 900,
      devicePixelRatio: 2,
    },
    source: {
      fileId: `file-${targetId}`,
      relativePath: `src/${targetId}.tsx`,
      line: 12,
      column: 5,
      origin: "jsx-host" as const,
      confidence: "exact" as const,
    },
    react: {
      supported: true,
      version: "19.1.0",
      componentName: "Settings",
      componentStack: ["Settings"],
    },
    element: {
      tagName: "button",
      selector: "button.primary",
      sanitizedHtml: '<button class="primary">Save</button>',
      textPreview: "Save",
      rect: { x: 10, y: 20, width: 100, height: 40 },
    },
    styles: {
      classNames: ["primary"],
      matchedRules: [],
      computed: { display: "block" },
      warnings: [],
    },
    warnings: [],
  };
}

function selection() {
  return {
    schemaVersion: 1 as const,
    selectionId: "selection-1",
    locale: "zh-CN" as const,
    targets: [target("target-1"), target("target-2", "/profile")],
    createdAt: now,
  };
}

function askEnvelope() {
  return {
    schemaVersion: 1 as const,
    taskId: "task-ask-1",
    selection: selection(),
    task: { kind: "ask" as const, question: "这个组件负责什么？" },
    createdAt: now,
  };
}

function changeEnvelope() {
  return {
    schemaVersion: 1 as const,
    taskId: "task-change-1",
    selection: selection(),
    task: {
      kind: "change" as const,
      instructions: [
        { targetId: "target-1", instruction: "调整保存按钮。" },
        { targetId: "target-2", instruction: "调整个人资料按钮。" },
      ],
    },
    createdAt: now,
  };
}

function result() {
  return {
    schemaVersion: 1 as const,
    jobId: "job-1",
    selectionId: "selection-1",
    contextHash: hash,
    executor: {
      executorId: "key-default",
      kind: "configured-key" as const,
      label: "OpenAI",
      modelLabel: "Configured model",
    },
    blocks: [
      {
        kind: "paragraph" as const,
        text: "这是设置页面的保存操作。",
        sourceIds: ["source-1"],
      },
    ],
    sources: [
      {
        sourceId: "source-1",
        label: "Settings button",
        relativePath: "src/target-1.tsx",
        fileId: "file-target-1",
        startLine: 12,
        endLine: 18,
        confidence: "exact" as const,
        targetIds: ["target-1"],
        contentHash: hash,
      },
    ],
    warnings: [],
    createdAt: now,
    expiresAt: later,
  };
}

function snapshot(status: "running" | "answered" | "failed" = "running") {
  return {
    schemaVersion: 1 as const,
    jobId: "job-1",
    selectionId: "selection-1",
    status,
    executor: {
      executorId: "key-default",
      kind: "configured-key" as const,
      label: "OpenAI",
      modelLabel: "Configured model",
    },
    createdAt: now,
    updatedAt: now,
    canCancel: status === "running",
    ...(status === "failed" ? { errorCode: "ASK_ANSWER_INVALID" as const } : {}),
  };
}

describe("Contextual Ask selection and task contracts", () => {
  it("requires a non-empty selection with unique target IDs", () => {
    expect(spotSelectionContextSchema.safeParse(selection()).success).toBe(true);
    expect(
      spotSelectionContextSchema.safeParse({ ...selection(), targets: [] }).success,
    ).toBe(false);
    expect(
      spotSelectionContextSchema.safeParse({
        ...selection(),
        targets: [target("same"), target("same")],
      }).success,
    ).toBe(false);
  });

  it("keeps Ask single-turn and rejects unknown or oversized input", () => {
    expect(spotAskTaskEnvelopeSchema.safeParse(askEnvelope()).success).toBe(true);
    expect(
      spotAskTaskEnvelopeSchema.safeParse({
        ...askEnvelope(),
        task: { kind: "ask", question: "q", history: [] },
      }).success,
    ).toBe(false);
    expect(
      spotAskTaskEnvelopeSchema.safeParse({
        ...askEnvelope(),
        task: {
          kind: "ask",
          question: "q".repeat(CONTEXTUAL_ASK_LIMITS.maximumQuestionCharacters + 1),
        },
      }).success,
    ).toBe(false);
  });

  it("requires exactly one Change instruction per selected target", () => {
    expect(spotChangeTaskEnvelopeSchema.safeParse(changeEnvelope()).success).toBe(true);
    expect(
      spotChangeTaskEnvelopeSchema.safeParse({
        ...changeEnvelope(),
        task: {
          kind: "change",
          instructions: [{ targetId: "target-1", instruction: "Only one" }],
        },
      }).success,
    ).toBe(false);
    expect(
      spotChangeTaskEnvelopeSchema.safeParse({
        ...changeEnvelope(),
        task: {
          kind: "change",
          instructions: [
            { targetId: "target-1", instruction: "One" },
            { targetId: "target-1", instruction: "Duplicate" },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("adapts only Change to legacy SpotAnnotation v3 without losing page scope", () => {
    const annotation = adaptChangeEnvelopeToSpotAnnotationV3(
      spotChangeTaskEnvelopeSchema.parse(changeEnvelope()),
    );
    expect(annotation.schemaVersion).toBe(3);
    expect(annotation.page.pathname).toBe("/settings");
    expect(annotation.targets.map((item) => item.page?.pathname)).toEqual([
      "/settings",
      "/profile",
    ]);
    expect(annotation.targets.map((item) => item.instruction)).toEqual([
      "调整保存按钮。",
      "调整个人资料按钮。",
    ]);
    expect(annotation.targets).not.toHaveProperty("0.targetId");

    type AskIsAssignableToChangeAdapter =
      ReturnType<typeof askEnvelope> extends Parameters<
        typeof adaptChangeEnvelopeToSpotAnnotationV3
      >[0]
        ? true
        : false;
    const askIsAssignableToChangeAdapter: AskIsAssignableToChangeAdapter = false;
    expect(askIsAssignableToChangeAdapter).toBe(false);
    expect(() =>
      adaptChangeEnvelopeToSpotAnnotationV3(
        askEnvelope() as unknown as SpotChangeTaskEnvelope,
      ),
    ).toThrow();
  });
});

describe("Contextual Ask answer contracts", () => {
  it("accepts bounded drafts and rejects aggregate answer overflow", () => {
    expect(
      askAnswerDraftSchema.safeParse({
        blocks: [
          {
            kind: "paragraph",
            text: "Answer",
            citations: [{ handleId: "handle-1", startLine: 1, endLine: 3 }],
          },
        ],
        warnings: [],
      }).success,
    ).toBe(true);
    expect(
      askAnswerDraftSchema.safeParse({
        blocks: [
          {
            kind: "paragraph",
            text: "a".repeat(CONTEXTUAL_ASK_LIMITS.maximumAnswerCharacters),
            citations: [{ handleId: "handle-1", startLine: 1, endLine: 3 }],
          },
          {
            kind: "paragraph",
            text: "b",
            citations: [{ handleId: "handle-1", startLine: 1, endLine: 3 }],
          },
        ],
        warnings: [],
      }).success,
    ).toBe(false);
  });

  it("keeps server-observed source warnings out of executor drafts", () => {
    const uncited = {
      blocks: [{ kind: "paragraph", text: "Unknown", citations: [] }],
    } as const;

    expect(
      askAnswerDraftSchema.safeParse({
        ...uncited,
        warnings: [{ code: "insufficient-evidence" }],
      }).success,
    ).toBe(true);
    expect(
      askAnswerDraftSchema.safeParse({
        ...uncited,
        warnings: [{ code: "source-truncated" }],
      }).success,
    ).toBe(false);
    expect(
      askAnswerDraftSchema.safeParse({
        ...uncited,
        warnings: [{ code: "source-stale" }],
      }).success,
    ).toBe(false);
  });

  it("accepts a referenced answer and rejects forged sources or unsafe paths", () => {
    expect(askAnswerResultSchema.safeParse(result()).success).toBe(true);
    expect(
      askAnswerResultSchema.safeParse({
        ...result(),
        blocks: [{ kind: "paragraph", text: "Forged", sourceIds: ["source-x"] }],
      }).success,
    ).toBe(false);
    expect(
      askAnswerDraftSchema.safeParse({
        blocks: [{ kind: "paragraph", text: "Unknown", citations: [] }],
        warnings: [{ code: "insufficient-evidence" }],
      }).success,
    ).toBe(true);
    expect(
      askAnswerResultSchema.safeParse({
        ...result(),
        sources: [{ ...result().sources[0], relativePath: "../secret.env" }],
      }).success,
    ).toBe(false);
    expect(
      askAnswerResultSchema.safeParse({
        ...result(),
        sources: [{ ...result().sources[0], relativePath: "C:/secret.env" }],
      }).success,
    ).toBe(false);
    expect(
      askAnswerResultSchema.safeParse({
        ...result(),
        sources: [result().sources[0], result().sources[0]],
      }).success,
    ).toBe(false);
  });
});

describe("Contextual Ask HTTP and job contracts", () => {
  it("accepts only empty capability/event actions and explicit consent on create", () => {
    expect(contextualAskCapabilityRequestSchema.safeParse({}).success).toBe(true);
    expect(
      contextualAskCapabilityRequestSchema.safeParse({ provider: "openai" }).success,
    ).toBe(false);
    expect(askJobEventsRequestSchema.safeParse({ afterSequence: 0 }).success).toBe(
      true,
    );
    expect(askJobEventsRequestSchema.safeParse({ afterSequence: -1 }).success).toBe(
      false,
    );
    expect(
      askJobCreateRequestSchema.safeParse({
        schemaVersion: 1,
        requestId: "request-1",
        envelope: askEnvelope(),
        executorId: "key-default",
        providerDataConsent: true,
      }).success,
    ).toBe(true);
    expect(
      askJobCreateRequestSchema.safeParse({
        schemaVersion: 1,
        requestId: "request-1",
        envelope: askEnvelope(),
        executorId: "key-default",
        providerDataConsent: false,
      }).success,
    ).toBe(false);
  });

  it("keeps capability state, proof, and sanitized errors consistent", () => {
    const ready = {
      executorId: "key-default",
      kind: "configured-key" as const,
      label: "OpenAI",
      requestedModelLabel: "Configured model",
      effectiveModelLabel: "Configured model",
      state: "ready" as const,
      providerDataConsentRequired: true,
      readOnlyProven: true,
    };
    const capability = {
      schemaVersion: 1 as const,
      enabled: true,
      executors: [ready],
      safety: {
        selectionRequired: true as const,
        singleTurn: true as const,
        writesAllowed: false as const,
        historyStored: false as const,
      },
      checkedAt: now,
    };
    expect(contextualAskCapabilitySchema.safeParse(capability).success).toBe(true);
    expect(
      contextualAskCapabilitySchema.safeParse({
        ...capability,
        executors: [{ ...ready, readOnlyProven: false }],
      }).success,
    ).toBe(false);
    expect(
      contextualAskCapabilitySchema.safeParse({
        ...capability,
        executors: [ready, ready],
      }).success,
    ).toBe(false);
  });

  it("rejects impossible snapshots, result states, and event states", () => {
    expect(askJobSnapshotSchema.safeParse(snapshot()).success).toBe(true);
    expect(
      askJobSnapshotSchema.safeParse({ ...snapshot(), canCancel: false }).success,
    ).toBe(false);
    expect(
      askJobResultResponseSchema.safeParse({
        snapshot: snapshot("answered"),
        result: result(),
      }).success,
    ).toBe(true);
    expect(
      askJobResultResponseSchema.safeParse({ snapshot: snapshot("answered") }).success,
    ).toBe(false);
    expect(
      askJobResultResponseSchema.safeParse({
        snapshot: snapshot(),
        result: result(),
      }).success,
    ).toBe(false);

    const eventBase = {
      schemaVersion: 1 as const,
      sequence: 1,
      jobId: "job-1",
      timestamp: now,
    };
    expect(
      askJobEventSchema.safeParse({
        ...eventBase,
        type: "read-activity",
        status: "running",
        activity: {
          kind: "source",
          sourceId: "source-1",
          relativePath: "src/target-1.tsx",
        },
        state: "succeeded",
      }).success,
    ).toBe(true);
    expect(
      askJobEventSchema.safeParse({
        ...eventBase,
        type: "answer-ready",
        status: "running",
      }).success,
    ).toBe(false);
    expect(
      askJobEventSchema.safeParse({
        ...eventBase,
        type: "error",
        status: "failed",
        errorCode: "ASK_CANCELLED",
      }).success,
    ).toBe(false);
  });
});
