import { describe, expect, it } from "vitest";

import {
  DEFAULT_FLOATING_SURFACE_POSITION,
  positionFromFloatingSurfaceRect,
  resolveFloatingSurfaceRect,
  snapFloatingSurfaceRect,
} from "./floating-surface-position.js";

const viewport = Object.freeze({ height: 600, left: 20, top: 10, width: 1_000 });

describe("floating surface position", () => {
  it("anchors the default surface to the lower-right safe viewport corner", () => {
    expect(
      resolveFloatingSurfaceRect(
        DEFAULT_FLOATING_SURFACE_POSITION,
        { height: 44, width: 160 },
        viewport,
      ),
    ).toEqual({ height: 44, left: 860, top: 566, width: 160 });
  });

  it("keeps an oversized surface inside the safe viewport", () => {
    expect(
      resolveFloatingSurfaceRect(
        {
          horizontal: "start",
          vertical: "start",
          xRatio: 0,
          yRatio: 0,
        },
        { height: 800, width: 1_200 },
        viewport,
      ),
    ).toEqual({ height: 800, left: 20, top: 10, width: 1_200 });
  });

  it("snaps a bounded surface to its nearest eligible viewport edges", () => {
    expect(
      snapFloatingSurfaceRect(
        { height: 100, left: 23, top: 507, width: 200 },
        viewport,
        8,
      ),
    ).toEqual({ height: 100, left: 20, top: 510, width: 200 });
  });

  it("preserves a released surface rectangle while selecting a stable expansion side", () => {
    const position = positionFromFloatingSurfaceRect(
      { height: 44, left: 60, top: 40, width: 160 },
      viewport,
      DEFAULT_FLOATING_SURFACE_POSITION,
    );

    expect(position).toEqual({
      horizontal: "start",
      vertical: "start",
      xRatio: 0.04,
      yRatio: 0.05,
    });
    expect(
      resolveFloatingSurfaceRect(position, { height: 44, width: 160 }, viewport),
    ).toEqual({ height: 44, left: 60, top: 40, width: 160 });
  });

  it("keeps the previous alignment exactly on a viewport center line", () => {
    expect(
      positionFromFloatingSurfaceRect(
        { height: 100, left: 420, top: 260, width: 200 },
        viewport,
        DEFAULT_FLOATING_SURFACE_POSITION,
      ),
    ).toMatchObject({ horizontal: "end", vertical: "end" });
  });
});
