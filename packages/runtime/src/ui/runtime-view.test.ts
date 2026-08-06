// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { createRuntimeView } from "./runtime-view.js";
import { UI_MARKER_ATTRIBUTE } from "./ui-constants.js";

afterEach(() => {
  document.querySelectorAll("spotpatch-root").forEach((host) => {
    host.remove();
  });
});

describe("runtime view", () => {
  it("mounts an accessible open Shadow DOM surface", () => {
    const view = createRuntimeView(document, "Mod+Shift+S");
    const dialog = view.host.shadowRoot?.querySelector("[role='dialog']");

    expect(view.host.hasAttribute(UI_MARKER_ATTRIBUTE)).toBe(true);
    expect(view.host.shadowRoot?.mode).toBe("open");
    expect(view.triggerButton.textContent).toBe("Select element");
    expect(view.triggerButton.title).toContain("Mod+Shift+S");
    expect(dialog?.getAttribute("aria-labelledby")).toBe("spotpatch-selection-title");
    expect(view.openEditorButton.textContent).toBe("Open in VS Code");
    expect(view.addNoteButton.textContent).toBe("Add note");
    expect(view.previewButton.textContent).toBe("Preview prompt");
    expect(view.copyButton.textContent).toBe("Copy prompt");
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

  it("switches accessible annotation and preview panels without interpreting content", () => {
    const view = createRuntimeView(document, "Mod+Shift+S");
    const hostile = "```html\n<img src=x onerror=attack()>";

    view.renderStatus("annotating");
    view.showAnnotation("Existing note");
    expect(view.readNote()).toBe("Existing note");
    expect(view.host.shadowRoot?.querySelector(".spotpatch-title")?.textContent).toBe(
      "Describe the issue",
    );

    view.renderStatus("previewing");
    view.showPreview(hostile);
    const preview = view.host.shadowRoot?.querySelector(".spotpatch-prompt");
    expect(preview?.textContent).toBe(hostile);
    expect(preview?.querySelector("img")).toBeNull();
    expect(preview?.getAttribute("tabindex")).toBe("0");
    expect(view.host.shadowRoot?.querySelector(".spotpatch-title")?.textContent).toBe(
      "Prompt preview",
    );
  });
});
