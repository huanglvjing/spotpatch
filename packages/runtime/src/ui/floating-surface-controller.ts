import type { FloatingSurfaceSession } from "../state/floating-surface-session.js";
import {
  DEFAULT_FLOATING_SURFACE_POSITION,
  positionFromAnchor,
  positionFromFloatingSurfaceRect,
  resolveFloatingSurfaceRect,
  snapFloatingSurfaceRect,
  type FloatingSurfacePosition,
  type FloatingSurfaceRect,
  type FloatingSurfaceViewport,
} from "./floating-surface-position.js";

export interface FloatingSurfaceLayout {
  readonly compactInset: number;
  readonly compactViewportWidth: number;
  readonly desktopInset: number;
  readonly dragActivationDistance: number;
  readonly edgeSnapDistance: number;
}

export interface FloatingSurfaceDraggableOptions {
  readonly canStartDrag?: (event: PointerEvent) => boolean;
  readonly onDragStart?: () => void;
  readonly suppressClickOnDrag?: boolean;
}

export interface FloatingSurfaceController {
  readonly attachDraggable: (
    handle: HTMLElement,
    surface: HTMLElement,
    options?: FloatingSurfaceDraggableOptions,
  ) => void;
  readonly dispose: () => void;
  readonly isCompact: () => boolean;
  readonly reconcile: () => void;
  readonly registerSurface: (surface: HTMLElement) => void;
  readonly requestReconcile: () => void;
  readonly reset: () => void;
}

interface DragState {
  readonly anchorOffsetX: number;
  readonly anchorOffsetY: number;
  readonly handle: HTMLElement;
  readonly onDragStart?: () => void;
  readonly pointerId: number;
  readonly suppressClickOnDrag: boolean;
  readonly startX: number;
  readonly startY: number;
  readonly surface: HTMLElement;
}

