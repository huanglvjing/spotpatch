import { UI_MARKER_ATTRIBUTE } from "../ui/ui-constants.js";
import { getVisibleElementRect } from "./geometry.js";

function isInsideSpotPatchUI(element: Element): boolean {
  if (element.closest(`[${UI_MARKER_ATTRIBUTE}]`) !== null) {
    return true;
  }

  const root = element.getRootNode();
  return root instanceof ShadowRoot && root.host.hasAttribute(UI_MARKER_ATTRIBUTE);
}

function hasVisibleArea(element: Element, view: Window): boolean {
  return getVisibleElementRect(element, view) !== undefined;
}

function isDocumentRoot(element: Element): boolean {
  return element.tagName === "HTML" || element.tagName === "BODY";
}

export function pickElementAt(
  document: Document,
  view: Window,
  clientX: number,
  clientY: number,
): Element | undefined {
  const visibleCandidates = document
    .elementsFromPoint(clientX, clientY)
    .filter(
      (element) => !isInsideSpotPatchUI(element) && hasVisibleArea(element, view),
    );

  return (
    visibleCandidates.find((element) => !isDocumentRoot(element)) ??
    visibleCandidates[0]
  );
}

export function isSpotPatchUIEventTarget(target: EventTarget | null): boolean {
  return target instanceof Element && isInsideSpotPatchUI(target);
}
