// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { ELEMENT_INSTANCE_LIMITS } from "@spotpatch/shared";

import { createElementLocator } from "../collectors/element-locator.js";
import {
  captureSelectedInstance,
  changedInstanceState,
  withInstanceState,
} from "./selected-instance.js";

beforeEach(() => {
  document.body.replaceChildren();
});

function fixture() {
  document.body.innerHTML =
    '<main><article data-spotpatch-instance="product-3"><h2>Product 3</h2><div><button>Edit</button></div></article><article><h2>Product 7</h2><div><button>Edit</button></div></article></main>';
  const element = document.querySelector("button");
  if (element === null) throw new Error("Missing fixture.");
  const capture = captureSelectedInstance(element, "capture_3", 1_000);
  const observer = new MutationObserver(() => undefined);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  });
  return { element, capture, observer };
}

describe("selected instance evidence", () => {
  it("captures the owning card around an identical nested action without including other cards", () => {
    const { element, capture, observer } = fixture();
    try {
      expect(capture.context.instance).toMatchObject({
        id: "capture_3",
        state: "captured",
        selectorStatus: "unique-at-capture",
      });
      expect(capture.context.instance?.context).toContain(
        'data-spotpatch-instance="product-3"',
      );
      expect(capture.context.instance?.context).toContain("Product 3");
      expect(capture.context.instance?.context).not.toContain("Product 7");
      expect(document.querySelector(capture.context.selector)).toBe(element);
      expect(Object.isFrozen(capture.context.instance)).toBe(true);
    } finally {
      observer.disconnect();
    }
  });

  it("follows the original DOM reference through reorder without treating the old position as a record ID", () => {
    const { element, capture, observer } = fixture();
    try {
      capture.scope.parentElement?.append(capture.scope);
      expect(
        changedInstanceState(element, capture.scope, observer.takeRecords()),
      ).toBeUndefined();
      expect(capture.scope.parentElement?.lastElementChild).toBe(capture.scope);
      expect(capture.context.selector).toContain("nth-of-type(1)");
      expect(capture.context.instance?.context).toContain("Product 3");
    } finally {
      observer.disconnect();
    }
  });

  it.each(["text", "attribute", "replacement"])(
    "retires a recycled instance after %s changes, preserving its original evidence",
    (kind) => {
      const { element, capture, observer } = fixture();
      try {
        if (kind === "text")
          capture.scope.querySelector("h2")?.firstChild?.replaceWith("Product 9");
        else if (kind === "attribute")
          capture.scope.setAttribute("data-spotpatch-instance", "product-9");
        else element.replaceWith(element.cloneNode(true));
        const state = changedInstanceState(
          element,
          capture.scope,
          observer.takeRecords(),
        );
        expect(state).toBe(kind === "replacement" ? "detached" : "changed");
        expect(capture.context.instance?.context).toContain("Product 3");
        expect(capture.context.instance?.context).not.toContain("Product 9");
        expect(
          withInstanceState(capture.context, state ?? "captured").instance?.state,
        ).toBe(state);
      } finally {
        observer.disconnect();
      }
    },
  );

  it("keeps an animated instance bound through inline presentation updates", () => {
    const { element, capture, observer } = fixture();
    try {
      element.setAttribute("style", "transform: translateY(12px)");
      expect(
        changedInstanceState(element, capture.scope, observer.takeRecords()),
      ).toBeUndefined();
      element.setAttribute("data-spotpatch-instance", "another-record");
      expect(changedInstanceState(element, capture.scope, observer.takeRecords())).toBe(
        "changed",
      );
    } finally {
      observer.disconnect();
    }
  });

  it("provides native table row evidence and redacts explicit hints and input values", () => {
    document.body.innerHTML =
      '<table><tbody><tr data-spotpatch-instance="token=never-leak"><td>Invoice 204</td><td><input value="secret-value"><button>Edit</button></td></tr></tbody></table>';
    const button = document.querySelector("button");
    if (!button) throw new Error("Missing action.");
    const capture = captureSelectedInstance(button, "table_1", 1_000);
    expect(capture.scope.localName).toBe("tr");
    expect(capture.context.instance?.context).toContain("Invoice 204");
    expect(JSON.stringify(capture.context)).not.toContain("never-leak");
    expect(JSON.stringify(capture.context)).not.toContain("secret-value");
    expect(capture.context.instance?.context.length).toBeLessThanOrEqual(
      ELEMENT_INSTANCE_LIMITS.contextCharacters,
    );
  });

  it("locates deeply nested instances, SVG and escaped IDs, and reports unqueryable roots honestly", () => {
    document.body.innerHTML = [0, 1]
      .map(
        () =>
          `<section>${"<div>".repeat(8)}<button>Edit</button>${"</div>".repeat(8)}</section>`,
      )
      .join("");
    for (const button of document.querySelectorAll("button")) {
      expect([...document.querySelectorAll(createElementLocator(button))]).toEqual([
        button,
      ]);
    }
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.id = 'card:"😀';
    document.body.append(svg);
    expect(document.querySelector(createElementLocator(svg))).toBe(svg);
    const detached = document.createElement("button");
    expect(createElementLocator(detached)).toBe("");
    const host = document.createElement("div");
    document.body.append(host);
    host.attachShadow({ mode: "open" }).append(detached);
    expect(
      captureSelectedInstance(detached, "shadow_1", 1_000).context.instance
        ?.selectorStatus,
    ).toBe("unavailable");
  });
});
