// @vitest-environment jsdom

import {
  SOURCE_MARKER_ATTRIBUTE,
  SPOTPATCH_API_BASE,
  type CodeContext,
  type ContextBudget,
  type SpotAnnotation,
} from "@spotpatch/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeApi } from "../api/runtime-api.js";
import { createController } from "./runtime-controller.js";
import type { RuntimeConfig } from "./runtime-config.js";

const budget = Object.freeze({
  totalCharacters: 100,
  domCharacters: 20,
  cssCharacters: 20,
  codeCharacters: 40,
  maxCodeLines: 12,
  maxComponentDepth: 4,
}) satisfies ContextBudget;

const config = Object.freeze({
  apiBase: SPOTPATCH_API_BASE,
  ai: Object.freeze({ enabled: false }),
  budget,
  debug: false,
  editor: "auto",
  framework: "vite",
  frameworkVersion: "7.3.6",
  locale: "en-US",
  maxTargets: 8,
  redact: true,
  sessionId: "runtime-session-id-0000",
  sessionToken: "runtime-session-token",
  shortcut: "Mod+Shift+S",
  spotPatchVersion: "0.0.0",
}) satisfies RuntimeConfig;

const context = Object.freeze({
  relativePath: "src/App.tsx",
  language: "tsx",
  startLine: 1,
  endLine: 12,
  excerpt: "export function App() {}",
  boundary: "component",
}) satisfies CodeContext;

function createApi(): RuntimeApi {
  return {
    agentCapability: vi.fn<RuntimeApi["agentCapability"]>(),
    agentWorkspaceHealth: vi.fn<RuntimeApi["agentWorkspaceHealth"]>().mockResolvedValue(
      Object.freeze({
        state: "ready",
        checkedAt: "2026-08-08T00:00:00.000Z",
        changes: Object.freeze({
          staged: 0,
          unstaged: 0,
          untracked: 0,
          conflicted: 0,
          total: 0,
        }),
        canIncludeLocalChanges: false,
      }),
    ),
    agentEvents: vi.fn<RuntimeApi["agentEvents"]>(),
    agentResult: vi.fn<RuntimeApi["agentResult"]>(),
    applyAgentJob: vi.fn<RuntimeApi["applyAgentJob"]>(),
    cancelAgentJob: vi.fn<RuntimeApi["cancelAgentJob"]>(),
    cancelPending: vi.fn(),
    createAgentJob: vi.fn<RuntimeApi["createAgentJob"]>(),
    dispose: vi.fn(),
    openEditor: vi
      .fn<RuntimeApi["openEditor"]>()
      .mockResolvedValue(Object.freeze({ editor: "auto" })),
    revertAgentJob: vi.fn<RuntimeApi["revertAgentJob"]>(),
    sourceContext: vi.fn<RuntimeApi["sourceContext"]>().mockResolvedValue(context),
  };
}

function visibleRect(): DOMRect {
  return {
    x: 12,
    y: 24,
    top: 24,
    right: 132,
    bottom: 64,
    left: 12,
    width: 120,
    height: 40,
    toJSON: () => ({}),
  };
}

function setHitTarget(target: Element): void {
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: vi.fn(() => [target, document.body, document.documentElement]),
  });
}

function findShadowButton(
  shadowRoot: ShadowRoot | null | undefined,
  label: string,
): HTMLButtonElement {
  const button = Array.from(
    shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ?? [],
  ).find((candidate) => candidate.textContent === label);

  if (button === undefined) {
    throw new Error(`Expected the ${label} button.`);
  }

  return button;
}

beforeEach(() => {
  document.body.textContent = "";
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.restoreAllMocks();
  document.querySelectorAll("spotpatch-root").forEach((host) => {
    host.remove();
  });
});

