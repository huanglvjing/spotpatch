// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { collectStyleContext, CSS_COLLECTION_WARNINGS } from "./css-collector.js";
import { COMPUTED_STYLE_PROPERTIES } from "./computed-style-properties.js";

beforeEach(() => {
  document.head.textContent = "";
  document.body.textContent = "";
});

function appendStyle(css: string): CSSStyleSheet {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);

  if (style.sheet === null) {
    throw new Error("The test stylesheet was not created.");
  }

  return style.sheet;
}

describe("CSS collector", () => {
  it("collects matching rules, inline style, and only whitelisted computed values", () => {
    appendStyle(`
      .card { display: flex; align-items: flex-start; color: rgb(1, 2, 3); }
      .other { position: fixed; }
      @media (min-width: 1px) { .card { gap: 8px; } }
    `);
    const element = document.createElement("div");
    element.className = "card selected";
    element.style.width = "120px";
    document.body.append(element);

    const context = collectStyleContext({
      document,
      element,
      maxCharacters: 4_000,
    });

    expect(context.classNames).toEqual(["card", "selected"]);
    expect(context.inlineStyle).toContain("width: 120px");
    expect(context.matchedRules.map((rule) => rule.selector)).toEqual([
      ".card",
      ".card",
    ]);
    expect(context.matchedRules[1]?.media).toContain("min-width");
    expect(context.computed.display).toBe("flex");
    expect(
      Object.keys(context.computed).every((name) =>
        COMPUTED_STYLE_PROPERTIES.includes(
          name as (typeof COMPUTED_STYLE_PROPERTIES)[number],
        ),
      ),
    ).toBe(true);
    expect("cursor" in context.computed).toBe(false);
    expect(Object.isFrozen(context.matchedRules)).toBe(true);
    expect(Object.isFrozen(context.computed)).toBe(true);
  });

  it("records stylesheet access failures and continues collecting", () => {
    const first = appendStyle(".target { color: red; }");
    appendStyle(".target { display: grid; }");
    const element = document.createElement("div");
    element.className = "target";
    document.body.append(element);
    const readCssRules = vi.fn((sheet: CSSStyleSheet) => {
      if (sheet === first) {
        throw new DOMException("denied", "SecurityError");
      }

      return sheet.cssRules;
    });

    const context = collectStyleContext({
      document,
      element,
      maxCharacters: 4_000,
      readCssRules,
    });

    expect(context.warnings).toContain(CSS_COLLECTION_WARNINGS.inaccessibleStylesheet);
    expect(context.matchedRules).toHaveLength(1);
    expect(context.matchedRules[0]?.declarations).toContain("display: grid");
  });

  it("skips an invalid selector without losing later matching rules", () => {
    appendStyle(".broken { color: red; } .target { display: block; }");
    const element = document.createElement("div");
    element.className = "target";
    document.body.append(element);
    const originalMatches = element.matches.bind(element);
    vi.spyOn(element, "matches").mockImplementation((selector) => {
      if (selector === ".broken") {
        throw new DOMException("invalid selector", "SyntaxError");
      }

      return originalMatches(selector);
    });

    const context = collectStyleContext({
      document,
      element,
      maxCharacters: 4_000,
    });

    expect(context.warnings).toContain(CSS_COLLECTION_WARNINGS.selector);
    expect(context.matchedRules).toHaveLength(1);
    expect(context.matchedRules[0]?.selector).toBe(".target");
  });

  it("drops low-value computed properties before matched rules under budget", () => {
    appendStyle(".target { display: flex; padding: 10px; color: red; }");
    const element = document.createElement("div");
    element.className = "target";
    document.body.append(element);

    const context = collectStyleContext({
      document,
      element,
      maxCharacters: 430,
    });

    expect(context.matchedRules).toHaveLength(1);
    expect(Object.keys(context.computed).length).toBeLessThan(
      COMPUTED_STYLE_PROPERTIES.length,
    );
  });
});
