// @vitest-environment jsdom

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
});
