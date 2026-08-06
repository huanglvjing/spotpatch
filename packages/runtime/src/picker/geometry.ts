export interface ElementRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function toElementRect(rect: DOMRect): ElementRect {
  return Object.freeze({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  });
}

function unionRects(rects: readonly DOMRect[]): ElementRect | undefined {
  const visibleRects = rects.filter((rect) => rect.width > 0 && rect.height > 0);
  const first = visibleRects[0];

  if (first === undefined) {
    return undefined;
  }

  let left = first.left;
  let top = first.top;
  let right = first.right;
  let bottom = first.bottom;

  for (const rect of visibleRects.slice(1)) {
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }

  return Object.freeze({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  });
}

export function getElementRect(element: Element, view: Window): ElementRect {
  const display = view.getComputedStyle(element).display;

  if (display.startsWith("inline")) {
    const lineBoxRect = unionRects(Array.from(element.getClientRects()));

    if (lineBoxRect !== undefined) {
      return lineBoxRect;
    }
  }

  return toElementRect(element.getBoundingClientRect());
}
