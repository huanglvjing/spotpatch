// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { isTextEntryTarget, matchesShortcut } from "./shortcut.js";

describe("runtime shortcut", () => {
  it("maps Mod to Meta on Apple platforms", () => {
    const event = new KeyboardEvent("keydown", {
      key: "S",
      metaKey: true,
      shiftKey: true,
    });

    expect(matchesShortcut(event, "Mod+Shift+S", "Macintosh")).toBe(true);
  });

  it("maps Mod to Control on non-Apple platforms", () => {
    const event = new KeyboardEvent("keydown", {
      key: "s",
      ctrlKey: true,
      shiftKey: true,
    });

    expect(matchesShortcut(event, "Mod+Shift+S", "Windows NT 10.0")).toBe(true);
  });

  it("rejects missing, extra, and incorrect modifiers", () => {
    expect(
      matchesShortcut(
        new KeyboardEvent("keydown", { key: "s", ctrlKey: true }),
        "Mod+Shift+S",
        "Linux",
      ),
    ).toBe(false);
    expect(
      matchesShortcut(
        new KeyboardEvent("keydown", {
          key: "s",
          ctrlKey: true,
          shiftKey: true,
          altKey: true,
        }),
        "Mod+Shift+S",
        "Linux",
      ),
    ).toBe(false);
  });

  it("recognizes form controls and editable regions", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const editable = document.createElement("div");
    const child = document.createElement("span");
    editable.setAttribute("contenteditable", "true");
    editable.append(child);

    expect(isTextEntryTarget(input)).toBe(true);
    expect(isTextEntryTarget(textarea)).toBe(true);
    expect(isTextEntryTarget(child)).toBe(true);
    expect(isTextEntryTarget(document.body)).toBe(false);
  });
});
