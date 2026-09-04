// @vitest-environment jsdom

import type {
  AskAnswerResult,
  AskJobSnapshot,
  ContextualAskCapability,
} from "@spotpatch/shared/contextual-ask-browser";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ContextualAskApi } from "../api/contextual-ask-api.js";
import { createContextualAskPanel } from "../ui/contextual-ask-panel.js";
import { createContextualAskWorkflow } from "./contextual-ask-workflow.js";

const capability: ContextualAskCapability = {
  schemaVersion: 1,
  enabled: true,
  executors: [
    {
      executorId: "configured-key-relay-coder",
      kind: "configured-key",
      label: "Trusted Relay",
      requestedModelLabel: "Coder",
      effectiveModelLabel: "Coder",
      state: "ready",
      providerDataConsentRequired: true,
      readOnlyProven: true,
    },
  ],
  safety: {
    selectionRequired: true,
    singleTurn: true,
    writesAllowed: false,
    historyStored: false,
  },
  checkedAt: "2026-09-02T00:00:00.000Z",
};

const queued: AskJobSnapshot = {
  schemaVersion: 1,
  jobId: "ask_job_1",
  selectionId: "selection_1",
  status: "queued",
  executor: {
    executorId: "configured-key-relay-coder",
    kind: "configured-key",
    label: "Trusted Relay",
    modelLabel: "Coder",
  },
  createdAt: "2026-09-02T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
  canCancel: true,
};

const answer: AskAnswerResult = {
  schemaVersion: 1,
  jobId: queued.jobId,
  selectionId: queued.selectionId,
  contextHash: "a".repeat(64),
  executor: queued.executor,
  blocks: [
    {
      kind: "paragraph",
      text: "This button submits the form.",
      sourceIds: ["source_1"],
    },
  ],
  sources: [
    {
      sourceId: "source_1",
      label: "Submit button",
      relativePath: "src/Form.tsx",
      fileId: "file_form",
      startLine: 12,
      endLine: 16,
      confidence: "exact",
      targetIds: ["target_1"],
      contentHash: "b".repeat(64),
    },
  ],
  warnings: [],
  createdAt: "2026-09-02T00:00:02.000Z",
  expiresAt: "2026-09-02T00:05:02.000Z",
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("Contextual Ask workflow", () => {
  it("runs one read-only turn, preserves the submitted question, and converts locally", async () => {
    const answered: AskJobSnapshot = {
      ...queued,
      status: "answered",
      updatedAt: answer.createdAt,
      canCancel: false,
    };
    const createJob = vi.fn<ContextualAskApi["createJob"]>().mockResolvedValue(queued);
    const api: ContextualAskApi = {
      capability: vi.fn<ContextualAskApi["capability"]>().mockResolvedValue(capability),
      cancelJob: vi.fn<ContextualAskApi["cancelJob"]>(),
      cancelPending: vi.fn(),
      createJob,
      dispose: vi.fn(),
      events: vi
        .fn<ContextualAskApi["events"]>()
        .mockImplementation((jobId, _afterSequence, onEvent) => {
          onEvent({
            schemaVersion: 1,
            sequence: 1,
            jobId,
            status: "answered",
            timestamp: answer.createdAt,
            type: "answer-ready",
          });
          return Promise.resolve();
        }),
      result: vi
        .fn<ContextualAskApi["result"]>()
        .mockResolvedValue({ snapshot: answered, result: answer }),
    };
    const changeRoot = document.createElement("div");
    const changeActions = document.createElement("footer");
    const announce = vi.fn();
    const panel = createContextualAskPanel({
      document,
      locale: () => "en-US",
      subscribeLocale: () => () => undefined,
      changeRoot,
      changeActions,
      announce,
      onModeChange: vi.fn(),
      onExecutionChange: vi.fn(),
      onViewChange: vi.fn(),
    });
    document.body.append(panel.root, changeRoot, changeActions);
    panel.setSelectionPreview({ contextReady: true, targetCount: 1, sourceCount: 1 });
    const onConvert = vi.fn();
    const workflow = createContextualAskWorkflow({
      api,
      createId: vi.fn(() => "request_or_task_1"),
      fetch: vi.fn<typeof fetch>(),
      getSelection: () => ({
        locale: "en-US",
        targets: [
          {
            id: "target_1",
            instruction: "Keep this unrelated Change draft.",
            page: {
              url: "http://localhost:4173/",
              pathname: "/",
              title: "Fixture",
              viewportWidth: 1440,
              viewportHeight: 900,
              devicePixelRatio: 2,
            },
            source: {
              origin: "jsx-host",
              confidence: "exact",
              fileId: "file_form",
              relativePath: "src/Form.tsx",
              line: 12,
              column: 1,
            },
            react: { supported: false, componentStack: [] },
            element: {
              tagName: "button",
              selector: "button[type=submit]",
              sanitizedHtml: '<button type="submit">Save</button>',
              rect: { x: 1, y: 2, width: 100, height: 40 },
            },
            styles: {
              classNames: [],
              matchedRules: [],
              computed: {},
              warnings: [],
            },
          },
        ],
      }),
      onBusyChange: vi.fn(),
      onConvert,
      onOpenSource: vi.fn(() => Promise.resolve()),
      panel,
      sessionToken: "session-token",
    });

    workflow.mount();
    await vi.waitFor(() => {
      expect(panel.readExecutorId()).toBe(capability.executors[0]?.executorId);
    });
    panel.questionInput.value = "What does this component do?";
    panel.questionInput.dispatchEvent(new Event("input"));
    panel.consentCheckbox.click();
    panel.submitButton.click();

    await vi.waitFor(() => {
      expect(createJob).toHaveBeenCalledOnce();
    });
    await vi.waitFor(() => {
      expect(panel.answerPlainText()).toContain("submits the form");
    });
    const request = createJob.mock.calls[0]?.[0];
    expect(request?.envelope.task).toEqual({
      kind: "ask",
      question: "What does this component do?",
    });
    expect(request?.envelope.selection.targets[0]).not.toHaveProperty("instruction");

    panel.convertButton.click();
    expect(onConvert).toHaveBeenCalledWith(
      expect.objectContaining({
        askJobId: "ask_job_1",
        question: "What does this component do?",
        sourceIds: ["source_1"],
      }),
    );
    expect(panel.mode()).toBe("change");
    expect(announce).toHaveBeenCalled();
    workflow.dispose();
  });
});
