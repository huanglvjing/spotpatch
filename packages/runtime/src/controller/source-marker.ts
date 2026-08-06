import {
  parseSourceMarker,
  SOURCE_MARKER_ATTRIBUTE,
  type SourceMarker,
} from "@spotpatch/shared";

export function findSourceMarker(element: Element): SourceMarker | undefined {
  let current: Element | null = element;

  while (current !== null) {
    const marker = parseSourceMarker(current.getAttribute(SOURCE_MARKER_ATTRIBUTE));

    if (marker !== undefined) {
      return marker;
    }

    current = current.parentElement;
  }

  return undefined;
}