interface PointerCoordinates {
  readonly x: number;
  readonly y: number;
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function distanceBetween(
  first: PointerCoordinates,
  second: PointerCoordinates,
): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function isPrimaryPointer(event: PointerEvent): boolean {
  return event.button === 0 && event.isPrimary;
}

function surfaceSize(
  surface: HTMLElement,
): Readonly<{ height: number; width: number }> {
  const rect = surface.getBoundingClientRect();

  return Object.freeze({
    height: Math.max(0, finite(rect.height)),
    width: Math.max(0, finite(rect.width)),
  });
}

function requestFrame(window: Window, callback: FrameRequestCallback): number {
  if (typeof window.requestAnimationFrame === "function") {
    return window.requestAnimationFrame(callback);
  }

  return window.setTimeout(() => {
    callback(Date.now());
  }, 0);
}

function cancelFrame(window: Window, frame: number): void {
  if (typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(frame);
    return;
  }

  window.clearTimeout(frame);
}

export function createFloatingSurfaceController(
  window: Window,
  session: FloatingSurfaceSession,
  layout: FloatingSurfaceLayout,
): FloatingSurfaceController {
  let position = session.load() ?? DEFAULT_FLOATING_SURFACE_POSITION;
  let drag: DragState | undefined;
  let frame: number | undefined;
  let suppressClickFor: HTMLElement | undefined;
  let suppressClickTimer: number | undefined;
  let disposed = false;
  const surfaces = new Set<HTMLElement>();
  const cleanup = new Set<() => void>();

  function viewport(): FloatingSurfaceViewport {
    const visualViewport = window.visualViewport;
    const width = Math.max(0, finite(visualViewport?.width ?? window.innerWidth));
    const height = Math.max(0, finite(visualViewport?.height ?? window.innerHeight));
    const inset =
      width <= layout.compactViewportWidth ? layout.compactInset : layout.desktopInset;

    return Object.freeze({
      height: Math.max(0, height - inset * 2),
      left: finite(visualViewport?.offsetLeft ?? 0) + inset,
      top: finite(visualViewport?.offsetTop ?? 0) + inset,
      width: Math.max(0, width - inset * 2),
    });
  }

  function isCompact(): boolean {
    return viewport().width + layout.compactInset * 2 <= layout.compactViewportWidth;
  }

  function apply(surface: HTMLElement): FloatingSurfaceRect | undefined {
    if (surface.hidden) {
      return undefined;
    }

    if (
      surface.dataset.motionMorphing === "true" &&
      surface.dataset.floatingPositioned === "true"
    ) {
      return undefined;
    }

    const size = surfaceSize(surface);

    if (size.width === 0 || size.height === 0) {
      return undefined;
    }

    const rect = resolveFloatingSurfaceRect(position, size, viewport());
    surface.style.left = `${String(rect.left)}px`;
    surface.style.top = `${String(rect.top)}px`;
    surface.style.right = "auto";
    surface.style.bottom = "auto";
    surface.dataset.floatingPositioned = "true";

    return rect;
  }

  function reconcile(): void {
    if (disposed) {
      return;
    }

    if (frame !== undefined) {
      cancelFrame(window, frame);
      frame = undefined;
    }

    for (const surface of surfaces) {
      apply(surface);
    }
  }

  function requestReconcile(): void {
    if (disposed || frame !== undefined) {
      return;
    }

    frame = requestFrame(window, () => {
      frame = undefined;
      reconcile();
    });
  }

  function commit(nextPosition: FloatingSurfacePosition): void {
    position = nextPosition;
    session.save(position);
  }

  function finishDrag(commitPosition: boolean): void {
    const current = drag;

    if (current === undefined) {
      return;
    }

    drag = undefined;
    current.handle.dataset.dragging = "false";
    current.surface.dataset.dragging = "false";

    try {
      if (current.handle.hasPointerCapture(current.pointerId)) {
        current.handle.releasePointerCapture(current.pointerId);
      }
    } catch {
      // Capture can already be released by the browser during cancellation.
    }

    if (commitPosition) {
      const rect = apply(current.surface);

      if (rect !== undefined) {
        const snapped = snapFloatingSurfaceRect(
          rect,
          viewport(),
          layout.edgeSnapDistance,
        );
        commit(positionFromFloatingSurfaceRect(snapped, viewport(), position));
        apply(current.surface);
      }
    } else {
      position = session.load() ?? DEFAULT_FLOATING_SURFACE_POSITION;
      reconcile();
    }
  }

  function updateDrag(event: PointerEvent): void {
    const current = drag;

    if (current === undefined) {
      return;
    }

    if (event.pointerId !== current.pointerId) {
      return;
    }

    const pointer = Object.freeze({ x: event.clientX, y: event.clientY });
    const start = Object.freeze({ x: current.startX, y: current.startY });

    if (
      current.handle.dataset.dragging !== "true" &&
      distanceBetween(pointer, start) < layout.dragActivationDistance
    ) {
      return;
    }

    if (current.handle.dataset.dragging !== "true") {
      current.onDragStart?.();
    }
    current.handle.dataset.dragging = "true";
    current.surface.dataset.dragging = "true";
    position = positionFromAnchor(
      {
        x: pointer.x + current.anchorOffsetX,
        y: pointer.y + current.anchorOffsetY,
      },
      viewport(),
      position.horizontal,
      position.vertical,
    );
    requestReconcile();
    event.preventDefault();
  }

  function addListener(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    target.addEventListener(type, listener, options);
    cleanup.add(() => {
      target.removeEventListener(type, listener, options);
    });
  }

  function attachDraggable(
    handle: HTMLElement,
    surface: HTMLElement,
    options: FloatingSurfaceDraggableOptions = {},
  ): void {
    const onPointerDown = (event: PointerEvent): void => {
      if (
        disposed ||
        drag !== undefined ||
        !isPrimaryPointer(event) ||
        options.canStartDrag?.(event) === false
      ) {
        return;
      }

      const rect = apply(surface) ?? surface.getBoundingClientRect();
      const anchorX =
        position.horizontal === "end" ? rect.left + rect.width : rect.left;
      const anchorY = position.vertical === "end" ? rect.top + rect.height : rect.top;
      drag = Object.freeze({
        anchorOffsetX: anchorX - event.clientX,
        anchorOffsetY: anchorY - event.clientY,
        handle,
        ...(options.onDragStart === undefined
          ? {}
          : { onDragStart: options.onDragStart }),
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        suppressClickOnDrag: options.suppressClickOnDrag ?? false,
        surface,
      });

      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is progressive enhancement; document listeners still receive end events.
      }
    };
    const onLostPointerCapture = (event: PointerEvent): void => {
      if (drag?.pointerId === event.pointerId) {
        finishDrag(handle.dataset.dragging === "true");
      }
    };
    const onClickCapture = (event: MouseEvent): void => {
      if (suppressClickFor !== handle) {
        return;
      }

      suppressClickFor = undefined;

      if (suppressClickTimer !== undefined) {
        window.clearTimeout(suppressClickTimer);
        suppressClickTimer = undefined;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
    };

    addListener(handle, "pointerdown", (event) => {
      onPointerDown(event as PointerEvent);
    });
    addListener(handle, "lostpointercapture", (event) => {
      onLostPointerCapture(event as PointerEvent);
    });
    addListener(
      handle,
      "click",
      (event) => {
        onClickCapture(event as MouseEvent);
      },
      true,
    );
  }

  function reset(): void {
    finishDrag(false);
    position = DEFAULT_FLOATING_SURFACE_POSITION;
    session.clear();
    reconcile();
  }

  function cancelOnWindowBlur(): void {
    finishDrag(false);
  }

  function cancelOnEscape(event: KeyboardEvent): void {
    if (event.key !== "Escape" || drag === undefined) {
      return;
    }

    finishDrag(false);
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function endPointer(event: PointerEvent): void {
    if (drag?.pointerId !== event.pointerId) {
      return;
    }

    const current = drag;
    const moved = current.handle.dataset.dragging === "true";
    finishDrag(moved);

    if (moved && current.suppressClickOnDrag) {
      suppressClickFor = current.handle;
      suppressClickTimer = window.setTimeout(() => {
        suppressClickFor = undefined;
        suppressClickTimer = undefined;
      }, 0);
    }
  }

  function cancelPointer(event: PointerEvent): void {
    if (drag?.pointerId === event.pointerId) {
      finishDrag(false);
    }
  }

  addListener(window, "pointermove", (event) => {
    updateDrag(event as PointerEvent);
  });
  addListener(window, "pointerup", (event) => {
    endPointer(event as PointerEvent);
  });
  addListener(window, "pointercancel", (event) => {
    cancelPointer(event as PointerEvent);
  });
  addListener(window, "resize", requestReconcile);
  addListener(window, "blur", cancelOnWindowBlur);
  addListener(
    window,
    "keydown",
    (event) => {
      cancelOnEscape(event as KeyboardEvent);
    },
    true,
  );
  window.visualViewport?.addEventListener("resize", requestReconcile);
  window.visualViewport?.addEventListener("scroll", requestReconcile);
  cleanup.add(() =>
    window.visualViewport?.removeEventListener("resize", requestReconcile),
  );
  cleanup.add(() =>
    window.visualViewport?.removeEventListener("scroll", requestReconcile),
  );

  return Object.freeze({
    attachDraggable,

    dispose(): void {
      if (disposed) {
        return;
      }

      disposed = true;
      finishDrag(false);

      if (frame !== undefined) {
        cancelFrame(window, frame);
        frame = undefined;
      }

      if (suppressClickTimer !== undefined) {
        window.clearTimeout(suppressClickTimer);
        suppressClickTimer = undefined;
      }

      suppressClickFor = undefined;

      for (const disposeListener of cleanup) {
        disposeListener();
      }

      cleanup.clear();
      surfaces.clear();
    },

    isCompact,

    reconcile,

    registerSurface(surface: HTMLElement): void {
      surfaces.add(surface);
    },

    requestReconcile,

    reset,
  });
}
