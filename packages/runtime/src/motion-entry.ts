import {
  createFloatingSurfaceMotionController,
  createFloatingSurfaceMotionStyles,
} from "./ui/motion-controller.js";
import { createExecutionIsland } from "./ui/execution-island.js";
import {
  registerFloatingSurfaceMotionExtension,
  type FloatingSurfaceMotionExtension,
} from "./ui/motion-extension-contract.js";

const FLOATING_SURFACE_MOTION_EXTENSION = Object.freeze({
  createExecutionIsland,
  createController: createFloatingSurfaceMotionController,
  createStyles: createFloatingSurfaceMotionStyles,
}) satisfies FloatingSurfaceMotionExtension;

export function installFloatingSurfaceMotionExtension(): void {
  registerFloatingSurfaceMotionExtension(FLOATING_SURFACE_MOTION_EXTENSION);
}

export {
  createExecutionIsland,
  createFloatingSurfaceMotionController,
  createFloatingSurfaceMotionStyles,
};
export {
  getFloatingSurfaceMotionExtension,
  registerFloatingSurfaceMotionExtension,
  type FloatingSurfaceMotionController,
  type FloatingSurfaceMotionElements,
  type FloatingSurfaceMotionExtension,
  type FloatingSurfaceProjection,
  type FloatingSurfaceScene,
  type FloatingSurfaceTone,
  type MotionExecutionIsland,
} from "./ui/motion-extension-contract.js";
