// @vitest-environment jsdom

import type {
  AgentJobResult,
  AgentJobSnapshot,
  RuntimeAiConfig,
} from "@spotpatch/shared";
import { ERROR_CODES } from "@spotpatch/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRuntimeView } from "./runtime-view.js";
import { installDataFlowPanelExtension } from "../data-flow-panel-entry.js";
import { installContextualAskExtension } from "../contextual-ask-panel-entry.js";
import { createExecutionIsland } from "./execution-island.js";
import {
  registerFloatingSurfaceMotionExtension,
  type FloatingSurfaceMotionController,
  type FloatingSurfaceMotionExtension,
} from "./motion-extension-contract.js";
import { UI_MARKER_ATTRIBUTE } from "./ui-constants.js";

function measuredRect(width: number, height: number): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    right: width,
    bottom: height,
    left: 0,
    width,
    height,
    toJSON: () => ({}),
  };
}

const aiConfig = Object.freeze({
  enabled: true as const,
  providers: Object.freeze([
    Object.freeze({
      id: "relay",
      label: "Trusted Relay",
      protocol: "responses" as const,
      models: Object.freeze([Object.freeze({ id: "coder", label: "Coding Model" })]),
      defaultModel: "coder",
    }),
  ]),
  defaultProvider: "relay",
  applyMode: "review" as const,
}) satisfies RuntimeAiConfig;

const trustedFastAiConfig = Object.freeze({
  ...aiConfig,
  applyMode: "trusted-auto" as const,
}) satisfies RuntimeAiConfig;

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis, Symbol.for("spotpatch.motion.v1"));
  Reflect.deleteProperty(globalThis, Symbol.for("spotpatch.contextual-ask.v1"));
  document.querySelectorAll("spotpatch-root").forEach((host) => {
    host.remove();
  });
});

