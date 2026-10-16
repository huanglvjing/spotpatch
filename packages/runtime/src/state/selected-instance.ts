import {
  ELEMENT_INSTANCE_HINT_ATTRIBUTE,
  ELEMENT_INSTANCE_LIMITS,
  SOURCE_MARKER_ATTRIBUTE,
  type ElementContext,
  type ElementInstanceContext,
} from "@spotpatch/shared";

import { collectElementContext } from "../collectors/dom-collector.js";

export interface SelectedInstanceCapture {
  readonly context: ElementContext;
  readonly scope: Element;
}

function instanceScope(element: Element): Element {
  let candidate: Element | null = element;
  for (
    let depth = 0;
    candidate !== null && depth < ELEMENT_INSTANCE_LIMITS.ancestorDepth;
    depth += 1
  ) {
    if (
      candidate === element.ownerDocument.body ||
      candidate === element.ownerDocument.documentElement
    )
      break;
    if (
      candidate.hasAttribute(ELEMENT_INSTANCE_HINT_ATTRIBUTE) ||
      candidate.matches("article, li, tr, [role=row], [role=listitem]")
    )
      return candidate;
    const marker = candidate.getAttribute(SOURCE_MARKER_ATTRIBUTE);
    if (
      marker !== null &&
      candidate.parentElement !== null &&
      Array.from(candidate.parentElement.children).some(
        (sibling) =>
          sibling !== candidate &&
          sibling.getAttribute(SOURCE_MARKER_ATTRIBUTE) === marker,
      )
    )
      return candidate;
    candidate = candidate.parentElement;
  }
  const parent = element.parentElement;
  return parent === null ||
    parent === element.ownerDocument.body ||
    parent === element.ownerDocument.documentElement
    ? element
    : parent;
}

/** Capture synchronously at selection, before a list can recycle the DOM node. */
export function captureSelectedInstance(
  element: Element,
  id: string,
  maxCharacters: number,
): SelectedInstanceCapture {
  const context = collectElementContext({ element, maxCharacters });
  const scope = instanceScope(element);
  const nearby = collectElementContext({
    element: scope,
    maxCharacters: ELEMENT_INSTANCE_LIMITS.contextCharacters,
  });
  return Object.freeze({
    scope,
    context: Object.freeze({
      ...context,
      instance: Object.freeze({
        id,
        state: "captured",
        selectorStatus:
          context.selector.length > 0 ? "unique-at-capture" : "unavailable",
        label: (nearby.textPreview ?? context.textPreview ?? context.tagName).slice(
          0,
          ELEMENT_INSTANCE_LIMITS.labelCharacters,
        ),
        context: nearby.sanitizedHtml,
      }),
    }),
  });
}

export function withInstanceState(
  context: ElementContext,
  state: ElementInstanceContext["state"],
): ElementContext {
  return context.instance === undefined
    ? context
    : Object.freeze({
        ...context,
        instance: Object.freeze({ ...context.instance, state }),
      });
}

/** Positional moves preserve a live reference; content changes retire it. */
export function changedInstanceState(
  element: Element,
  scope: Element,
  records: readonly MutationRecord[],
): "changed" | "detached" | undefined {
  if (!element.isConnected || element.getRootNode() !== element.ownerDocument)
    return "detached";
  if (!scope.contains(element)) return "changed";
  return records.some(
    (record) =>
      scope.contains(record.target) &&
      // Motion libraries update inline transforms continuously. Style is a
      // capture-time snapshot; presentation updates do not establish a new record.
      !(record.type === "attributes" && record.attributeName === "style"),
  )
    ? "changed"
    : undefined;
}
