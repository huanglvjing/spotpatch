import {
  ELEMENT_INSTANCE_HINT_ATTRIBUTE,
  type ElementContext,
} from "@spotpatch/shared";

import { createElementLocator } from "./element-locator.js";

import {
  redactSensitiveText,
  sanitizeAttributeValue,
} from "../security/content-sanitizer.js";

export const DOM_COLLECTION_LIMITS = Object.freeze({
  maxDepth: 3,
  maxNodes: 30,
  maxParentDepth: 2,
  maxTextCharacters: 200,
});

const SAFE_ATTRIBUTE_NAMES = new Set([
  "alt",
  "autocomplete",
  "checked",
  "class",
  "colspan",
  "contenteditable",
  "d",
  "disabled",
  "download",
  "draggable",
  "for",
  "height",
  "hidden",
  "href",
  "id",
  "max",
  "maxlength",
  "min",
  "minlength",
  "multiple",
  "name",
  "open",
  "pattern",
  "placeholder",
  "readonly",
  "rel",
  "required",
  "role",
  "rowspan",
  "selected",
  "src",
  "step",
  "style",
  "tabindex",
  "target",
  "title",
  "type",
  "width",
]);

const VOID_ELEMENT_NAMES = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

interface SerializationState {
  nodeCount: number;
  truncated: boolean;
}

export interface CollectElementContextOptions {
  readonly element: Element;
  readonly maxCharacters: number;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function isPreservedAttribute(name: string): boolean {
  return (
    SAFE_ATTRIBUTE_NAMES.has(name) ||
    name.startsWith("aria-") ||
    name === "data-testid" ||
    name === ELEMENT_INSTANCE_HINT_ATTRIBUTE
  );
}

function openingTag(element: Element): string {
  const tagName = element.tagName.toLowerCase();
  const attributes: string[] = [];
  const baseUrl = element.ownerDocument.baseURI;

  for (const attribute of element.attributes) {
    const name = attribute.name.toLowerCase();

    if (!isPreservedAttribute(name)) {
      continue;
    }

    const sanitized = sanitizeAttributeValue(name, attribute.value, baseUrl);

    if (sanitized !== undefined) {
      attributes.push(`${name}="${escapeHtml(sanitized)}"`);
    }
  }

  return `<${tagName}${attributes.length === 0 ? "" : ` ${attributes.join(" ")}`}>`;
}

function normalizedText(value: string): string {
  return redactSensitiveText(value).replaceAll(/\s+/gu, " ").trim();
}

function serializeElement(
  element: Element,
  depth: number,
  state: SerializationState,
  lines: string[],
): void {
  if (state.nodeCount >= DOM_COLLECTION_LIMITS.maxNodes) {
    state.truncated = true;
    return;
  }

  state.nodeCount += 1;
  const indent = "  ".repeat(depth);
  const tagName = element.tagName.toLowerCase();
  lines.push(`${indent}${openingTag(element)}`);

  if (VOID_ELEMENT_NAMES.has(tagName)) {
    return;
  }

  for (const child of element.childNodes) {
    if (state.nodeCount >= DOM_COLLECTION_LIMITS.maxNodes) {
      state.truncated = true;
      break;
    }

    if (child.nodeType === 3) {
      const text = normalizedText(child.textContent ?? "");

      if (text.length > 0) {
        state.nodeCount += 1;
        const truncated =
          text.length <= DOM_COLLECTION_LIMITS.maxTextCharacters
            ? text
            : `${text.slice(0, DOM_COLLECTION_LIMITS.maxTextCharacters)}…`;
        lines.push(`${"  ".repeat(depth + 1)}${escapeHtml(truncated)}`);
      }

      continue;
    }

    if (child.nodeType !== 1) {
      continue;
    }

    if (depth >= DOM_COLLECTION_LIMITS.maxDepth) {
      state.truncated = true;
      continue;
    }

    serializeElement(child as Element, depth + 1, state, lines);
  }

  if (state.truncated && depth === 0) {
    lines.push("  …");
  }

  lines.push(`${indent}</${tagName}>`);
}

function parentContext(element: Element): readonly string[] {
  const parents: string[] = [];
  let parent = element.parentElement;

  while (parent !== null && parents.length < DOM_COLLECTION_LIMITS.maxParentDepth) {
    parents.push(openingTag(parent));
    parent = parent.parentElement;
  }

  return parents;
}

function truncateContext(value: string, maxCharacters: number): string {
  if (value.length <= maxCharacters) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxCharacters - 1)).trimEnd()}…`;
}

export function collectElementContext(
  options: CollectElementContextOptions,
): ElementContext {
  const lines = ["<!-- Selected element -->"];
  const state: SerializationState = { nodeCount: 0, truncated: false };
  serializeElement(options.element, 0, state, lines);
  const parents = parentContext(options.element);

  if (parents.length > 0) {
    lines.push("<!-- Parent context: nearest first -->", ...parents);
  }

  const text = normalizedText(options.element.textContent);
  const rect = options.element.getBoundingClientRect();
  const role = options.element.getAttribute("role");

  return Object.freeze({
    tagName: options.element.tagName.toLowerCase(),
    selector: createElementLocator(options.element),
    sanitizedHtml: truncateContext(lines.join("\n"), options.maxCharacters),
    ...(text.length === 0
      ? {}
      : {
          textPreview:
            text.length <= DOM_COLLECTION_LIMITS.maxTextCharacters
              ? text
              : `${text.slice(0, DOM_COLLECTION_LIMITS.maxTextCharacters)}…`,
        }),
    ...(role === null ? {} : { role }),
    rect: Object.freeze({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    }),
  });
}
