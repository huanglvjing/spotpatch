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

    controller.render(projection("running"));

    expect(surface.dataset.scene).toBe("running");
    expect(pill.hidden).toBe(true);
    expect(planner.hidden).toBe(true);
    expect(execution.elements.root.hidden).toBe(false);
    expect(execution.elements.headline.textContent).toBe("Codex is applying changes");
    expect(surface.querySelectorAll(".spotpatch-motion-signal")).toHaveLength(1);
    expect(reconcile).toHaveBeenCalledOnce();

    controller.render(projection("planner"));
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

    controller.render(projection("pill"));
    controller.render(projection("pill"));

    expect(pill.hidden).toBe(false);
    expect(pill.style.visibility).not.toBe("hidden");
    controller.dispose();
    execution.dispose();
  });

  it("reuses a bounded five-particle signal layer", () => {
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

    controller.render(projection("agent-charging"));
    controller.dispatch(source, target);
    controller.dispatch(source, target);

    expect(surface.querySelectorAll(".spotpatch-motion-signal")).toHaveLength(1);
    expect(surface.querySelectorAll(".spotpatch-motion-signal circle")).toHaveLength(5);
    controller.dispose();
    execution.dispose();
  });

  it("ships reduced-motion and background-pause safeguards in the isolated styles", () => {
    const style = createFloatingSurfaceMotionStyles(document);

    expect(style.textContent).toContain("prefers-reduced-motion: reduce");
    expect(style.textContent).toContain('data-motion-paused="true"');
    expect(style.textContent).toContain("spotpatch-motion-core");
  });
});
