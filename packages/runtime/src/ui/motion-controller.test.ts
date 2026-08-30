// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createFloatingSurfaceMotionController,
  createFloatingSurfaceMotionStyles,
} from "./motion-controller.js";
import type { FloatingSurfaceProjection } from "./motion-extension-contract.js";
import { createExecutionIsland } from "./execution-island.js";

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  };
}

function projection(
  scene: FloatingSurfaceProjection["scene"],
): FloatingSurfaceProjection {
  return Object.freeze({
    scene,
    tone: scene === "success" ? "success" : "running",
    headline: "Codex is applying changes",
    action: "Read src/fixtures.tsx",
    meta: "Running",
    recentActivities: Object.freeze([]),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("floating surface motion controller", () => {
  it("keeps one shell while switching planner and execution scenes", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    const surface = document.createElement("div");
    const pill = document.createElement("button");
    const planner = document.createElement("section");
    const execution = createExecutionIsland(document);
    execution.render(projection("running"));
    surface.append(pill, planner, execution.elements.root);
    document.body.append(surface);
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(
      rect(600, 400, 420, 112),
    );
    const reconcile = vi.fn();
    const controller = createFloatingSurfaceMotionController(
      document,
      {
        surface,
        pill,
        planner,
        execution: execution.elements,
      },
      reconcile,
    );

    controller.render(projection("running"), () => {
      execution.render(projection("running"));
    });

    expect(surface.dataset.scene).toBe("running");
    expect(surface.style.getPropertyValue("--spotpatch-island-compact-width")).toBe(
      "468px",
    );
    expect(pill.hidden).toBe(true);
    expect(planner.hidden).toBe(true);
    expect(execution.elements.root.hidden).toBe(false);
    expect(execution.elements.headline.textContent).toBe("Codex is applying changes");
    expect(surface.querySelectorAll(".spotpatch-island-sweep")).toHaveLength(1);
    expect(reconcile).toHaveBeenCalledOnce();

    controller.render(projection("success"), () => {
      execution.render(projection("success"));
    });
    expect(surface.style.getPropertyValue("--spotpatch-island-compact-width")).toBe(
      "356px",
    );

    controller.render(projection("planner"), () => {
      execution.render(projection("planner"));
    });
    expect(surface.dataset.scene).toBe("planner");
    expect(planner.hidden).toBe(false);
    expect(execution.elements.root.hidden).toBe(true);
    controller.dispose();
    execution.dispose();
    expect(surface.querySelector(".spotpatch-motion-signal")).toBeNull();
  });

  it("restores an active scene when a repeated projection interrupts its reveal", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: false,
    } as MediaQueryList);
    const surface = document.createElement("div");
    const pill = document.createElement("button");
    const planner = document.createElement("section");
    const execution = createExecutionIsland(document);
    surface.append(pill, planner, execution.elements.root);
    document.body.append(surface);
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(rect(600, 400, 180, 48));
    const controller = createFloatingSurfaceMotionController(
      document,
      {
        surface,
        pill,
        planner,
        execution: execution.elements,
      },
      vi.fn(),
    );

    controller.render(projection("pill"), () => {
      execution.render(projection("pill"));
    });
    controller.render(projection("pill"), () => {
      execution.render(projection("pill"));
    });

    expect(pill.hidden).toBe(false);
    expect(pill.style.visibility).not.toBe("hidden");
    controller.dispose();
    execution.dispose();
  });

  it("uses one bounded sweep and no particle layer", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: false,
    } as MediaQueryList);
    const surface = document.createElement("div");
    const pill = document.createElement("button");
    const planner = document.createElement("section");
    const execution = createExecutionIsland(document);
    const source = document.createElement("button");
    const target = document.createElement("section");
    surface.append(pill, planner, execution.elements.root, source, target);
    document.body.append(surface);
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(
      rect(500, 300, 600, 500),
    );
    vi.spyOn(source, "getBoundingClientRect").mockReturnValue(rect(900, 700, 120, 40));
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue(rect(540, 500, 500, 120));
    const controller = createFloatingSurfaceMotionController(
      document,
      {
        surface,
        pill,
        planner,
        execution: execution.elements,
      },
      vi.fn(),
    );

    controller.render(projection("agent-charging"), () => {
      execution.render(projection("agent-charging"));
    });
    controller.dispatch(source, target);
    controller.dispatch(source, target);

    expect(surface.querySelectorAll(".spotpatch-island-sweep")).toHaveLength(1);
    expect(surface.querySelector(".spotpatch-motion-signal")).toBeNull();
    expect(surface.querySelector(".spotpatch-agent-core")).toBeNull();
    controller.dispose();
    execution.dispose();
  });

  it("moves shared execution content and keeps detail visible through collapse", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: false,
    } as MediaQueryList);
    const surface = document.createElement("div");
    const pill = document.createElement("button");
    const planner = document.createElement("section");
    const execution = createExecutionIsland(document);
    execution.render({
      ...projection("running"),
      recentActivities: Object.freeze([
        Object.freeze({
          detail: "src/fixtures.tsx",
          key: "read:fixtures",
          kind: "read" as const,
          label: "read · src/fixtures.tsx",
          state: "success" as const,
        }),
      ]),
    });
    surface.dataset.scene = "running";
    surface.style.borderRadius = "31px";
    surface.append(pill, planner, execution.elements.root);
    document.body.append(surface);

    const surfaceRect = (): DOMRect =>
      execution.isExpanded() ? rect(500, 300, 520, 164) : rect(552, 402, 468, 62);
    vi.spyOn(surface, "getBoundingClientRect").mockImplementation(surfaceRect);
    for (const [element, compactOffset, expandedOffset] of [
      [execution.elements.mark, [18, 19], [20, 18]],
      [execution.elements.content, [53, 20], [55, 18]],
      [execution.elements.meta, [380, 19], [472, 18]],
    ] as const) {
      vi.spyOn(element, "getBoundingClientRect").mockImplementation(() => {
        const parent = surfaceRect();
        const [x, y] = execution.isExpanded() ? expandedOffset : compactOffset;
        return rect(parent.left + x, parent.top + y, 24, 24);
      });
    }
    const controller = createFloatingSurfaceMotionController(
      document,
      {
        surface,
        pill,
        planner,
        execution: execution.elements,
      },
      () => {
        surface.style.borderRadius = execution.isExpanded() ? "30px" : "31px";
      },
    );

    controller.updateLayout(() => {
      execution.setExpanded(true);
    });

    expect(surface.dataset.motionMorphing).toBe("true");
    expect(execution.elements.recent.hidden).toBe(false);
    expect(execution.elements.mark.style.transform).not.toBe("");
    expect(execution.elements.recent.style.opacity).toBe("0");

    controller.updateLayout(() => {
      execution.setExpanded(false);
    });

    expect(execution.elements.recent.hidden).toBe(false);
    controller.cancel();
    expect(surface.dataset.motionMorphing).toBeUndefined();
    expect(execution.elements.recent.hidden).toBe(true);
    expect(execution.elements.mark.style.transform).toBe("");
    controller.dispose();
    execution.dispose();
  });

  it("ships reduced-motion and background-pause safeguards in the isolated styles", () => {
    const style = createFloatingSurfaceMotionStyles(document);

    expect(style.textContent).toContain("prefers-reduced-motion: reduce");
    expect(style.textContent).toContain('data-motion-paused="true"');
    expect(style.textContent).toContain("spotpatch-motion-copy-in");
    expect(style.textContent).toContain(
      "width: min(var(--spotpatch-island-compact-width), calc(100vw - 32px))",
    );
    expect(style.textContent).toContain("--spotpatch-island-compact-height: 62px");
    expect(style.textContent).toContain("--spotpatch-island-expanded-width: 520px");
    expect(style.textContent).toContain("position: absolute;\n      top: 62px");
    expect(style.textContent).not.toContain("transition: border-radius");
    expect(style.textContent).not.toContain("spotpatch-motion-core");
  });
});
