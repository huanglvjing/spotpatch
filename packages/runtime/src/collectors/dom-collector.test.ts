// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { collectElementContext, DOM_COLLECTION_LIMITS } from "./dom-collector.js";

beforeEach(() => {
  document.body.textContent = "";
});

describe("DOM collector", () => {
  it("keeps useful attributes while permanently removing secrets and values", () => {
    const form = document.createElement("form");
    form.id = "login";
    const input = document.createElement("input");
    input.type = "password";
    input.className = "field secure";
    input.setAttribute("aria-label", "Password");
    input.setAttribute("data-testid", "password-field");
    input.setAttribute("value", "never-include-me");
    input.setAttribute("data-auth-token", "also-secret");
    form.append(input);
    document.body.append(form);

    const context = collectElementContext({ element: input, maxCharacters: 3_000 });

    expect(context.sanitizedHtml).toContain('type="password"');
    expect(context.sanitizedHtml).toContain('aria-label="Password"');
    expect(context.sanitizedHtml).toContain('data-testid="password-field"');
    expect(context.sanitizedHtml).toContain('<form id="login">');
    expect(context.sanitizedHtml).not.toContain("never-include-me");
    expect(context.sanitizedHtml).not.toContain("also-secret");
    expect(context.selector).toContain('[data-testid="password-field"]');
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.rect)).toBe(true);
  });

  it("enforces depth, node, text, and total character limits", () => {
    const root = document.createElement("div");
    let parent: HTMLElement = root;

    for (let depth = 0; depth < 6; depth += 1) {
      const child = document.createElement("section");
      child.textContent = "x".repeat(300);
      parent.append(child);
      parent = child;
    }

    for (let index = 0; index < 40; index += 1) {
      root.append(document.createElement("span"));
    }

    document.body.append(root);
    const context = collectElementContext({ element: root, maxCharacters: 600 });

    expect(context.sanitizedHtml.length).toBeLessThanOrEqual(600);
    expect(context.sanitizedHtml).toContain("…");
    expect(context.textPreview?.length).toBeLessThanOrEqual(
      DOM_COLLECTION_LIMITS.maxTextCharacters + 1,
    );
    expect((context.sanitizedHtml.match(/<span>/gu) ?? []).length).toBeLessThan(40);
  });

  it("redacts inline data, blob URLs, URL secrets, and long SVG paths", () => {
    const link = document.createElement("a");
    link.href = "/callback?token=secret-token&tab=profile";
    link.style.backgroundImage = "url(data:image/png;base64,QUJDREVGRw==)";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M".repeat(500));
    svg.append(path);
    link.append(svg);
    document.body.append(link);

    vi.spyOn(link, "getBoundingClientRect").mockReturnValue({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
      top: 2,
      right: 4,
      bottom: 6,
      left: 1,
      toJSON: () => ({}),
    });

    const context = collectElementContext({ element: link, maxCharacters: 3_000 });

    expect(context.sanitizedHtml).not.toContain("secret-token");
    expect(context.sanitizedHtml).not.toContain("QUJDREVGRw");
    expect(context.sanitizedHtml).toContain("[redacted inline data]");
    expect(context.sanitizedHtml).toContain("…");
    expect(context.rect).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });
});
