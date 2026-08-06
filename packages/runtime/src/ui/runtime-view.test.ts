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
  });

  it("renders collected text through textContent rather than HTML", () => {
    const view = createRuntimeView(document, "Mod+Shift+S");
    const hostile = '<img src=x onerror="globalThis.compromised=true">';
    view.showSelection(hostile, false);
    const summary = view.host.shadowRoot?.querySelector(".spotpatch-summary");

    expect(summary?.textContent).toBe(hostile);
    expect(summary?.querySelector("img")).toBeNull();
    expect(view.openEditorButton.disabled).toBe(true);
  });
});
