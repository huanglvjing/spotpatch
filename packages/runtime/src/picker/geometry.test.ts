// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { getElementRect, getVisibleElementRect } from "./geometry.js";

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  };
}

describe("element geometry", () => {
  it("returns the viewport rect for a block element without scroll offsets", () => {
    const element = document.createElement("div");
    element.style.display = "block";
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue(rect(10, 20, 80, 40));

    expect(getElementRect(element, window)).toEqual({
      x: 10,
      y: 20,
      width: 80,
      height: 40,
    });
  });

  it("unions visible line boxes for an inline element", () => {
    const element = document.createElement("span");
    element.style.display = "inline";
    vi.spyOn(element, "getClientRects").mockReturnValue([
      rect(20, 10, 50, 12),
      rect(10, 24, 80, 12),
    ] as unknown as DOMRectList);

    expect(getElementRect(element, window)).toEqual({
      x: 10,
      y: 10,
      width: 80,
      height: 26,
    });
  });

  it("does not expose hidden or zero-area elements as live anchors", () => {
    const hidden = document.createElement("div");
    hidden.style.display = "none";
    document.body.append(hidden);
    expect(getVisibleElementRect(hidden, window)).toBeUndefined();

    const zeroArea = document.createElement("button");
    document.body.append(zeroArea);
    vi.spyOn(zeroArea, "getBoundingClientRect").mockReturnValue(rect(0, 0, 0, 0));
    expect(getVisibleElementRect(zeroArea, window)).toBeUndefined();
  });
});
