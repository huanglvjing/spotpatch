// @vitest-environment jsdom

import type {
  AskAnswerResult,
  ContextualAskCapability,
} from "@spotpatch/shared/contextual-ask-browser";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createContextualAskPanel } from "./contextual-ask-panel.js";
import type { FloatingSurfaceProjection } from "./motion-extension-contract.js";

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

const result: AskAnswerResult = {
  schemaVersion: 1,
  jobId: "ask_job_1",
  selectionId: "selection_1",
  contextHash: "a".repeat(64),
  executor: {
    executorId: "configured-key-relay-coder",
    kind: "configured-key",
    label: "Trusted Relay",
    modelLabel: "Coder",
  },
  blocks: [
    {
      kind: "paragraph",
      text: "<img src=x onerror=alert(1)> This component submits the form.",
      sourceIds: ["source_1"],
    },
    {
      kind: "code",
      code: "const safe = '<script>never executes</script>';",
      language: "tsx",
      sourceIds: ["source_1"],
    },
  ],
  sources: [
    {
      sourceId: "source_1",
      label: "Submit handler",
      relativePath: "src/Form.tsx",
      fileId: "file_form",
      startLine: 12,
      endLine: 24,
      confidence: "exact",
      targetIds: ["target_1"],
      sourceVersion: "version_1",
      contentHash: "b".repeat(64),
    },
  ],
  warnings: [],
  createdAt: "2026-09-02T00:00:00.000Z",
  expiresAt: "2026-09-02T00:05:00.000Z",
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("contextual Ask panel", () => {
  it("localizes server phase events instead of exposing transport text", () => {
    const panel = createContextualAskPanel({
      document,
      locale: () => "zh-CN",
      subscribeLocale: () => () => undefined,
      changeRoot: document.createElement("div"),
      changeActions: document.createElement("footer"),
      announce: vi.fn(),
      onModeChange: vi.fn(),
      onExecutionChange: vi.fn(),
      onViewChange: vi.fn(),
    });
    document.body.append(panel.root);

    panel.renderJob({
      schemaVersion: 1,
      jobId: "ask_job_localized",
      selectionId: "selection_localized",
      status: "running",
      executor: {
        executorId: "ask_managed_codex_v1",
        kind: "managed-codex",
        label: "Managed Codex",
        modelLabel: "gpt-test",
      },
      phaseMessage: "Analyzing the authorized snapshot.",
      createdAt: "2026-09-02T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:01.000Z",
      canCancel: true,
    });
    expect(panel.root.querySelector(".spotpatch-ask-status strong")?.textContent).toBe(
      "正在分析所选源码",
    );

    panel.renderEvent({
      schemaVersion: 1,
      sequence: 1,
      jobId: "ask_job_localized",
      status: "authorizing",
      timestamp: "2026-09-02T00:00:02.000Z",
      type: "phase",
      message: "Authorizing selected sources.",
    });
    expect(panel.root.querySelector(".spotpatch-ask-status strong")?.textContent).toBe(
      "正在验证只读权限",
    );
    panel.dispose();
  });

  it("keeps Ask and Change drafts in one planner and enforces submit prerequisites", () => {
    const changeRoot = document.createElement("div");
    const changeInput = document.createElement("textarea");
    changeInput.value = "Keep my change draft";
    changeRoot.append(changeInput);
    const changeActions = document.createElement("footer");
    let locale: "en-US" | "zh-CN" = "en-US";
    const onExecutionChange = vi.fn<(projection?: FloatingSurfaceProjection) => void>();
    const panel = createContextualAskPanel({
      document,
      locale: () => locale,
      subscribeLocale: () => () => undefined,
      changeRoot,
      changeActions,
      announce: vi.fn(),
      onModeChange: vi.fn(),
      onExecutionChange,
      onViewChange: vi.fn(),
    });
    document.body.append(panel.root, changeRoot, changeActions);

    panel.setSelectionPreview({ contextReady: true, targetCount: 1, sourceCount: 1 });
    panel.renderCapability(capability);
    panel.questionInput.value = "What does this component do?";
    panel.questionInput.dispatchEvent(new Event("input"));
    expect(panel.submitButton.disabled).toBe(true);
    panel.consentCheckbox.click();
    expect(panel.submitButton.disabled).toBe(false);

    panel.setMode("change");
    expect(changeRoot.hidden).toBe(false);
    expect(changeInput.value).toBe("Keep my change draft");
    panel.setMode("ask");
    expect(panel.questionInput.value).toBe("What does this component do?");
    expect(changeRoot.hidden).toBe(true);
    expect(panel.root.querySelectorAll(".spotpatch-ask-heading")).toHaveLength(0);
    expect(panel.newQuestionButton.hidden).toBe(true);

    panel.renderJob({
      schemaVersion: 1,
      jobId: "ask_job_1",
      selectionId: "selection_1",
      status: "running",
      executor: {
        executorId: "configured-key-relay-coder",
        kind: "configured-key",
        label: "Trusted Relay",
        modelLabel: "Coder",
      },
      createdAt: "2026-09-02T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:01.000Z",
      canCancel: true,
    });
    const projection = onExecutionChange.mock.calls.at(-1)?.[0];
    expect(projection).toMatchObject({
      scene: "running",
      headline: "Analyzing selected source",
    });
    expect(JSON.stringify(projection)).not.toMatch(/modify|apply/iu);

    locale = "zh-CN";
    panel.dispose();
  });

  it("keeps unavailable executors out of the selector and explains the stable reason", () => {
    const panel = createContextualAskPanel({
      document,
      locale: () => "en-US",
      subscribeLocale: () => () => undefined,
      changeRoot: document.createElement("div"),
      changeActions: document.createElement("footer"),
      announce: vi.fn(),
      onModeChange: vi.fn(),
      onExecutionChange: vi.fn(),
      onViewChange: vi.fn(),
    });
    document.body.append(panel.root);
    const readyExecutor = capability.executors[0];
    if (readyExecutor === undefined) throw new Error("Missing ready test executor.");

    panel.renderCapability({
      ...capability,
      executors: [
        readyExecutor,
        {
          executorId: "ask_managed_codex_v1",
          kind: "managed-codex",
          label: "Managed Codex",
          requestedModelLabel: "Managed Codex",
          effectiveModelLabel: "Managed Codex",
          state: "unavailable",
          providerDataConsentRequired: true,
          readOnlyProven: false,
          errorCode: "ASK_PROTOCOL_INCOMPATIBLE",
        },
      ],
    });

    expect([...panel.executorSelect.options].map((option) => option.value)).toEqual([
      "configured-key-relay-coder",
    ]);
    expect(
      panel.root.querySelector(".spotpatch-ask-executor-status")?.textContent,
    ).toBe("Managed Codex: The executor protocol is incompatible.");
  });

  it("uses an in-flow custom executor menu and does not open a menu for one choice", () => {
    const panel = createContextualAskPanel({
      document,
      locale: () => "en-US",
      subscribeLocale: () => () => undefined,
      changeRoot: document.createElement("div"),
      changeActions: document.createElement("footer"),
      announce: vi.fn(),
      onModeChange: vi.fn(),
      onExecutionChange: vi.fn(),
      onViewChange: vi.fn(),
    });
    document.body.append(panel.root);
    panel.renderCapability(capability);

    const trigger = panel.root.querySelector<HTMLButtonElement>(
      '.spotpatch-ask-executor[role="combobox"]',
    );
    const menu = panel.root.querySelector<HTMLElement>(".spotpatch-ask-executor-menu");
    expect(trigger?.disabled).toBe(true);
    expect(menu?.hidden).toBe(true);

    const firstExecutor = capability.executors[0];
    if (firstExecutor === undefined) throw new Error("Missing ready test executor.");
    panel.renderCapability({
      ...capability,
      executors: [
        firstExecutor,
        {
          ...firstExecutor,
          executorId: "ask_managed_codex_v1",
          kind: "managed-codex",
          label: "Managed Codex",
          requestedModelLabel: "gpt-test",
          effectiveModelLabel: "gpt-test",
        },
      ],
    });
    expect(trigger?.disabled).toBe(false);
    trigger?.click();
    expect(menu?.hidden).toBe(false);
    const options = [
      ...(menu?.querySelectorAll<HTMLButtonElement>(".spotpatch-ask-executor-option") ??
        []),
    ];
    expect(options).toHaveLength(2);
    options[1]?.click();
    expect(panel.readExecutorId()).toBe("ask_managed_codex_v1");
    expect(menu?.hidden).toBe(true);
    panel.dispose();
  });

  it("selects models with keyboard, preserves refresh selection and locks while busy", () => {
    const panel = createContextualAskPanel({
      document,
      locale: () => "en-US",
      subscribeLocale: () => () => undefined,
      changeRoot: document.createElement("div"),
      changeActions: document.createElement("footer"),
      announce: vi.fn(),
      onModeChange: vi.fn(),
      onExecutionChange: vi.fn(),
      onViewChange: vi.fn(),
    });
    document.body.append(panel.root);
    const first = capability.executors[0];
    if (first === undefined) throw new Error("Missing executor");
    const next = {
      ...capability,
      executors: [
        { ...first, models: ["first", "second"], requestedModelLabel: "first" },
      ],
    };
    panel.renderCapability(next);
    const trigger =
      panel.root.querySelectorAll<HTMLButtonElement>('[role="combobox"]')[1];
    expect(trigger?.disabled).toBe(false);
    expect(panel.readModel()).toBe("first");
    trigger?.focus();
    for (const key of ["ArrowDown", "End", "Enter"])
      trigger?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    expect(panel.readModel()).toBe("second");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    panel.renderCapability(next);
    expect(panel.readModel()).toBe("second");
    panel.setBusy(true);
    expect(trigger?.disabled).toBe(true);
    panel.setBusy(false);
    panel.renderCapability(capability);
    expect(panel.readModel()).toBeUndefined();
    panel.dispose();
  });

  it("renders long answers as inert text and exposes only controlled source buttons", () => {
    const panel = createContextualAskPanel({
      document,
      locale: () => "en-US",
      subscribeLocale: () => () => undefined,
      changeRoot: document.createElement("div"),
      changeActions: document.createElement("footer"),
      announce: vi.fn(),
      onModeChange: vi.fn(),
      onExecutionChange: vi.fn(),
      onViewChange: vi.fn(),
    });
    document.body.append(panel.root);

    panel.renderAnswer(result, false);

    expect(panel.newQuestionButton.hidden).toBe(false);
    expect(panel.root.querySelector("img")).toBeNull();
    expect(panel.root.querySelector("script")).toBeNull();
    expect(panel.root.querySelector("code")?.textContent).toContain("<script>");
    expect(panel.root.querySelectorAll("[data-ask-source-id]").length).toBeGreaterThan(
      0,
    );
    expect(panel.answerPlainText()).toContain("src/Form.tsx:12–24");
    expect(panel.sourceById("source_1")?.fileId).toBe("file_form");
  });

  it("renders the maximum answer text budget without blocking the UI", () => {
    const panel = createContextualAskPanel({
      document,
      locale: () => "en-US",
      subscribeLocale: () => () => undefined,
      changeRoot: document.createElement("div"),
      changeActions: document.createElement("footer"),
      announce: vi.fn(),
      onModeChange: vi.fn(),
      onExecutionChange: vi.fn(),
      onViewChange: vi.fn(),
    });
    document.body.append(panel.root);
    const longText = "A".repeat(40_000);
    const startedAt = performance.now();
    panel.renderAnswer(
      {
        ...result,
        blocks: [{ kind: "paragraph", text: longText, sourceIds: ["source_1"] }],
      },
      false,
    );
    const durationMs = performance.now() - startedAt;

    expect(panel.root.querySelector(".spotpatch-ask-blocks")?.textContent).toContain(
      longText,
    );
    expect(durationMs).toBeLessThan(250);
  });
});
