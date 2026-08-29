import {
  createFloatingSurfaceMotionController,
  createFloatingSurfaceMotionStyles,
  registerFloatingSurfaceMotionExtension,
} from "@spotpatch/runtime/motion";

registerFloatingSurfaceMotionExtension(
  Object.freeze({
    createController: createFloatingSurfaceMotionController,
    createStyles: createFloatingSurfaceMotionStyles,
  }),
);
