import { afterEach, describe, expect, it } from "vitest";

import {
  createExecutionIsland,
  createFloatingSurfaceMotionController,
  createFloatingSurfaceMotionStyles,
  getFloatingSurfaceMotionExtension,
  installFloatingSurfaceMotionExtension,
} from "./motion-entry.js";

afterEach(() => {
  Reflect.deleteProperty(globalThis, Symbol.for("spotpatch.motion.v1"));
});

describe("Motion entry", () => {
  it("installs one reusable extension backed by the production factories", () => {
    installFloatingSurfaceMotionExtension();
    const extension = getFloatingSurfaceMotionExtension();

    expect(extension).toBeDefined();
    expect(extension).toMatchObject({
      createExecutionIsland,
      createController: createFloatingSurfaceMotionController,
      createStyles: createFloatingSurfaceMotionStyles,
    });
    expect(Object.isFrozen(extension)).toBe(true);

    installFloatingSurfaceMotionExtension();
    expect(getFloatingSurfaceMotionExtension()).toBe(extension);
  });
});
