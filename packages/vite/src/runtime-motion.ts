import {
  createExecutionIsland,
  createFloatingSurfaceMotionController,
  createFloatingSurfaceMotionStyles,
  registerFloatingSurfaceMotionExtension,
} from "@spotpatch/runtime/motion";

registerFloatingSurfaceMotionExtension(
  Object.freeze({
    createExecutionIsland,
    createController: createFloatingSurfaceMotionController,
    createStyles: createFloatingSurfaceMotionStyles,
  }),
);
