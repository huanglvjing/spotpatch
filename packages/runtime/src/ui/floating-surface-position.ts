export type FloatingSurfaceAlignment = "start" | "end";

export interface FloatingSurfacePosition {
  readonly horizontal: FloatingSurfaceAlignment;
  readonly vertical: FloatingSurfaceAlignment;
  readonly xRatio: number;
  readonly yRatio: number;
}

export interface FloatingSurfaceRect {
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

export interface FloatingSurfaceSize {
  readonly height: number;
  readonly width: number;
}

export interface FloatingSurfaceViewport {
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

export const DEFAULT_FLOATING_SURFACE_POSITION = Object.freeze({
  horizontal: "end",
  vertical: "end",
  xRatio: 1,
  yRatio: 1,
} satisfies FloatingSurfacePosition);

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function boundedRatio(value: number): number {
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0.5;
}

function normalizedViewport(
  viewport: FloatingSurfaceViewport,
): FloatingSurfaceViewport {
  return Object.freeze({
    height: finiteNonNegative(viewport.height),
    left: Number.isFinite(viewport.left) ? viewport.left : 0,
    top: Number.isFinite(viewport.top) ? viewport.top : 0,
    width: finiteNonNegative(viewport.width),
  });
}

function horizontalAnchor(
  rect: FloatingSurfaceRect,
  alignment: FloatingSurfaceAlignment,
): number {
  return alignment === "end" ? rect.left + rect.width : rect.left;
}

function verticalAnchor(
  rect: FloatingSurfaceRect,
  alignment: FloatingSurfaceAlignment,
): number {
  return alignment === "end" ? rect.top + rect.height : rect.top;
}

function normalizedCoordinate(
  coordinate: number,
  origin: number,
  length: number,
): number {
  if (length <= 0) {
    return 0.5;
  }

  return boundedRatio((coordinate - origin) / length);
}

export function positionFromAnchor(
  anchor: Readonly<{ x: number; y: number }>,
  viewport: FloatingSurfaceViewport,
  horizontal: FloatingSurfaceAlignment,
  vertical: FloatingSurfaceAlignment,
): FloatingSurfacePosition {
  return Object.freeze({
    horizontal,
    vertical,
    xRatio: normalizedCoordinate(anchor.x, viewport.left, viewport.width),
    yRatio: normalizedCoordinate(anchor.y, viewport.top, viewport.height),
  });
}

export function resolveFloatingSurfaceRect(
  position: FloatingSurfacePosition,
  size: FloatingSurfaceSize,
  viewport: FloatingSurfaceViewport,
): FloatingSurfaceRect {
  const width = finiteNonNegative(size.width);
  const height = finiteNonNegative(size.height);
  const normalized = normalizedViewport(viewport);
  const viewportWidth = normalized.width;
  const viewportHeight = normalized.height;
  const leftBoundary = normalized.left;
  const topBoundary = normalized.top;
  const rightBoundary = leftBoundary + viewportWidth;
  const bottomBoundary = topBoundary + viewportHeight;
  const anchorX = leftBoundary + boundedRatio(position.xRatio) * viewportWidth;
  const anchorY = topBoundary + boundedRatio(position.yRatio) * viewportHeight;
  const requestedLeft = position.horizontal === "end" ? anchorX - width : anchorX;
  const requestedTop = position.vertical === "end" ? anchorY - height : anchorY;
  const maximumLeft = Math.max(leftBoundary, rightBoundary - width);
  const maximumTop = Math.max(topBoundary, bottomBoundary - height);

  return Object.freeze({
    height,
    left: clamp(requestedLeft, leftBoundary, maximumLeft),
    top: clamp(requestedTop, topBoundary, maximumTop),
    width,
  });
}

export function snapFloatingSurfaceRect(
  rect: FloatingSurfaceRect,
  viewport: FloatingSurfaceViewport,
  snapDistance: number,
): FloatingSurfaceRect {
  const distance = finiteNonNegative(snapDistance);
  const width = finiteNonNegative(rect.width);
  const height = finiteNonNegative(rect.height);
  const normalized = normalizedViewport(viewport);
  const viewportRight = normalized.left + normalized.width;
  const viewportBottom = normalized.top + normalized.height;
  const maximumLeft = Math.max(normalized.left, viewportRight - width);
  const maximumTop = Math.max(normalized.top, viewportBottom - height);
  const requestedLeft = clamp(rect.left, normalized.left, maximumLeft);
  const requestedTop = clamp(rect.top, normalized.top, maximumTop);
  const leftDistance = Math.abs(requestedLeft - normalized.left);
  const rightDistance = Math.abs(viewportRight - (requestedLeft + width));
  const topDistance = Math.abs(requestedTop - normalized.top);
  const bottomDistance = Math.abs(viewportBottom - (requestedTop + height));
  const left =
    Math.min(leftDistance, rightDistance) <= distance
      ? leftDistance <= rightDistance
        ? normalized.left
        : viewportRight - width
      : requestedLeft;
  const top =
    Math.min(topDistance, bottomDistance) <= distance
      ? topDistance <= bottomDistance
        ? normalized.top
        : viewportBottom - height
      : requestedTop;

  return Object.freeze({ height, left, top, width });
}

export function positionFromFloatingSurfaceRect(
  rect: FloatingSurfaceRect,
  viewport: FloatingSurfaceViewport,
  previous: FloatingSurfacePosition,
): FloatingSurfacePosition {
  const bounded = snapFloatingSurfaceRect(rect, viewport, 0);
  const centerX = bounded.left + bounded.width / 2;
  const centerY = bounded.top + bounded.height / 2;
  const viewportCenterX = viewport.left + finiteNonNegative(viewport.width) / 2;
  const viewportCenterY = viewport.top + finiteNonNegative(viewport.height) / 2;
  const horizontal =
    centerX === viewportCenterX
      ? previous.horizontal
      : centerX < viewportCenterX
        ? "start"
        : "end";
  const vertical =
    centerY === viewportCenterY
      ? previous.vertical
      : centerY < viewportCenterY
        ? "start"
        : "end";

  return positionFromAnchor(
    {
      x: horizontalAnchor(bounded, horizontal),
      y: verticalAnchor(bounded, vertical),
    },
    viewport,
    horizontal,
    vertical,
  );
}
