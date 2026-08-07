import { describe, expect, it } from "vitest";

import { calculateDialogPlacement } from "./dialog-placement.js";

describe("dialog placement", () => {
  it("centers the workbench inside a sufficiently large selection", () => {
    expect(
      calculateDialogPlacement({
        target: { x: 40, y: 120, width: 1_200, height: 640 },
        dialogWidth: 460,
        dialogHeight: 520,
        viewportWidth: 1_440,
        viewportHeight: 900,
      }),
    ).toMatchObject({ left: 410, mode: "center", top: 180 });
  });

  it("places the workbench above a compact selection when space is available", () => {
    expect(
      calculateDialogPlacement({
        target: { x: 520, y: 620, width: 120, height: 48 },
        dialogWidth: 460,
        dialogHeight: 440,
        viewportWidth: 1_280,
        viewportHeight: 800,
      }),
    ).toMatchObject({ left: 350, mode: "above", top: 166 });
  });

  it("keeps the workbench inside a narrow viewport when no side fully fits", () => {
    const placement = calculateDialogPlacement({
      target: { x: 170, y: 300, width: 40, height: 40 },
      dialogWidth: 328,
      dialogHeight: 520,
      viewportWidth: 360,
      viewportHeight: 640,
    });

    expect(placement.mode).toBe("viewport");
    expect(placement.left).toBe(16);
    expect(placement.top).toBe(60);
    expect(placement.anchorX).toBeGreaterThanOrEqual(22);
    expect(placement.anchorX).toBeLessThanOrEqual(306);
  });
});
