// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type { FloatingSurfaceSession } from "../state/floating-surface-session.js";
import { createFloatingSurfaceController } from "./floating-surface-controller.js";
import { FLOATING_SURFACE_LAYOUT } from "./ui-constants.js";

function rect(width: number, height: number): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    right: width,
    bottom: height,
    left: 0,
    width,
    height,
    toJSON: () => ({}),
  };
}

function pointerEvent(
  type: string,
  clientX: number,
  clientY: number,
  pointerId = 1,
): PointerEvent {
  const event = new Event(type, {
    bubbles: true,
    cancelable: true,
  }) as PointerEvent;

  Object.defineProperties(event, {
    button: { value: 0 },
    clientX: { value: clientX },
    clientY: { value: clientY },
    isPrimary: { value: true },
    pointerId: { value: pointerId },
  });

  return event;
}

function createSession(): FloatingSurfaceSession {
  return Object.freeze({
    clear: vi.fn(),
    load: vi.fn(() => undefined),
    save: vi.fn(),
  });
}

describe("floating surface controller", () => {
  it("positions the compact trigger at the lower-right safe inset", () => {
    const session = createSession();
    const controller = createFloatingSurfaceController(
      window,
      session,
      FLOATING_SURFACE_LAYOUT,
    );
    const trigger = document.createElement("button");
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(rect(160, 44));
    document.body.append(trigger);
    controller.registerSurface(trigger);

    controller.reconcile();

    expect(trigger.style.left).toBe("840px");
    expect(trigger.style.top).toBe("700px");
    expect(trigger.dataset.floatingPositioned).toBe("true");

    controller.dispose();
    trigger.remove();
  });

  it("commits a dragged position, snaps it to an edge, and suppresses the drag click", () => {
    const session = createSession();
    const controller = createFloatingSurfaceController(
      window,
      session,
      FLOATING_SURFACE_LAYOUT,
    );
    const surface = document.createElement("button");
    const onClick = vi.fn();
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(rect(160, 44));
    surface.addEventListener("click", onClick);
    document.body.append(surface);
    controller.registerSurface(surface);
    controller.attachDraggable(surface, surface, { suppressClickOnDrag: true });
    controller.reconcile();

    surface.dispatchEvent(pointerEvent("pointerdown", 900, 720));
    window.dispatchEvent(pointerEvent("pointermove", 100, 100));
    window.dispatchEvent(pointerEvent("pointerup", 100, 100));
    surface.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(session.save).toHaveBeenCalledOnce();
    expect(surface.style.left).toBe("24px");
    expect(surface.style.top).toBe("80px");
    expect(onClick).not.toHaveBeenCalled();

    controller.reset();

    expect(session.clear).toHaveBeenCalledOnce();
    expect(surface.style.left).toBe("840px");
    expect(surface.style.top).toBe("700px");

    controller.dispose();
    surface.remove();
  });

  it("cancels an in-progress drag before the Runtime escape handler can run", () => {
    const session = createSession();
    const controller = createFloatingSurfaceController(
      window,
      session,
      FLOATING_SURFACE_LAYOUT,
    );
    const surface = document.createElement("button");
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(rect(160, 44));
    document.body.append(surface);
    controller.registerSurface(surface);
    controller.attachDraggable(surface, surface);
    controller.reconcile();

    surface.dispatchEvent(pointerEvent("pointerdown", 900, 720));
    window.dispatchEvent(pointerEvent("pointermove", 100, 100));
    const escape = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    });
    window.dispatchEvent(escape);

    expect(escape.defaultPrevented).toBe(true);
    expect(session.save).not.toHaveBeenCalled();
    expect(surface.style.left).toBe("840px");
    expect(surface.style.top).toBe("700px");

    controller.dispose();
    surface.remove();
  });
});