describe("runtime controller", () => {
  it("limits hit testing to one animation frame and completes source actions", async () => {
    const target = document.createElement("button");
    target.textContent = "Application button";
    target.setAttribute(SOURCE_MARKER_ATTRIBUTE, "file-id:36:5");
    document.body.append(target);
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue(visibleRect());
    vi.spyOn(document.body, "getBoundingClientRect").mockReturnValue(visibleRect());
    vi.spyOn(document.documentElement, "getBoundingClientRect").mockReturnValue(
      visibleRect(),
    );
    setHitTarget(target);

    let frameCallback: FrameRequestCallback | undefined;
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frameCallback = callback;
        return 1;
      });
    const api = createApi();
    const controller = createController(config, { api });
    controller.mount();
    const host = document.querySelector("spotpatch-root");
    const trigger =
      host?.shadowRoot?.querySelector<HTMLButtonElement>(".spotpatch-trigger");

    trigger?.click();
    expect(controller.getState().status).toBe("inspecting");

    target.dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, clientX: 20, clientY: 30 }),
    );
    target.dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, clientX: 21, clientY: 31 }),
    );
    expect(requestFrame).toHaveBeenCalledOnce();
    frameCallback?.(0);
    expect(
      host?.shadowRoot?.querySelector<HTMLElement>(".spotpatch-highlight")?.hidden,
    ).toBe(false);

    const applicationClick = vi.fn();
    target.addEventListener("click", applicationClick);
    const selectEvent = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      clientX: 21,
      clientY: 31,
    });
    target.dispatchEvent(selectEvent);

    expect(selectEvent.defaultPrevented).toBe(true);
    expect(applicationClick).not.toHaveBeenCalled();
    expect(controller.getState().status).toBe("selected");
    expect(api.sourceContext).toHaveBeenCalledWith({
      fileId: "file-id",
      line: 36,
      column: 5,
      maxLines: 12,
    });

    await vi.waitFor(() => {
      expect(
        host?.shadowRoot?.querySelector(".spotpatch-summary")?.textContent,
      ).toContain("src/App.tsx:36:5");
    });

    host?.shadowRoot
      ?.querySelector<HTMLButtonElement>("button[data-open-target-id='target-1']")
      ?.click();
    await vi.waitFor(() => {
      expect(api.openEditor).toHaveBeenCalledWith({
        fileId: "file-id",
        line: 36,
        column: 5,
      });
    });
    expect(
      host?.shadowRoot?.querySelector(".spotpatch-editor-feedback")?.textContent,
    ).toBe("Source opened in the editor.");

    controller.dispose();
    expect(api.dispose).toHaveBeenCalledOnce();
    expect(document.querySelector("spotpatch-root")).toBeNull();
  });

  it("does not intercept application clicks outside inspecting state", () => {
    const target = document.createElement("div");
    document.body.append(target);
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue(visibleRect());
    setHitTarget(target);
    const applicationClick = vi.fn();
    target.addEventListener("click", applicationClick);
    const controller = createController(config, { api: createApi() });
    controller.mount();

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    target.dispatchEvent(event);

    expect(applicationClick).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(false);
    expect(controller.getState().status).toBe("idle");
    controller.dispose();
  });

  it("collects context and completes the direct-input, preview, and copy flow", async () => {
    document.title = "Runtime workflow";
    const target = document.createElement("button");
    target.className = "primary-action";
    target.textContent = "Save profile";
    target.setAttribute(SOURCE_MARKER_ATTRIBUTE, "file-id:36:5");
    target.setAttribute("data-api-token", "never-copy-this");
    document.body.append(target);
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue(visibleRect());
    setHitTarget(target);
    const writeText = vi
      .fn<(value: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    const workflowConfig = Object.freeze({
      ...config,
      budget: Object.freeze({
        ...budget,
        totalCharacters: 4_000,
        domCharacters: 1_000,
        cssCharacters: 2_000,
        codeCharacters: 1_000,
      }),
    }) satisfies RuntimeConfig;
    const controller = createController(workflowConfig, {
      api: createApi(),
      clipboard: { writeText },
      createId: () => "annotation-id",
      now: () => "2026-08-06T00:00:00.000Z",
    });
    controller.mount();
    const shadowRoot = document.querySelector("spotpatch-root")?.shadowRoot;

    shadowRoot?.querySelector<HTMLButtonElement>(".spotpatch-trigger")?.click();
    target.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 30,
      }),
    );

    const instructionInput = shadowRoot?.querySelector<HTMLTextAreaElement>(
      "textarea[data-target-instruction-id]",
    );

    if (instructionInput === null || instructionInput === undefined) {
      throw new Error("Expected the target instruction input.");
    }

    instructionInput.value = "Align the profile action.";
    instructionInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(controller.getState().status).toBe("selected");
    expect(shadowRoot?.activeElement).toBe(instructionInput);

    const previewButton = findShadowButton(shadowRoot, "Preview prompt");
    await vi.waitFor(() => {
      expect(previewButton.disabled).toBe(false);
    });
    expect(shadowRoot?.querySelector(".spotpatch-summary")?.textContent).toContain(
      "CSS warnings:",
    );

    previewButton.click();
    expect(controller.getState().status).toBe("previewing");
    const prompt = shadowRoot?.querySelector(".spotpatch-prompt")?.textContent ?? "";
    expect(prompt).toContain("## Change requirements");
    expect(prompt).toContain("Align the profile action.");
    expect(prompt).toContain("src/App.tsx:36:5");
    expect(prompt).not.toContain("never-copy-this");

    findShadowButton(shadowRoot, "Copy prompt").click();
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(prompt);
      expect(controller.getState().status).toBe("selected");
    });

    previewButton.click();
    writeText.mockRejectedValueOnce(new Error("clipboard denied"));
    findShadowButton(shadowRoot, "Copy prompt").click();
    await vi.waitFor(() => {
      expect(controller.getState().status).toBe("previewing");
      expect(shadowRoot?.activeElement?.classList.contains("spotpatch-prompt")).toBe(
        true,
      );
    });

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(controller.getState().status).toBe("selected");
    expect(shadowRoot?.activeElement).toBe(
      shadowRoot?.querySelector<HTMLTextAreaElement>(
        "textarea[data-target-instruction-id]",
      ),
    );

    controller.dispose();
  });

  it("preserves distinct instructions while adding, deduplicating, previewing, and removing targets", async () => {
    const first = document.createElement("button");
    first.textContent = "First action";
    first.setAttribute(SOURCE_MARKER_ATTRIBUTE, "file-a:10:2");
    const second = document.createElement("a");
    second.textContent = "Second action";
    second.setAttribute(SOURCE_MARKER_ATTRIBUTE, "file-b:20:3");
    document.body.append(first, second);
    vi.spyOn(first, "getBoundingClientRect").mockReturnValue(visibleRect());
    vi.spyOn(second, "getBoundingClientRect").mockReturnValue({
      x: 200,
      y: 24,
      top: 24,
      left: 200,
      right: 320,
      bottom: 64,
      width: 120,
      height: 40,
      toJSON: () => ({}),
    });
    const api = createApi();
    vi.mocked(api.sourceContext).mockImplementation(({ fileId }) =>
      Promise.resolve({
        ...context,
        relativePath: fileId === "file-a" ? "src/First.tsx" : "src/Second.tsx",
      }),
    );
    const multiConfig = Object.freeze({
      ...config,
      maxTargets: 2,
      budget: Object.freeze({
        ...budget,
        totalCharacters: 8_000,
        domCharacters: 1_000,
        cssCharacters: 1_000,
        codeCharacters: 2_000,
      }),
    }) satisfies RuntimeConfig;
    const controller = createController(multiConfig, { api });
    controller.mount();
    const shadowRoot = document.querySelector("spotpatch-root")?.shadowRoot;

    setHitTarget(first);
    shadowRoot?.querySelector<HTMLButtonElement>(".spotpatch-trigger")?.click();
    first.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 30,
      }),
    );
    await vi.waitFor(() => {
      expect(
        shadowRoot?.querySelector<HTMLTextAreaElement>(
          "textarea[data-target-instruction-id]",
        ),
      ).toBeTruthy();
    });
    const firstInstruction = shadowRoot?.querySelector<HTMLTextAreaElement>(
      "textarea[data-target-instruction-id]",
    );

    if (firstInstruction === null || firstInstruction === undefined) {
      throw new Error("Expected the first target instruction input.");
    }

    firstInstruction.value = "Rename the first action to Save changes.";
    firstInstruction.dispatchEvent(new Event("input", { bubbles: true }));
    findShadowButton(shadowRoot, "Add element").click();
    expect(controller.getState().status).toBe("inspecting");

    setHitTarget(second);
    second.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: 220,
        clientY: 30,
      }),
    );

    await vi.waitFor(() => {
      expect(shadowRoot?.querySelectorAll(".spotpatch-target-item")).toHaveLength(2);
    });
    expect(findShadowButton(shadowRoot, "Preview prompt").disabled).toBe(true);

    const secondInstruction = shadowRoot?.querySelector<HTMLTextAreaElement>(
      "textarea[data-target-instruction-id]",
    );

    if (secondInstruction === null || secondInstruction === undefined) {
      throw new Error("Expected the second target instruction input.");
    }

    secondInstruction.value = "Rename the second action to View details.";
    secondInstruction.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => {
      expect(findShadowButton(shadowRoot, "Preview prompt").disabled).toBe(false);
    });
    expect(shadowRoot?.querySelectorAll(".spotpatch-selection-highlight")).toHaveLength(
      2,
    );

    shadowRoot
      ?.querySelector<HTMLButtonElement>('[aria-label="Edit target 1"]')
      ?.click();
    expect(
      shadowRoot?.querySelector<HTMLTextAreaElement>(
        "textarea[data-target-instruction-id]",
      )?.value,
    ).toBe("Rename the first action to Save changes.");

    shadowRoot
      ?.querySelector<HTMLButtonElement>('[aria-label="Edit target 2"]')
      ?.click();
    expect(
      shadowRoot?.querySelector<HTMLTextAreaElement>(
        "textarea[data-target-instruction-id]",
      )?.value,
    ).toBe("Rename the second action to View details.");

    findShadowButton(shadowRoot, "Preview prompt").click();
    const prompt = shadowRoot?.querySelector(".spotpatch-prompt")?.textContent ?? "";
    expect(prompt).toContain("## Selected targets (2)");
    expect(prompt).toContain("src/First.tsx:10:2");
    expect(prompt).toContain("src/Second.tsx:20:3");
    expect(prompt).toContain("Rename the first action to Save changes.");
    expect(prompt).toContain("Rename the second action to View details.");

    findShadowButton(shadowRoot, "Back to edit").click();
    findShadowButton(shadowRoot, "Add element").click();
    setHitTarget(first);
    first.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 30,
      }),
    );
    expect(shadowRoot?.querySelectorAll(".spotpatch-target-item")).toHaveLength(2);

    shadowRoot
      ?.querySelector<HTMLButtonElement>('[aria-label="Remove target 1"]')
      ?.click();
    expect(shadowRoot?.querySelectorAll(".spotpatch-target-item")).toHaveLength(1);
    expect(
      shadowRoot?.querySelector<HTMLTextAreaElement>(
        "textarea[data-target-instruction-id]",
      )?.value,
    ).toBe("Rename the second action to View details.");

    controller.dispose();
  });

  it("rebuilds diagnostics and the prompt when language changes without losing instructions", async () => {
    const target = document.createElement("button");
    target.textContent = "Primary action";
    target.setAttribute(SOURCE_MARKER_ATTRIBUTE, "file-id:36:5");
    document.body.append(target);
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue(visibleRect());
    setHitTarget(target);
    const localizedConfig = Object.freeze({
      ...config,
      locale: "zh-CN",
      budget: Object.freeze({
        ...budget,
        totalCharacters: 4_000,
        domCharacters: 1_000,
        cssCharacters: 1_000,
        codeCharacters: 1_000,
      }),
    }) satisfies RuntimeConfig;
    const controller = createController(localizedConfig, { api: createApi() });
    controller.mount();
    const shadowRoot = document.querySelector("spotpatch-root")?.shadowRoot;

    shadowRoot?.querySelector<HTMLButtonElement>(".spotpatch-trigger")?.click();
    target.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 30,
      }),
    );

    await vi.waitFor(() => {
      expect(shadowRoot?.querySelector(".spotpatch-summary")?.textContent).toContain(
        "浏览器上下文: 已就绪",
      );
    });
    const instruction = shadowRoot?.querySelector<HTMLTextAreaElement>(
      "textarea[data-target-instruction-id]",
    );

    if (instruction === null || instruction === undefined) {
      throw new Error("Expected the localized target instruction input.");
    }

    instruction.value = "只调整这个按钮的文案。";
    instruction.dispatchEvent(new Event("input", { bubbles: true }));
    findShadowButton(shadowRoot, "预览 Prompt").click();
    expect(shadowRoot?.querySelector(".spotpatch-prompt")?.textContent).toContain(
      "## 页面环境",
    );

    shadowRoot?.querySelector<HTMLButtonElement>(".spotpatch-locale")?.click();

    expect(shadowRoot?.querySelector(".spotpatch-prompt")?.textContent).toContain(
      "## Page environment",
    );
    expect(shadowRoot?.querySelector(".spotpatch-prompt")?.textContent).toContain(
      "只调整这个按钮的文案。",
    );
    expect(shadowRoot?.querySelector(".spotpatch-summary")?.textContent).toContain(
      "Browser context: ready",
    );

    findShadowButton(shadowRoot, "Back to edit").click();
    expect(
      shadowRoot?.querySelector<HTMLTextAreaElement>(
        "textarea[data-target-instruction-id]",
      )?.value,
    ).toBe("只调整这个按钮的文案。");

    controller.dispose();
  });

  it("runs the consented Agent review, Apply, and Revert flow through public profile IDs", async () => {
    const target = document.createElement("button");
    target.textContent = "Save profile";
    target.setAttribute(SOURCE_MARKER_ATTRIBUTE, "file-id:36:5");
    document.body.append(target);
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue(visibleRect());
    setHitTarget(target);
    const jobId = "0123456789abcdefghijklmn";
    const queued = Object.freeze({
      jobId,
      status: "queued" as const,
      providerProfileId: "relay",
      providerLabel: "Trusted Relay",
      modelProfileId: "coder",
      modelLabel: "Coding Model",
      phaseMessage: "Agent job queued.",
      createdAt: "2026-08-07T00:00:00.000Z",
      updatedAt: "2026-08-07T00:00:00.000Z",
      canCancel: true,
      canApply: false,
      canRevert: false,
    });
    const review = Object.freeze({
      ...queued,
      status: "awaiting-review" as const,
      phaseMessage: "Validated changes are ready for review.",
      updatedAt: "2026-08-07T00:00:02.000Z",
      canApply: true,
    });
    const applied = Object.freeze({
      ...review,
      status: "applied" as const,
      phaseMessage: "Changes were applied to local project files.",
      updatedAt: "2026-08-07T00:00:03.000Z",
      canCancel: false,
      canApply: false,
      canRevert: true,
    });
    const reverted = Object.freeze({
      ...applied,
      status: "reverted" as const,
      phaseMessage: "The Agent change was safely reverted.",
      updatedAt: "2026-08-07T00:00:04.000Z",
      canRevert: false,
    });
    const result = Object.freeze({
      jobId,
      summary: "Clarified the profile action.",
      diff: "diff --git a/src/App.tsx b/src/App.tsx\n-Save profile\n+Save changes\n",
      files: Object.freeze([
        Object.freeze({
          relativePath: "src/App.tsx",
          kind: "modified" as const,
          additions: 1,
          deletions: 1,
        }),
      ]),
      checks: Object.freeze([
        Object.freeze({
          checkId: "typecheck",
          label: "Typecheck",
          status: "passed" as const,
          durationMs: 42,
          output: "No errors.",
        }),
      ]),
    });
    const api = createApi();
    vi.mocked(api.agentWorkspaceHealth).mockResolvedValue(
      Object.freeze({
        state: "consent-required",
        checkedAt: "2026-08-07T00:00:00.500Z",
        changes: Object.freeze({
          staged: 1,
          unstaged: 1,
          untracked: 1,
          conflicted: 0,
          total: 2,
        }),
        canIncludeLocalChanges: true,
      }),
    );
    vi.mocked(api.agentCapability).mockResolvedValue({
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
      checkedAt: "2026-08-07T00:00:01.000Z",
    });
    vi.mocked(api.createAgentJob).mockResolvedValue(queued);
    vi.mocked(api.agentEvents).mockImplementation((_id, onEvent) => {
      onEvent({
        schemaVersion: 2,
        sequence: 1,
        jobId,
        status: "running",
        timestamp: "2026-08-07T00:00:01.000Z",
        type: "tool",
        data: {
          turn: 1,
          toolCallId: "call-1",
          toolName: "read_file",
          state: "succeeded",
          relativePath: "src/App.tsx",
        },
      });
      onEvent({
        schemaVersion: 2,
        sequence: 2,
        jobId,
        status: "running",
        timestamp: "2026-08-07T00:00:01.500Z",
        type: "tool",
        data: {
          turn: 2,
          toolCallId: "call-1",
          toolName: "replace_text",
          state: "succeeded",
          relativePath: "src/App.tsx",
        },
      });
      onEvent({
        schemaVersion: 2,
        sequence: 3,
        jobId,
        status: "awaiting-review",
        timestamp: "2026-08-07T00:00:02.000Z",
        type: "snapshot",
        data: { snapshot: review },
      });
      return Promise.resolve();
    });
    vi.mocked(api.agentResult)
      .mockResolvedValueOnce({ snapshot: review, result })
      .mockResolvedValueOnce({ snapshot: applied, result })
      .mockResolvedValueOnce({ snapshot: reverted, result });
    vi.mocked(api.applyAgentJob).mockResolvedValue(applied);
    vi.mocked(api.revertAgentJob).mockResolvedValue(reverted);
    const agentConfig = Object.freeze({
      ...config,
      ai: Object.freeze({
        enabled: true as const,
        providers: Object.freeze([
          Object.freeze({
            id: "relay",
            label: "Trusted Relay",
            protocol: "responses" as const,
            models: Object.freeze([
              Object.freeze({ id: "coder", label: "Coding Model" }),
            ]),
            defaultModel: "coder",
          }),
        ]),
        defaultProvider: "relay",
        applyMode: "review" as const,
      }),
    }) satisfies RuntimeConfig;
    const controller = createController(agentConfig, {
      api,
      createId: () => "annotation-id",
      now: () => "2026-08-07T00:00:00.000Z",
    });
    controller.mount();
    const shadowRoot = document.querySelector("spotpatch-root")?.shadowRoot;

    shadowRoot?.querySelector<HTMLButtonElement>(".spotpatch-trigger")?.click();
    target.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 30,
      }),
    );
    await vi.waitFor(() => {
      expect(
        shadowRoot?.querySelector<HTMLTextAreaElement>(
          "textarea[data-target-instruction-id]",
        ),
      ).toBeTruthy();
      expect(
        shadowRoot?.querySelector<HTMLInputElement>(".spotpatch-consent input"),
      ).toBeTruthy();
      expect(
        shadowRoot?.querySelector<HTMLInputElement>(
          ".spotpatch-workspace-consent input",
        ),
      ).toBeTruthy();
    });
    const instructionInput = shadowRoot?.querySelector<HTMLTextAreaElement>(
      "textarea[data-target-instruction-id]",
    );
    const consent = shadowRoot?.querySelector<HTMLInputElement>(
      ".spotpatch-consent input",
    );
    const workspaceConsent = shadowRoot?.querySelector<HTMLInputElement>(
      ".spotpatch-workspace-consent input",
    );
    let runButton = findShadowButton(shadowRoot, "Verify & run");

    if (
      instructionInput === null ||
      instructionInput === undefined ||
      consent === null ||
      consent === undefined ||
      workspaceConsent === null ||
      workspaceConsent === undefined
    ) {
      throw new Error("Expected Agent inputs.");
    }

    instructionInput.value = "Clarify the selected profile action.";
    instructionInput.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => {
      expect(runButton.disabled).toBe(true);
    });
    findShadowButton(shadowRoot, "Check environment").click();
    await vi.waitFor(() => {
      expect(api.agentCapability).toHaveBeenCalledWith({
        providerProfileId: "relay",
        modelProfileId: "coder",
      });
      expect(findShadowButton(shadowRoot, "Run AI")).toBeDefined();
    });
    runButton = findShadowButton(shadowRoot, "Run AI");
    consent.checked = true;
    consent.dispatchEvent(new Event("change", { bubbles: true }));
    workspaceConsent.checked = true;
    workspaceConsent.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => {
      expect(runButton.disabled).toBe(false);
    });
    runButton.click();

    await vi.waitFor(() => {
      expect(api.createAgentJob).toHaveBeenCalledWith(
        expect.objectContaining({
          providerProfileId: "relay",
          modelProfileId: "coder",
          providerDataConsent: true,
          workingTreeMode: "include-local-changes",
        }),
      );
      expect(shadowRoot?.querySelector(".spotpatch-agent-diff")?.textContent).toContain(
        "Save changes",
      );
    });
    expect(api.agentCapability).toHaveBeenCalledOnce();
    expect(shadowRoot?.textContent).toContain("Typecheck: passed");
    expect(shadowRoot?.textContent).toContain("read_file · succeeded");
    expect(shadowRoot?.textContent).toContain("replace_text · succeeded");
    expect(shadowRoot?.textContent).not.toContain("provider-model-v1");

    const applyButton = findShadowButton(shadowRoot, "Apply changes");
    applyButton.click();
    applyButton.click();
    await vi.waitFor(() => {
      expect(api.applyAgentJob).toHaveBeenCalledWith(jobId);
      expect(api.applyAgentJob).toHaveBeenCalledOnce();
      expect(
        shadowRoot?.querySelector<HTMLElement>(".spotpatch-highlight")?.hidden,
      ).toBe(true);
      expect(findShadowButton(shadowRoot, "Revert changes").hidden).toBe(false);
    });
    const appliedSourceButton = shadowRoot?.querySelector<HTMLButtonElement>(
      "button[data-open-target-id='target-1']",
    );
    expect(appliedSourceButton?.disabled).toBe(false);
    appliedSourceButton?.click();
    await vi.waitFor(() => {
      expect(api.openEditor).toHaveBeenCalledWith({
        fileId: "file-id",
        line: 36,
        column: 5,
      });
    });

    const revertButton = findShadowButton(shadowRoot, "Revert changes");
    revertButton.click();
    revertButton.click();
    await vi.waitFor(() => {
      expect(api.revertAgentJob).toHaveBeenCalledWith(jobId);
      expect(api.revertAgentJob).toHaveBeenCalledOnce();
      expect(shadowRoot?.textContent).toContain("safely reverted");
    });
    controller.dispose();
  });

  it("preserves collected context when the selected element is removed", async () => {
    const target = document.createElement("div");
    target.setAttribute(SOURCE_MARKER_ATTRIBUTE, "file-id:1:1");
    document.body.append(target);
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue(visibleRect());
    setHitTarget(target);
    const controller = createController(config, { api: createApi() });
    controller.mount();
    document
      .querySelector("spotpatch-root")
      ?.shadowRoot?.querySelector<HTMLButtonElement>(".spotpatch-trigger")
      ?.click();
    target.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: 1,
        clientY: 1,
      }),
    );
    await vi.waitFor(() => {
      expect(
        document
          .querySelector("spotpatch-root")
          ?.shadowRoot?.querySelector(".spotpatch-target-item"),
      ).not.toBeNull();
    });

    target.style.display = "none";
    window.dispatchEvent(new Event("resize"));

    await vi.waitFor(() => {
      expect(
        document
          .querySelector("spotpatch-root")
          ?.shadowRoot?.querySelector(".spotpatch-selection-highlight"),
      ).toBeNull();
      expect(
        document
          .querySelector("spotpatch-root")
          ?.shadowRoot?.querySelectorAll(".spotpatch-target-item"),
      ).toHaveLength(1);
    });

    target.remove();

    await vi.waitFor(() => {
      expect(controller.getState().status).toBe("selected");
      expect(
        document
          .querySelector("spotpatch-root")
          ?.shadowRoot?.querySelectorAll(".spotpatch-target-item"),
      ).toHaveLength(1);
      expect(
        document
          .querySelector("spotpatch-root")
          ?.shadowRoot?.querySelector(".spotpatch-selection-highlight"),
      ).toBeNull();
    });
    controller.dispose();
  });

  it("keeps a completed selection when the panel is closed and reopened", async () => {
    const target = document.createElement("button");
    target.textContent = "Persist me";
    target.setAttribute(SOURCE_MARKER_ATTRIBUTE, "file-id:7:3");
    document.body.append(target);
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue(visibleRect());
    setHitTarget(target);
    const controller = createController(config, { api: createApi() });
    controller.mount();
    const shadowRoot = document.querySelector("spotpatch-root")?.shadowRoot;

    shadowRoot?.querySelector<HTMLButtonElement>(".spotpatch-trigger")?.click();
    target.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 30,
      }),
    );
    const instruction = shadowRoot?.querySelector<HTMLTextAreaElement>(
      "textarea[data-target-instruction-id]",
    );
    if (instruction === null || instruction === undefined) {
      throw new Error("Expected a target instruction.");
    }
    instruction.value = "Keep this instruction.";
    instruction.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => {
      expect(findShadowButton(shadowRoot, "Preview prompt").disabled).toBe(false);
    });

    shadowRoot?.querySelector<HTMLButtonElement>(".spotpatch-close")?.click();
    expect(controller.getState().status).toBe("idle");
    expect(shadowRoot?.querySelector("[role='dialog']")?.hasAttribute("hidden")).toBe(
      true,
    );

    shadowRoot?.querySelector<HTMLButtonElement>(".spotpatch-trigger")?.click();
    expect(controller.getState().status).toBe("selected");
    expect(
      shadowRoot?.querySelector<HTMLTextAreaElement>(
        "textarea[data-target-instruction-id]",
      )?.value,
    ).toBe("Keep this instruction.");
    controller.dispose();
  });

  it("restores targets across pages and composes one multi-page request", async () => {
    window.history.replaceState(null, "", "/page-a");
    document.title = "Page A";
    const first = document.createElement("button");
    first.textContent = "First page target";
    first.setAttribute(SOURCE_MARKER_ATTRIBUTE, "file-a:10:2");
    document.body.append(first);
    vi.spyOn(first, "getBoundingClientRect").mockReturnValue(visibleRect());
    setHitTarget(first);
    const firstController = createController(config, { api: createApi() });
    firstController.mount();
    const firstShadowRoot = document.querySelector("spotpatch-root")?.shadowRoot;

    firstShadowRoot?.querySelector<HTMLButtonElement>(".spotpatch-trigger")?.click();
    first.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 30,
      }),
    );
    const firstInstruction = firstShadowRoot?.querySelector<HTMLTextAreaElement>(
      "textarea[data-target-instruction-id]",
    );
    if (firstInstruction === null || firstInstruction === undefined) {
      throw new Error("Expected the page A target instruction.");
    }
    firstInstruction.value = "Update the page A component.";
    firstInstruction.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => {
      expect(findShadowButton(firstShadowRoot, "Preview prompt").disabled).toBe(false);
    });
    firstController.dispose();

    first.remove();
    window.history.replaceState(null, "", "/page-b");
    document.title = "Page B";
    const second = document.createElement("button");
    second.textContent = "Second page target";
    second.setAttribute(SOURCE_MARKER_ATTRIBUTE, "file-b:20:4");
    document.body.append(second);
    vi.spyOn(second, "getBoundingClientRect").mockReturnValue(visibleRect());
    setHitTarget(second);
    const compose = vi
      .fn<(annotation: SpotAnnotation) => string>()
      .mockReturnValue("multi-page prompt");
    const secondController = createController(config, {
      api: createApi(),
      promptComposer: { compose },
    });
    secondController.mount();
    const secondShadowRoot = document.querySelector("spotpatch-root")?.shadowRoot;

    expect(secondController.getState().status).toBe("selected");
    expect(
      secondShadowRoot?.querySelector<HTMLTextAreaElement>(
        "textarea[data-target-instruction-id='target-1']",
      )?.value,
    ).toBe("Update the page A component.");
    findShadowButton(secondShadowRoot, "Add element").click();
    second.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 30,
      }),
    );
    const secondInstruction = secondShadowRoot?.querySelector<HTMLTextAreaElement>(
      "textarea[data-target-instruction-id='target-2']",
    );
    if (secondInstruction === null || secondInstruction === undefined) {
      throw new Error("Expected the page B target instruction.");
    }
    secondInstruction.value = "Update the page B component.";
    secondInstruction.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => {
      expect(findShadowButton(secondShadowRoot, "Preview prompt").disabled).toBe(false);
    });
    findShadowButton(secondShadowRoot, "Preview prompt").click();

    expect(compose).toHaveBeenCalledOnce();
    const annotation = compose.mock.calls[0]?.[0];
    expect(annotation?.page.pathname).toBe("/page-b");
    expect(annotation?.targets.map((target) => target.page?.pathname)).toEqual([
      "/page-a",
      "/page-b",
    ]);
    secondController.dispose();
  });

  it("closes deterministically on Escape", () => {
    const controller = createController(config, { api: createApi() });
    controller.mount();
    document
      .querySelector("spotpatch-root")
      ?.shadowRoot?.querySelector<HTMLButtonElement>(".spotpatch-trigger")
      ?.click();
    expect(controller.getState().status).toBe("inspecting");

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    expect(controller.getState().status).toBe("idle");
    controller.dispose();
  });

  it("ignores a malformed persisted selection", () => {
    window.sessionStorage.setItem(
      `spotpatch:selection:${config.sessionId}`,
      JSON.stringify({
        version: 1,
        open: true,
        sequence: 1,
        targets: [{ id: "target-1" }],
      }),
    );
    const controller = createController(config, { api: createApi() });

    expect(() => {
      controller.mount();
    }).not.toThrow();
    expect(controller.getState().status).toBe("idle");
    document
      .querySelector("spotpatch-root")
      ?.shadowRoot?.querySelector<HTMLButtonElement>(".spotpatch-trigger")
      ?.click();
    expect(controller.getState().status).toBe("inspecting");
    controller.dispose();
  });
});