describe("runtime view", () => {
  it("propagates a unique page nonce to Shadow DOM styles", () => {
    const script = document.createElement("script");
    script.nonce = "spotpatch-test-nonce";
    document.head.append(script);
    const view = createRuntimeView(document, "Mod+Shift+S");

    try {
      const styles = view.host.shadowRoot?.querySelectorAll("style");

      expect(styles).toBeDefined();
      expect(styles).not.toHaveLength(0);
      expect(
        styles === undefined
          ? false
          : [...styles].every((style) => style.nonce === script.nonce),
      ).toBe(true);
    } finally {
      view.dispose();
      script.remove();
    }
  });

  it("mounts an accessible direct-input Shadow DOM workbench", () => {
    const view = createRuntimeView(document, "Mod+Shift+S");
    const dialog = view.host.shadowRoot?.querySelector("[role='dialog']");

    expect(view.host.hasAttribute(UI_MARKER_ATTRIBUTE)).toBe(true);
    expect(view.host.shadowRoot?.mode).toBe("open");
    expect(view.triggerButton.textContent).toBe("Select element");
    expect(view.triggerButton.title).toContain("Mod+Shift+S");
    expect(dialog?.getAttribute("aria-labelledby")).toBe("spotpatch-selection-title");
    expect(view.host.shadowRoot?.querySelector(".spotpatch-brand-mark")).not.toBeNull();
    expect(view.openEditorButton.textContent).toBe("Open source");
    expect(view.repositoryLink.href).toBe("https://github.com/huanglvjing/spotpatch");
    expect(view.repositoryLink.target).toBe("_blank");
    expect(view.repositoryLink.rel).toContain("noopener");
    expect(view.previewButton.textContent).toBe("Preview prompt");
    expect(view.copyButton.textContent).toBe("Copy prompt");
    expect(view.closeButton.getAttribute("aria-label")).toBe("Close SpotPatch");
    expect(
      view.host.shadowRoot?.querySelector<HTMLDetailsElement>(".spotpatch-diagnostics")
        ?.open,
    ).toBe(false);
  });

  it("reuses one fixed surface and projects only real Agent states", () => {
    const view = createRuntimeView(document, "Mod+Shift+S", aiConfig);
    const surface = view.host.shadowRoot?.querySelector<HTMLElement>(
      ".spotpatch-floating-surface",
    );
    const dialog =
      view.host.shadowRoot?.querySelector<HTMLElement>(".spotpatch-dialog");
    const execution = view.host.shadowRoot?.querySelector<HTMLButtonElement>(
      ".spotpatch-execution-island",
    );

    if (
      surface === null ||
      surface === undefined ||
      dialog === null ||
      dialog === undefined ||
      execution === null ||
      execution === undefined
    ) {
      throw new Error("Expected the persistent floating surface scenes.");
    }

    expect(surface.contains(view.triggerButton)).toBe(true);
    expect(surface.contains(dialog)).toBe(true);
    expect(surface.contains(execution)).toBe(true);
    expect(surface.dataset.scene).toBe("pill");
    expect(surface.dataset.tone).toBe("neutral");
    expect(view.triggerButton.hidden).toBe(false);
    expect(dialog.hidden).toBe(true);

    view.renderStatus("selected");
    view.showSelection("Browser context: ready", true, true);

    expect(view.triggerButton.hidden).toBe(true);
    expect(view.triggerButton.inert).toBe(true);
    expect(dialog.hidden).toBe(false);
    expect(dialog.inert).toBe(false);
    expect(surface.dataset.scene).toBe("planner");
    expect(surface.dataset.tone).toBe("ready");

    view.renderAgentJob(
      {
        jobId: "0123456789abcdefghijklmn",
        status: "queued",
        providerProfileId: "relay",
        providerLabel: "Trusted Relay",
        modelProfileId: "coder",
        modelLabel: "Coding Model",
        phaseMessage: "Preparing the requested change.",
        createdAt: "2026-08-29T00:00:00.000Z",
        updatedAt: "2026-08-29T00:00:01.000Z",
        canCancel: true,
        canApply: false,
        canRevert: false,
      },
      undefined,
      [],
    );

    expect(surface.dataset.scene).toBe("handoff");
    expect(surface.dataset.tone).toBe("running");
    expect(execution.hidden).toBe(false);
    expect(execution.textContent).toContain("Handing off to Trusted Relay");
    expect(execution.textContent).not.toContain("Coding Model");
    expect(execution.textContent).not.toContain("Preparing the requested change.");
    expect(execution.querySelector(".spotpatch-execution-logo path")).not.toBeNull();
    expect(
      execution.querySelector("#spotpatch-fallback-execution-island-locator-gradient"),
    ).not.toBeNull();

    view.renderAgentJob(
      {
        jobId: "0123456789abcdefghijklmn",
        status: "failed",
        providerProfileId: "relay",
        providerLabel: "Trusted Relay",
        modelProfileId: "coder",
        modelLabel: "Coding Model",
        phaseMessage: "The Agent reported a failure.",
        createdAt: "2026-08-29T00:00:00.000Z",
        updatedAt: "2026-08-29T00:00:02.000Z",
        canCancel: false,
        canApply: false,
        canRevert: false,
      },
      undefined,
      [],
      ERROR_CODES.INTERNAL_ERROR,
    );

    expect(surface.dataset.scene).toBe("failed");
    expect(surface.dataset.tone).toBe("danger");

    execution.click();
    expect(surface.dataset.scene).toBe("planner");
    expect(dialog.hidden).toBe(false);
  });

  it("waits for a real Agent job before leaving the planner", () => {
    const view = createRuntimeView(document, "Mod+Shift+S", aiConfig);
    const surface = view.host.shadowRoot?.querySelector<HTMLElement>(
      ".spotpatch-floating-surface",
    );

    view.renderStatus("selected");
    view.showSelection("Browser context: ready", true, true);
    view.agentRunButton.disabled = false;
    view.agentRunButton.click();

    expect(surface?.dataset.scene).toBe("planner");

    view.renderAgentCapability(
      "error",
      "The Agent is unavailable.",
      undefined,
      ERROR_CODES.INTERNAL_ERROR,
    );

    expect(surface?.dataset.scene).toBe("planner");
  });

  it("captures the expanded geometry before returning execution to the planner", () => {
    const expandedAtPlannerTransition: boolean[] = [];
    const extension: FloatingSurfaceMotionExtension = {
      createExecutionIsland,
      createStyles(currentDocument) {
        return currentDocument.createElement("style");
      },
      createController(_document, elements, reconcile) {
        const controller: FloatingSurfaceMotionController = {
          cancel: () => undefined,
          dispatch: () => undefined,
          dispose: () => undefined,
          render(projection, renderContent) {
            if (projection.scene === "planner") {
              expandedAtPlannerTransition.push(
                elements.execution.root.dataset.expanded === "true",
              );
            }
            renderContent();
            const pillActive =
              projection.scene === "pill" || projection.scene === "capturing";
            const plannerActive = projection.scene === "planner";
            elements.pill.hidden = !pillActive;
            elements.planner.hidden = !plannerActive;
            elements.execution.root.hidden = pillActive || plannerActive;
            elements.surface.dataset.scene = projection.scene;
            reconcile();
          },
          updateLayout(updateContent) {
            updateContent();
            reconcile();
          },
        };
        return Object.freeze(controller);
      },
    };
    registerFloatingSurfaceMotionExtension(Object.freeze(extension));
    const view = createRuntimeView(document, "Mod+Shift+S", aiConfig);
    view.renderStatus("selected");
    view.showSelection("Browser context: ready", true, true);
    view.renderAgentJob(
      {
        jobId: "0123456789abcdefghijklmn",
        status: "running",
        providerProfileId: "relay",
        providerLabel: "Trusted Relay",
        modelProfileId: "coder",
        modelLabel: "Coding Model",
        phaseMessage: "Applying the requested change.",
        createdAt: "2026-08-29T00:00:00.000Z",
        updatedAt: "2026-08-29T00:00:01.000Z",
        canCancel: true,
        canApply: false,
        canRevert: false,
      },
      undefined,
      [
        {
          detail: "src/fixtures.tsx",
          key: "read:fixtures",
          kind: "read",
          label: "Read src/fixtures.tsx",
          state: "success",
        },
      ],
    );
    const execution = view.host.shadowRoot?.querySelector<HTMLButtonElement>(
      ".spotpatch-execution-island",
    );

    execution?.click();
    expect(execution?.getAttribute("aria-expanded")).toBe("true");
    execution?.click();

    expect(expandedAtPlannerTransition.at(-1)).toBe(true);
    expect(execution?.getAttribute("aria-expanded")).toBe("false");
    view.dispose();
  });

  it("maps every built-in Agent status without inventing progress", () => {
    const view = createRuntimeView(document, "Mod+Shift+S", aiConfig);
    const surface = view.host.shadowRoot?.querySelector<HTMLElement>(
      ".spotpatch-floating-surface",
    );
    view.renderStatus("selected");
    view.showSelection("Browser context: ready", true, true);

    for (const [status, expectedScene] of [
      ["queued", "handoff"],
      ["preparing", "handoff"],
      ["running", "running"],
      ["validating", "running"],
      ["awaiting-review", "success"],
      ["applying", "running"],
      ["applied", "success"],
      ["completed", "success"],
      ["cancelling", "running"],
      ["cancelled", "planner"],
      ["reverting", "running"],
      ["reverted", "success"],
      ["failed", "failed"],
    ] as const) {
      view.renderAgentJob(
        {
          jobId: "0123456789abcdefghijklmn",
          status,
          providerProfileId: "relay",
          providerLabel: "Trusted Relay",
          modelProfileId: "coder",
          modelLabel: "Coding Model",
          phaseMessage: `Phase: ${status}`,
          createdAt: "2026-08-29T00:00:00.000Z",
          updatedAt: "2026-08-29T00:00:01.000Z",
          canCancel: false,
          canApply: false,
          canRevert: false,
        },
        undefined,
        [],
      );
      expect(surface?.dataset.scene, status).toBe(expectedScene);
      expect(surface?.textContent).not.toMatch(/\b\d{1,3}%\b/u);
    }
  });

  it("renders collected text through textContent rather than HTML", () => {
    const view = createRuntimeView(document, "Mod+Shift+S");
    const hostile = '<img src=x onerror="globalThis.compromised=true">';
    view.showSelection(hostile, false, false);
    const summary = view.host.shadowRoot?.querySelector(".spotpatch-summary");

    expect(summary?.textContent).toBe(hostile);
    expect(summary?.querySelector("img")).toBeNull();
    expect(view.openEditorButton.disabled).toBe(true);
  });

  it("renders a bounded target tray and persistent numbered highlights as inert content", () => {
    const view = createRuntimeView(document, "Mod+Shift+S");
    const hostile = '<img src=x onerror="globalThis.compromised=true">';

    view.renderTargets(
      [
        {
          id: "target-1",
          canOpenEditor: true,
          instruction: "Align the first target.",
          label: hostile,
          source: "src/First.tsx:10:2",
          status: "ready",
          active: false,
        },
        {
          id: "target-2",
          canOpenEditor: false,
          instruction: "",
          label: "SecondAction",
          source: "src/Second.tsx:20:3",
          status: "loading",
          active: true,
        },
      ],
      8,
    );
    view.showSelectionHighlights([
      {
        id: "target-1",
        label: hostile,
        rect: { x: 10, y: 20, width: 100, height: 40 },
        active: false,
      },
      {
        id: "target-2",
        label: "SecondAction",
        rect: { x: 200, y: 20, width: 100, height: 40 },
        active: true,
      },
    ]);

    expect(view.targetList.querySelectorAll(".spotpatch-target-item")).toHaveLength(2);
    expect(view.targetList.textContent).toContain(hostile);
    expect(view.targetList.querySelector("img")).toBeNull();
    const openButtons = view.targetList.querySelectorAll<HTMLButtonElement>(
      "button[data-open-target-id]",
    );
    expect(openButtons).toHaveLength(2);
    expect(openButtons[0]?.disabled).toBe(false);
    expect(openButtons[0]?.getAttribute("aria-label")).toBe("Open source for target 1");
    expect(openButtons[1]?.disabled).toBe(true);
    expect(
      view.host.shadowRoot?.querySelectorAll(".spotpatch-selection-highlight"),
    ).toHaveLength(2);
    expect(
      view.host.shadowRoot?.querySelector(
        '.spotpatch-selection-highlight[data-active="true"]',
      )?.textContent,
    ).toContain("2 · SecondAction");
    const progress = view.host.shadowRoot?.querySelector<HTMLElement>(
      ".spotpatch-target-progress-fill",
    );
    expect(progress?.style.width).toBe("50%");
    view.updateTargetInstruction("target-2", "Align the second target.");
    expect(progress?.style.width).toBe("100%");

    view.showSelection("Summary", true, false);
    view.setAgentEditingEnabled(false);
    expect(
      view.targetList.querySelector<HTMLButtonElement>("button[data-remove-target-id]")
        ?.disabled,
    ).toBe(true);
    expect(view.addTargetButton.disabled).toBe(true);
    expect(view.addTargetButton.classList.contains("spotpatch-icon-action")).toBe(true);
    expect(view.openEditorButton.disabled).toBe(false);
    expect(openButtons[0]?.disabled).toBe(false);
    expect(openButtons[1]?.disabled).toBe(true);
  });

  it("shows visible localized editor launch feedback", () => {
    const view = createRuntimeView(
      document,
      "Mod+Shift+S",
      Object.freeze({ enabled: false }),
      "zh-CN",
    );
    const feedback = view.host.shadowRoot?.querySelector<HTMLElement>(
      ".spotpatch-editor-feedback",
    );

    view.renderEditorStatus("opening");
    expect(feedback?.hidden).toBe(false);
    expect(feedback?.dataset.state).toBe("opening");
    expect(feedback?.textContent).toBe("正在打开源码……");

    view.renderEditorStatus("error");
    expect(feedback?.dataset.state).toBe("error");
    expect(feedback?.textContent).toContain("无法打开编辑器");
  });

  it("keeps a distinct active-target instruction and previews content as plain text", () => {
    const view = createRuntimeView(document, "Mod+Shift+S");
    const hostile = "```html\n<img src=x onerror=attack()>";

    view.renderStatus("selected");
    expect(view.triggerButton.hidden).toBe(true);
    view.renderTargets(
      [
        {
          id: "target-1",
          canOpenEditor: true,
          instruction: "Existing instruction",
          label: "PrimaryAction",
          source: "src/App.tsx:1:1",
          status: "ready",
          active: true,
        },
      ],
      8,
    );
    expect(
      view.targetList.querySelector<HTMLTextAreaElement>(
        "textarea[data-target-instruction-id='target-1']",
      )?.value,
    ).toBe("Existing instruction");
    view.focusTargetInstruction("target-1");
    view.renderTargets(
      [
        {
          id: "target-1",
          canOpenEditor: true,
          instruction: "Existing instruction",
          label: "PrimaryAction",
          source: "src/App.tsx:1:1",
          status: "ready",
          active: true,
        },
      ],
      8,
    );
    expect(view.host.shadowRoot?.activeElement).toBe(
      view.targetList.querySelector("textarea[data-target-instruction-id='target-1']"),
    );
    expect(view.host.shadowRoot?.querySelector(".spotpatch-title")?.textContent).toBe(
      "Plan the change",
    );

    view.renderStatus("previewing");
    expect(view.triggerButton.hidden).toBe(true);
    view.showPreview(hostile);
    const preview = view.host.shadowRoot?.querySelector(".spotpatch-prompt");
    expect(preview?.textContent).toBe(hostile);
    expect(preview?.querySelector("img")).toBeNull();
    expect(preview?.getAttribute("tabindex")).toBe("0");
    expect(view.host.shadowRoot?.querySelector(".spotpatch-title")?.textContent).toBe(
      "Review the request",
    );

    view.renderStatus("inspecting");
    expect(view.triggerButton.hidden).toBe(false);
  });

  it("shows the shared instruction budget and marks an over-limit multi-target request", () => {
    const view = createRuntimeView(document, "Mod+Shift+S");
    const targets = ["target-1", "target-2", "target-3"].map((id, index) => ({
      id,
      canOpenEditor: true,
      instruction: String(index).repeat(1_500),
      label: `Target${String(index + 1)}`,
      source: `src/Target${String(index + 1)}.tsx:1:1`,
      status: "ready" as const,
      active: index === 0,
    }));

    view.renderTargets(targets, 8);

    const budget = view.host.shadowRoot?.querySelector<HTMLElement>(
      ".spotpatch-target-budget",
    );
    expect(budget?.dataset.state).toBe("over");
    expect(budget?.textContent).toContain("4500 / 4000");
    expect(
      view.targetList.querySelector<HTMLTextAreaElement>(
        "textarea[data-target-instruction-id='target-1']",
      )?.maxLength,
    ).toBe(2_000);
  });

  it("keeps the workbench at its floating position when selections change", () => {
    const view = createRuntimeView(document, "Mod+Shift+S");
    const surface = view.host.shadowRoot?.querySelector<HTMLElement>(
      ".spotpatch-floating-surface",
    );

    if (surface === null || surface === undefined) {
      throw new Error("Expected the persistent floating surface.");
    }

    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(measuredRect(460, 500));
    view.renderStatus("selected");
    view.showHighlight({ x: 40, y: 70, width: 900, height: 650 }, "<main.hero>");
    view.showSelection("Source: src/main.tsx:1:1", true, false);

    view.showSelectionHighlights([
      {
        id: "target-1",
        label: "Page A target",
        rect: { x: 20, y: 20, width: 120, height: 40 },
        active: true,
      },
    ]);
    expect(surface.style.left).toBe("540px");
    expect(surface.style.top).toBe("244px");
    expect(surface.dataset.floatingPositioned).toBe("true");

    view.hideSelectionHighlights();

    expect(surface.style.left).toBe("540px");
    expect(surface.style.top).toBe("244px");
  });

  it("gates Agent execution on context, capability, and explicit provider consent", () => {
    const view = createRuntimeView(document, "Mod+Shift+S", aiConfig);

    view.renderStatus("selected");
    view.showSelection("Browser context: ready", true, true);

    expect(view.readAgentSelection()).toEqual({
      applyMode: "review",
      providerProfileId: "relay",
      modelProfileId: "coder",
    });
    expect(view.agentProviderSelect.tagName).toBe("SELECT");
    expect(view.agentProviderSelect.value).toBe("relay");
    expect(view.agentProviderSelect.selectedOptions[0]?.textContent).toBe(
      "Trusted Relay",
    );
    expect(view.agentModelSelect.tagName).toBe("SELECT");
    expect(view.agentModelSelect.value).toBe("coder");
    expect(view.agentModelSelect.selectedOptions[0]?.textContent).toBe("Coding Model");
    expect(view.agentProviderSelect.getAttribute("aria-label")).toBe("AI provider");
    expect(view.agentModelSelect.getAttribute("aria-label")).toBe("AI model");
    const styles = Array.from(view.host.shadowRoot?.querySelectorAll("style") ?? [])
      .map((style) => style.textContent)
      .join("\n");
    expect(styles).toContain("color-scheme: dark");
    expect(styles).toContain(".spotpatch-agent select option");
    expect(styles).toContain("appearance: base-select");
    expect(styles).toContain(".spotpatch-agent select::picker(select):popover-open");
    expect(styles).toMatch(/select::picker\(select\)[^{]*\{[^}]*opacity: 1;/u);
    expect(styles).toContain("@starting-style");
    expect(view.agentRunButton.disabled).toBe(true);
    expect(view.agentRunButton.textContent).toBe("Run AI");
    expect(view.previewButton.classList.contains("spotpatch-primary")).toBe(true);
    expect(view.host.shadowRoot?.textContent).toContain(
      "selected context and allowed source may be sent to Trusted Relay",
    );

    view.setAgentProviderConsent(true);
    view.renderAgentWorkspaceHealth("ready", {
      state: "ready",
      checkedAt: "2026-08-07T00:00:00.000Z",
      changes: {
        staged: 0,
        unstaged: 0,
        untracked: 0,
        conflicted: 0,
        total: 0,
      },
      canIncludeLocalChanges: false,
    });
    view.renderAgentCapability(
      "probing",
      "Testing authentication, tools, continuation, and streaming…",
    );
    expect(view.agentTestButton.disabled).toBe(true);
    expect(view.agentRunButton.disabled).toBe(true);
    expect(view.agentRunButton.textContent).toBe("Verifying…");

    view.renderAgentCapability("ready", "Agent capability verified", {
      providerProfileId: "relay",
      providerLabel: "Trusted Relay",
      modelProfileId: "coder",
      modelLabel: "Coding Model",
      protocol: "responses",
      state: "agent-ready",
      authenticated: true,
      modelAvailable: true,
      toolCalling: true,
      toolResultContinuation: true,
      streaming: true,
      checkedAt: "2026-08-07T00:00:00.000Z",
    });
    expect(view.agentRunButton.disabled).toBe(false);
    expect(view.agentRunButton.textContent).toBe("Run AI");
    expect(view.agentRunButton.classList.contains("spotpatch-primary")).toBe(true);
    expect(view.previewButton.classList.contains("spotpatch-primary")).toBe(false);

    view.renderAgentWorkspaceHealth("consent-required", {
      state: "consent-required",
      checkedAt: "2026-08-07T00:00:02.000Z",
      changes: {
        staged: 1,
        unstaged: 2,
        untracked: 1,
        conflicted: 0,
        total: 3,
      },
      canIncludeLocalChanges: true,
    });
    expect(view.agentRunButton.disabled).toBe(true);
    expect(view.agentWorkspaceConsentCheckbox.closest("label")?.hidden).toBe(false);
    expect(view.host.shadowRoot?.textContent).toContain(
      "Local changes found · 1 staged · 2 unstaged · 1 untracked",
    );
    view.agentWorkspaceConsentCheckbox.checked = true;
    view.agentWorkspaceConsentCheckbox.dispatchEvent(
      new Event("change", { bubbles: true }),
    );
    expect(view.agentRunButton.disabled).toBe(false);

    view.renderAgentWorkspaceHealth("blocked", {
      state: "blocked",
      checkedAt: "2026-08-07T00:00:03.000Z",
      changes: {
        staged: 1,
        unstaged: 2,
        untracked: 1,
        conflicted: 1,
        total: 3,
      },
      canIncludeLocalChanges: false,
      errorCode: ERROR_CODES.WORKTREE_CONFLICTED,
    });
    expect(view.agentRunButton.disabled).toBe(true);
    expect(view.host.shadowRoot?.textContent).toContain(
      "Resolve all Git conflicts before running AI",
    );
  });

  it("uses one session consent for trusted fast mode and local changes", () => {
    const view = createRuntimeView(
      document,
      "Mod+Shift+S",
      trustedFastAiConfig,
      "zh-CN",
    );

    view.renderStatus("selected");
    view.showSelection("Browser context: ready", true, true);
    view.agentModeSelect.value = "trusted-auto";
    view.agentModeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    view.renderAgentWorkspaceHealth("consent-required", {
      state: "consent-required",
      checkedAt: "2026-08-11T00:00:00.000Z",
      changes: {
        staged: 1,
        unstaged: 2,
        untracked: 1,
        conflicted: 0,
        total: 3,
      },
      canIncludeLocalChanges: true,
    });

    expect(view.host.shadowRoot?.textContent).toContain("可信极速模式");
    expect(view.host.shadowRoot?.textContent).toContain("包括删除文件与配置变更");
    expect(view.readAgentSelection()?.applyMode).toBe("trusted-auto");
    expect(view.agentWorkspaceConsentCheckbox.closest("label")?.hidden).toBe(true);
    expect(view.agentWorkspaceConsentGranted()).toBe(false);
    expect(view.agentRunButton.disabled).toBe(true);

    view.setAgentProviderConsent(true);

    expect(view.agentConsentGranted()).toBe(true);
    expect(view.agentWorkspaceConsentGranted()).toBe(true);
    expect(view.agentRunButton.disabled).toBe(false);
  });

  it("renders a complete Chinese interface and switches language without losing target drafts", () => {
    const view = createRuntimeView(document, "Mod+Shift+S", aiConfig, "zh-CN");
    view.renderStatus("selected");
    view.renderTargets(
      [
        {
          id: "target-1",
          canOpenEditor: true,
          instruction: "保留已有内容",
          label: "PrimaryAction",
          source: "src/App.tsx:1:1",
          status: "ready",
          active: true,
        },
      ],
      8,
    );

    expect(view.triggerButton.textContent).toBe("选择元素");
    expect(view.host.shadowRoot?.textContent).toContain("规划本次修改");
    expect(view.host.shadowRoot?.textContent).toContain("修改目标");
    view.host.shadowRoot
      ?.querySelector<HTMLButtonElement>(".spotpatch-locale")
      ?.click();
    expect(view.triggerButton.textContent).toBe("Select element");
    expect(
      view.targetList.querySelector<HTMLTextAreaElement>(
        "textarea[data-target-instruction-id='target-1']",
      )?.value,
    ).toBe("保留已有内容");
  });

  it("renders provider-controlled Agent output only as inert text", () => {
    const view = createRuntimeView(document, "Mod+Shift+S", aiConfig);
    const jobId = "0123456789abcdefghijklmn";
    const snapshot = Object.freeze({
      jobId,
      status: "awaiting-review",
      providerProfileId: "relay",
      providerLabel: "Trusted Relay",
      modelProfileId: "coder",
      modelLabel: "Coding Model",
      phaseMessage: "Review the validated patch.",
      createdAt: "2026-08-07T00:00:00.000Z",
      updatedAt: "2026-08-07T00:00:01.000Z",
      canCancel: true,
      canApply: true,
      canRevert: false,
    }) satisfies AgentJobSnapshot;
    const hostile = '<img src=x onerror="globalThis.compromised=true">';
    const result = Object.freeze({
      jobId,
      summary: hostile,
      diff: `+${hostile}`,
      files: Object.freeze([
        Object.freeze({
          relativePath: `src/${hostile}.tsx`,
          kind: "modified",
          additions: 1,
          deletions: 0,
        }),
      ]),
      checks: Object.freeze([
        Object.freeze({
          checkId: "typecheck",
          label: "Typecheck",
          status: "failed",
          durationMs: 8,
          output: hostile,
        }),
      ]),
    }) satisfies AgentJobResult;

    view.renderStatus("selected");
    view.showSelection("Browser context: ready", true, true);
    view.renderAgentJob(snapshot, result, [], undefined);

    const agent = view.host.shadowRoot?.querySelector(".spotpatch-agent");
    expect(agent?.textContent).toContain(hostile);
    expect(agent?.querySelector("img")).toBeNull();
    expect(
      view.host.shadowRoot?.querySelector(".spotpatch-agent-diff")?.textContent,
    ).toBe(`+${hostile}`);
    expect(view.agentApplyButton.hidden).toBe(false);
    expect(view.agentRevertButton.hidden).toBe(true);
  });

  it("mounts when the full data-flow extension synchronously requests layout", () => {
    installDataFlowPanelExtension();

    const view = createRuntimeView(
      document,
      "Mod+Shift+S",
      Object.freeze({ enabled: false }),
      "auto",
      true,
    );
    const surface = view.host.shadowRoot?.querySelector<HTMLElement>(
      ".spotpatch-floating-surface",
    );

    expect(view.host.isConnected).toBe(true);
    expect(surface?.dataset.scene).toBe("pill");
    expect(view.triggerButton.hidden).toBe(false);
  });

  it("mounts the optional Ask extension without a construction-time render race", () => {
    installContextualAskExtension();
    const view = createRuntimeView(
      document,
      "Mod+Shift+S",
      Object.freeze({ enabled: false }),
      "en-US",
      false,
      false,
      "vite",
      "runtime-session",
      true,
    );
    view.renderStatus("selected");
    view.showSelection("Browser context: ready", true, true);
    const root = view.host.shadowRoot;

    expect(root?.querySelector(".spotpatch-title")?.textContent).toBe(
      "Plan the change",
    );
    root?.querySelectorAll<HTMLButtonElement>("[role=tab]").item(0).click();
    expect(root?.querySelector(".spotpatch-title")?.textContent).toBe(
      "Ask about this selection",
    );
  });
});
