// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createFloatingSurfaceMotionController,
  createFloatingSurfaceMotionStyles,
} from "./motion-controller.js";
import type { FloatingSurfaceProjection } from "./motion-extension-contract.js";

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
    identity: "Codex · gpt-test",
    title: "Running verified task",
    detail: "#2 · accepted / started",
    phase: "running",
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
    const execution = document.createElement("button");
    const identity = document.createElement("span");
    const title = document.createElement("strong");
    const detail = document.createElement("span");
    const phase = document.createElement("span");
    execution.append(identity, title, detail, phase);
    surface.append(pill, planner, execution);
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
        execution,
        executionIdentity: identity,
        executionTitle: title,
        executionDetail: detail,
        executionPhase: phase,
      },
      reconcile,
    );

    controller.render(projection("running"));

    expect(surface.dataset.scene).toBe("running");
    expect(pill.hidden).toBe(true);
    expect(planner.hidden).toBe(true);
    expect(execution.hidden).toBe(false);
    expect(identity.textContent).toBe("Codex · gpt-test");
    expect(title.textContent).toBe("Running verified task");
    expect(surface.querySelectorAll(".spotpatch-motion-signal")).toHaveLength(1);
    expect(reconcile).toHaveBeenCalledOnce();

    controller.render(projection("planner"));
    expect(surface.dataset.scene).toBe("planner");
    expect(planner.hidden).toBe(false);
    expect(execution.hidden).toBe(true);
    controller.dispose();
    expect(surface.querySelector(".spotpatch-motion-signal")).toBeNull();
  });

  it("reuses a bounded five-particle signal layer", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: false,
    } as MediaQueryList);
    const surface = document.createElement("div");
    const pill = document.createElement("button");
    const planner = document.createElement("section");
    const execution = document.createElement("button");
    const source = document.createElement("button");
    const target = document.createElement("section");
    surface.append(pill, planner, execution, source, target);
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
        execution,
        executionIdentity: document.createElement("span"),
        executionTitle: document.createElement("strong"),
        executionDetail: document.createElement("span"),
        executionPhase: document.createElement("span"),
      },
      vi.fn(),
    );

    controller.signal(source, target);
    controller.signal(source, target);

    expect(surface.querySelectorAll(".spotpatch-motion-signal")).toHaveLength(1);
    expect(surface.querySelectorAll(".spotpatch-motion-signal circle")).toHaveLength(5);
    expect(surface.dataset.agentCharging).toBe("true");
    controller.dispose();
  });

  it("ships reduced-motion and background-pause safeguards in the isolated styles", () => {
    const style = createFloatingSurfaceMotionStyles(document);

    expect(style.textContent).toContain("prefers-reduced-motion: reduce");
    expect(style.textContent).toContain('data-motion-paused="true"');
    expect(style.textContent).toContain("spotpatch-motion-breathe");
  });
});
