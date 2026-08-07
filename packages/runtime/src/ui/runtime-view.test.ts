// @vitest-environment jsdom

import type {
  AgentJobResult,
  AgentJobSnapshot,
  RuntimeAiConfig,
} from "@spotpatch/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRuntimeView } from "./runtime-view.js";
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

afterEach(() => {
  vi.restoreAllMocks();
  document.querySelectorAll("spotpatch-root").forEach((host) => {
    host.remove();
  });
});

describe("runtime view", () => {
  it("mounts an accessible direct-input Shadow DOM workbench", () => {
    const view = createRuntimeView(document, "Mod+Shift+S");
    const dialog = view.host.shadowRoot?.querySelector("[role='dialog']");

    expect(view.host.hasAttribute(UI_MARKER_ATTRIBUTE)).toBe(true);
    expect(view.host.shadowRoot?.mode).toBe("open");
    expect(view.triggerButton.textContent).toBe("Select element");
    expect(view.triggerButton.title).toContain("Mod+Shift+S");
    expect(dialog?.getAttribute("aria-labelledby")).toBe("spotpatch-selection-title");
    expect(view.noteInput.getAttribute("id")).toBe("spotpatch-change-note");
    expect(view.openEditorButton.textContent).toBe("Open in VS Code");
    expect(view.previewButton.textContent).toBe("Preview prompt");
    expect(view.copyButton.textContent).toBe("Copy prompt");
    expect(view.closeButton.getAttribute("aria-label")).toBe("Close SpotPatch");
    expect(
      view.host.shadowRoot?.querySelector<HTMLDetailsElement>(".spotpatch-diagnostics")
        ?.open,
    ).toBe(false);
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

  it("keeps the annotation input available and previews content as plain text", () => {
    const view = createRuntimeView(document, "Mod+Shift+S");
    const hostile = "```html\n<img src=x onerror=attack()>";

    view.renderStatus("selected");
    view.noteInput.value = "Existing instruction";
    expect(view.readNote()).toBe("Existing instruction");
    expect(view.host.shadowRoot?.querySelector(".spotpatch-title")?.textContent).toBe(
      "Describe the change",
    );

    view.renderStatus("previewing");
    view.showPreview(hostile);
    const preview = view.host.shadowRoot?.querySelector(".spotpatch-prompt");
    expect(preview?.textContent).toBe(hostile);
    expect(preview?.querySelector("img")).toBeNull();
    expect(preview?.getAttribute("tabindex")).toBe("0");
    expect(view.host.shadowRoot?.querySelector(".spotpatch-title")?.textContent).toBe(
      "Prompt ready",
    );
  });

  it("centers the workbench inside a large selected element", () => {
    const view = createRuntimeView(document, "Mod+Shift+S");
    const dialog =
      view.host.shadowRoot?.querySelector<HTMLElement>(".spotpatch-dialog");

    if (dialog === null || dialog === undefined) {
      throw new Error("Expected the contextual workbench.");
    }

    vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue(measuredRect(460, 500));
    view.renderStatus("selected");
    view.showHighlight({ x: 40, y: 70, width: 900, height: 650 }, "<main.hero>");
    view.showSelection("Source: src/main.tsx:1:1", true, false);

    expect(dialog.dataset.placement).toBe("center");
    expect(dialog.style.left).toBe("260px");
    expect(dialog.style.top).toBe("145px");
  });

  it("repositions when the diagnostic disclosure changes the workbench size", () => {
    const view = createRuntimeView(document, "Mod+Shift+S");
    const dialog =
      view.host.shadowRoot?.querySelector<HTMLElement>(".spotpatch-dialog");
    const diagnostics = view.host.shadowRoot?.querySelector<HTMLDetailsElement>(
      ".spotpatch-diagnostics",
    );

    if (
      dialog === null ||
      dialog === undefined ||
      diagnostics === null ||
      diagnostics === undefined
    ) {
      throw new Error("Expected the contextual workbench diagnostics.");
    }

    vi.spyOn(dialog, "getBoundingClientRect").mockImplementation(() =>
      measuredRect(460, diagnostics.open ? 620 : 480),
    );
    view.renderStatus("selected");
    view.showHighlight({ x: 40, y: 70, width: 900, height: 650 }, "<main.hero>");
    view.showSelection("Source: src/main.tsx:1:1", true, false);
    expect(dialog.dataset.placement).toBe("center");

    diagnostics.open = true;
    diagnostics.dispatchEvent(new Event("toggle"));

    expect(dialog.dataset.placement).toBe("viewport");
    expect(dialog.style.top).toBe("85px");
  });

  it("gates Agent execution on context, capability, and explicit provider consent", () => {
    const view = createRuntimeView(document, "Mod+Shift+S", aiConfig);

    view.renderStatus("selected");
    view.showSelection("Browser context: ready", true, true);

    expect(view.readAgentSelection()).toEqual({
      providerProfileId: "relay",
      modelProfileId: "coder",
    });
    expect(view.agentProviderSelect.textContent).toBe("Trusted Relay");
    expect(view.agentModelSelect.textContent).toBe("Coding Model");
    expect(view.agentRunButton.disabled).toBe(true);
    expect(view.agentRunButton.textContent).toBe("Verify & run");
    expect(view.previewButton.classList.contains("spotpatch-primary")).toBe(true);
    expect(view.host.shadowRoot?.textContent).toContain(
      "selected context and allowed source may be sent to Trusted Relay",
    );

    view.setAgentProviderConsent(true);
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
});
