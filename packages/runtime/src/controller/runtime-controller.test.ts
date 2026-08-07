// @vitest-environment jsdom

import {
  SOURCE_MARKER_ATTRIBUTE,
  SPOTPATCH_API_BASE,
  type CodeContext,
  type ContextBudget,
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
  budget,
  debug: false,
  redact: true,
  sessionToken: "runtime-session-token",
  shortcut: "Mod+Shift+S",
  spotPatchVersion: "0.0.0",
  viteVersion: "7.3.6",
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
    cancelPending: vi.fn(),
    dispose: vi.fn(),
    openEditor: vi.fn<RuntimeApi["openEditor"]>().mockResolvedValue(undefined),
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

    findShadowButton(host?.shadowRoot ?? undefined, "Open in VS Code").click();
    await vi.waitFor(() => {
      expect(api.openEditor).toHaveBeenCalledWith({
        fileId: "file-id",
        line: 36,
        column: 5,
      });
    });

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

    const noteInput = shadowRoot?.querySelector<HTMLTextAreaElement>("textarea");

    if (noteInput === null || noteInput === undefined) {
      throw new Error("Expected the annotation input.");
    }

    noteInput.value = "Align the profile action.";
    noteInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(controller.getState().status).toBe("selected");
    expect(shadowRoot?.activeElement).toBe(noteInput);

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
    expect(prompt).toContain("## 问题");
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
    expect(shadowRoot?.activeElement).toBe(noteInput);

    controller.dispose();
  });

  it("returns to inspecting when the selected element is removed", async () => {
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
    expect(controller.getState().status).toBe("selected");

    target.remove();

    await vi.waitFor(() => {
      expect(controller.getState().status).toBe("inspecting");
    });
    controller.dispose();
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
});
