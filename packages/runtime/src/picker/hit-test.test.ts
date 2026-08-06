// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { UI_MARKER_ATTRIBUTE } from "../ui/ui-constants.js";
import { isSpotPatchUIEventTarget, pickElementAt } from "./hit-test.js";

function visibleRect(width = 100, height = 40): DOMRect {
  return {
    x: 10,
    y: 20,
    top: 20,
    right: 10 + width,
    bottom: 20 + height,
    left: 10,
    width,
    height,
    toJSON: () => ({}),
  };
}

function setHitStack(elements: readonly Element[]): void {
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: vi.fn(() => elements),
  });
}

function makeVisible(element: Element): void {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(visibleRect());
}

beforeEach(() => {
  document.body.textContent = "";
  makeVisible(document.documentElement);
  makeVisible(document.body);
});

describe("picker hit testing", () => {
  it("takes the first visible application element and skips document roots", () => {
    const target = document.createElement("button");
    document.body.append(target);
    makeVisible(target);
    setHitStack([document.documentElement, document.body, target]);

    expect(pickElementAt(document, window, 10, 20)).toBe(target);
  });

  it("uses html or body only when no application candidate remains", () => {
    setHitStack([document.documentElement, document.body]);

    expect(pickElementAt(document, window, 10, 20)).toBe(document.documentElement);
  });

  it("skips tool UI, hidden elements, and zero-area elements", () => {
    const ui = document.createElement("div");
    ui.setAttribute(UI_MARKER_ATTRIBUTE, "");
    const hidden = document.createElement("div");
    hidden.style.visibility = "hidden";
    const zeroArea = document.createElement("div");
    const target = document.createElement("article");
    document.body.append(ui, hidden, zeroArea, target);
    makeVisible(ui);
    makeVisible(hidden);
    vi.spyOn(zeroArea, "getBoundingClientRect").mockReturnValue(visibleRect(0));
    makeVisible(target);
    setHitStack([ui, hidden, zeroArea, target]);

    expect(pickElementAt(document, window, 0, 0)).toBe(target);
  });

  it("recognizes nodes inside the SpotPatch shadow root as tool UI", () => {
    const host = document.createElement("spotpatch-root");
    host.setAttribute(UI_MARKER_ATTRIBUTE, "");
    const shadow = host.attachShadow({ mode: "open" });
    const button = document.createElement("button");
    shadow.append(button);
    document.body.append(host);

    expect(isSpotPatchUIEventTarget(button)).toBe(true);
    expect(isSpotPatchUIEventTarget(document.body)).toBe(false);
  });
});
