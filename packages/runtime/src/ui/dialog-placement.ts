import type { ElementRect } from "../picker/geometry.js";

export type DialogPlacementMode =
  "above" | "below" | "center" | "left" | "right" | "viewport";

export interface DialogPlacement {
  readonly anchorX: number;
  readonly anchorY: number;
  readonly left: number;
  readonly mode: DialogPlacementMode;
  readonly top: number;
}

export interface DialogPlacementInput {
  readonly dialogHeight: number;
  readonly dialogWidth: number;
  readonly target: ElementRect;
  readonly viewportHeight: number;
  readonly viewportWidth: number;
}

const VIEWPORT_MARGIN = 16;
const TARGET_GAP = 14;
const TARGET_INSET = 24;
const ANCHOR_INSET = 22;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function calculateDialogPlacement({
  dialogHeight,
  dialogWidth,
  target,
  viewportHeight,
  viewportWidth,
}: DialogPlacementInput): DialogPlacement {
  const maxLeft = viewportWidth - dialogWidth - VIEWPORT_MARGIN;
  const maxTop = viewportHeight - dialogHeight - VIEWPORT_MARGIN;
  const targetCenterX = target.x + target.width / 2;
  const targetCenterY = target.y + target.height / 2;
  const centeredLeft = clamp(targetCenterX - dialogWidth / 2, VIEWPORT_MARGIN, maxLeft);
  const centeredTop = clamp(targetCenterY - dialogHeight / 2, VIEWPORT_MARGIN, maxTop);
  let left = centeredLeft;
  let top = centeredTop;
  let mode: DialogPlacementMode = "viewport";

  if (
    target.width >= dialogWidth + TARGET_INSET * 2 &&
    target.height >= dialogHeight + TARGET_INSET * 2
  ) {
    mode = "center";
  } else if (target.y - dialogHeight - TARGET_GAP >= VIEWPORT_MARGIN) {
    top = target.y - dialogHeight - TARGET_GAP;
    mode = "above";
  } else if (
    target.y + target.height + TARGET_GAP + dialogHeight <=
    viewportHeight - VIEWPORT_MARGIN
  ) {
    top = target.y + target.height + TARGET_GAP;
    mode = "below";
  } else if (
    target.x + target.width + TARGET_GAP + dialogWidth <=
    viewportWidth - VIEWPORT_MARGIN
  ) {
    left = target.x + target.width + TARGET_GAP;
    mode = "right";
  } else if (target.x - dialogWidth - TARGET_GAP >= VIEWPORT_MARGIN) {
    left = target.x - dialogWidth - TARGET_GAP;
    mode = "left";
  }

  return Object.freeze({
    anchorX: clamp(targetCenterX - left, ANCHOR_INSET, dialogWidth - ANCHOR_INSET),
    anchorY: clamp(targetCenterY - top, ANCHOR_INSET, dialogHeight - ANCHOR_INSET),
    left,
    mode,
    top,
  });
}
