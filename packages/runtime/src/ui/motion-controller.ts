import { gsap } from "gsap";

import type {
  FloatingSurfaceMotionController,
  FloatingSurfaceMotionElements,
  FloatingSurfaceProjection,
} from "./motion-extension-contract.js";
import { THEME_MOTION_COLORS } from "./theme.js";

const MOTION = Object.freeze({
  contentMilliseconds: 220,
  detailRevealDelaySeconds: 0.1,
  detailRevealSeconds: 0.3,
  detailRetireSeconds: 0.15,
  dispatchSeconds: 0.54,
  expandSeconds: 0.54,
  morphSeconds: 0.48,
  pressSeconds: 0.12,
  revealSeconds: 0.36,
  revealStaggerSeconds: 0.05,
  sceneRevealDelaySeconds: 0.12,
  sweepSeconds: 0.68,
  targetFeedbackDelaySeconds: 0.08,
  targetFeedbackSeconds: 0.22,
});

/** The planner shell's header, body and actions, revealed in that order. */
const PLANNER_SECTION_COUNT = 3;

function milliseconds(seconds: number): string {
  return `${String(Math.round(seconds * 1_000))}ms`;
}

function sectionRevealDelay(index: number): string {
  return milliseconds(
    MOTION.sceneRevealDelaySeconds + MOTION.revealStaggerSeconds * index,
  );
}

const ISLAND_SIZE = Object.freeze({
  checkingWidth: 440,
  compactHeight: 62,
  dispatchingWidth: 448,
  expandedHeight: 164,
  expandedWidth: 520,
  failedWidth: 440,
  receivingWidth: 430,
  runningWidth: 468,
  successWidth: 356,
});

interface PendingProjection {
  readonly projection: FloatingSurfaceProjection;
  readonly renderContent: () => void;
}

interface SurfaceGeometry {
  readonly borderRadius: string;
  readonly rect: DOMRect;
}

interface ElementOffset {
  readonly x: number;
  readonly y: number;
}

interface SurfaceLayout {
  readonly geometry: SurfaceGeometry;
  readonly sharedOffsets: ReadonlyMap<HTMLElement, ElementOffset>;
}

type DetailTransition = "collapse" | "expand" | undefined;

type SurfaceLayer = "execution" | "pill" | "planner";

function surfaceLayer(scene: FloatingSurfaceProjection["scene"]): SurfaceLayer {
  if (scene === "pill" || scene === "capturing") return "pill";
  if (scene === "planner") return "planner";
  return "execution";
}

function setSceneVisibility(
  elements: FloatingSurfaceMotionElements,
  projection: FloatingSurfaceProjection,
): HTMLElement {
  const pillActive = projection.scene === "pill" || projection.scene === "capturing";
  const plannerActive = projection.scene === "planner";
  const executionActive = !pillActive && !plannerActive;

  elements.pill.hidden = !pillActive;
  elements.pill.inert = !pillActive;
  elements.planner.hidden = !plannerActive;
  elements.planner.inert = !plannerActive;
  elements.planner.setAttribute("aria-hidden", String(!plannerActive));
  elements.execution.root.hidden = !executionActive;
  elements.execution.root.inert = !executionActive;
  elements.execution.root.setAttribute("aria-hidden", String(!executionActive));

  return pillActive
    ? elements.pill
    : plannerActive
      ? elements.planner
      : elements.execution.root;
}

function supportsMotion(document: Document): boolean {
  return (
    document.defaultView?.matchMedia("(prefers-reduced-motion: reduce)").matches !==
    true
  );
}

function finiteRect(rect: DOMRect): boolean {
  return (
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function geometryChanged(previous: DOMRect, next: DOMRect): boolean {
  return (
    Math.abs(previous.left - next.left) > 0.5 ||
    Math.abs(previous.top - next.top) > 0.5 ||
    Math.abs(previous.width - next.width) > 0.5 ||
    Math.abs(previous.height - next.height) > 0.5
  );
}

function visibleBorderRadius(value: string | undefined, rect: DOMRect): string {
  if (value === undefined || value.length === 0) return "0px";
  const radius = Number.parseFloat(value);
  if (!Number.isFinite(radius) || !finiteRect(rect)) return value;
  return `${String(Math.min(radius, rect.width / 2, rect.height / 2))}px`;
}

function compactIslandWidth(projection: FloatingSurfaceProjection): number {
  if (projection.scene === "agent-charging") return ISLAND_SIZE.receivingWidth;
  if (projection.scene === "handoff") return ISLAND_SIZE.dispatchingWidth;
  if (projection.scene === "success") return ISLAND_SIZE.successWidth;
  if (projection.scene === "failed") return ISLAND_SIZE.failedWidth;
  if (projection.scene === "running" && projection.activity?.kind === "check") {
    return ISLAND_SIZE.checkingWidth;
  }
  return ISLAND_SIZE.runningWidth;
}

export function createFloatingSurfaceMotionStyles(
  document: Document,
): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = `
    .spotpatch-floating-surface {
      --spotpatch-island-compact-height: ${String(ISLAND_SIZE.compactHeight)}px;
      --spotpatch-island-compact-width: ${String(ISLAND_SIZE.runningWidth)}px;
      --spotpatch-island-expanded-height: ${String(ISLAND_SIZE.expandedHeight)}px;
      --spotpatch-island-expanded-width: ${String(ISLAND_SIZE.expandedWidth)}px;
    }
    .spotpatch-floating-surface::before {
      position: absolute;
      z-index: 0;
      inset: 0;
      background:
        radial-gradient(160px 70px at 0% 50%, var(--spotpatch-accent-tint), transparent 72%),
        radial-gradient(160px 70px at 100% 50%, var(--spotpatch-cyan-tint), transparent 72%);
      content: "";
      opacity: 0;
      pointer-events: none;
      transition: opacity var(--spotpatch-duration-slow) ease;
    }
    .spotpatch-floating-surface[data-scene="agent-charging"],
    .spotpatch-floating-surface[data-scene="handoff"],
    .spotpatch-floating-surface[data-scene="running"],
    .spotpatch-floating-surface[data-scene="success"],
    .spotpatch-floating-surface[data-scene="failed"] {
      width: min(var(--spotpatch-island-compact-width), calc(100vw - 32px));
      height: var(--spotpatch-island-compact-height);
      max-width: calc(100vw - 32px);
      border-radius: var(--spotpatch-radius-pill);
    }
    .spotpatch-floating-surface[data-scene="agent-charging"]::before,
    .spotpatch-floating-surface[data-scene="handoff"]::before,
    .spotpatch-floating-surface[data-scene="running"]::before { opacity: 1; }
    .spotpatch-floating-surface[data-scene="success"] { border-color: color-mix(in srgb, var(--spotpatch-success) 32%, transparent); }
    .spotpatch-floating-surface[data-scene="failed"] { border-color: var(--spotpatch-danger-line); }
    .spotpatch-floating-surface:has(.spotpatch-execution-island[data-expanded="true"]) {
      width: min(var(--spotpatch-island-expanded-width), calc(100vw - 32px));
      height: min(var(--spotpatch-island-expanded-height), calc(100vh - 32px));
      border-radius: 28px;
    }
    .spotpatch-floating-surface > .spotpatch-trigger,
    .spotpatch-floating-surface > .spotpatch-dialog,
    .spotpatch-floating-surface > .spotpatch-execution-island {
      position: relative;
      z-index: 1;
    }

    .spotpatch-execution-island {
      display: grid;
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 12px;
      overflow: hidden;
      border: 0;
      border-radius: inherit;
      padding: 0 18px;
      color: var(--spotpatch-text);
      background: transparent;
      cursor: pointer;
      text-align: left;
      touch-action: none;
    }
    .spotpatch-execution-island[data-expanded="true"] {
      min-height: var(--spotpatch-island-expanded-height);
      grid-template-rows: auto 1fr;
      align-items: start;
      row-gap: 16px;
      padding: 18px 20px 16px;
    }
    .spotpatch-execution-mark {
      display: grid;
      width: 24px;
      height: 24px;
      flex: none;
      place-items: center;
    }
    .spotpatch-execution-logo {
      width: 22px;
      height: 22px;
      overflow: visible;
    }
    [data-execution-scene="agent-charging"] .spotpatch-execution-logo,
    [data-execution-scene="handoff"] .spotpatch-execution-logo,
    [data-execution-scene="running"] .spotpatch-execution-logo {
      animation: spotpatch-motion-logo-glow 2.4s ease-in-out infinite;
    }
    .spotpatch-execution-content {
      display: flex;
      min-width: 0;
      align-items: baseline;
      gap: 8px;
    }
    [data-expanded="true"] .spotpatch-execution-content {
      display: grid;
      gap: 4px;
    }
    .spotpatch-execution-headline-wrap,
    .spotpatch-execution-action-wrap {
      position: relative;
      display: block;
      min-width: 0;
    }
    .spotpatch-execution-headline,
    .spotpatch-execution-headline-outgoing,
    .spotpatch-execution-action,
    .spotpatch-execution-action-outgoing {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spotpatch-execution-headline,
    .spotpatch-execution-headline-outgoing {
      font-size: 14.5px;
      font-weight: 650;
      letter-spacing: -.015em;
      line-height: 1.35;
    }
    .spotpatch-execution-action,
    .spotpatch-execution-action-outgoing {
      color: var(--spotpatch-text-muted);
      font-size: 11.5px;
      line-height: 1.35;
    }
    .spotpatch-execution-headline-outgoing,
    .spotpatch-execution-action-outgoing {
      position: absolute;
      inset: 0;
      opacity: 0;
      pointer-events: none;
    }
    .spotpatch-execution-copy-changing .spotpatch-execution-headline,
    .spotpatch-execution-copy-changing .spotpatch-execution-action {
      animation: spotpatch-motion-copy-in ${String(MOTION.contentMilliseconds)}ms var(--spotpatch-ease-out) both;
    }
    .spotpatch-execution-copy-changing .spotpatch-execution-headline-outgoing,
    .spotpatch-execution-copy-changing .spotpatch-execution-action-outgoing {
      animation: spotpatch-motion-copy-out ${String(MOTION.contentMilliseconds)}ms ease-in both;
    }
    .spotpatch-execution-meta {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      color: var(--spotpatch-text-secondary);
      font-size: 11.5px;
      font-weight: 600;
      white-space: nowrap;
    }
    .spotpatch-execution-meta-dot {
      width: 6px;
      height: 6px;
      flex: none;
      border-radius: 50%;
      background: var(--spotpatch-accent);
      box-shadow: 0 0 10px var(--spotpatch-accent-line);
    }
    [data-execution-scene="agent-charging"] .spotpatch-execution-meta-dot,
    [data-execution-scene="handoff"] .spotpatch-execution-meta-dot,
    [data-execution-scene="running"] .spotpatch-execution-meta-dot {
      animation: spotpatch-motion-status-breathe 1.8s ease-in-out infinite;
    }
    .spotpatch-execution-meta[data-tone="success"] { color: var(--spotpatch-success-text); }
    .spotpatch-execution-meta[data-tone="success"] .spotpatch-execution-meta-dot {
      background: var(--spotpatch-success);
      box-shadow: 0 0 10px color-mix(in srgb, var(--spotpatch-success) 45%, transparent);
    }
    .spotpatch-execution-meta[data-tone="danger"] { color: var(--spotpatch-danger-text); }
    .spotpatch-execution-meta[data-tone="danger"] .spotpatch-execution-meta-dot {
      background: var(--spotpatch-danger);
      box-shadow: 0 0 10px var(--spotpatch-danger-line);
    }
    .spotpatch-execution-timer {
      width: 36px;
      color: var(--spotpatch-text-muted);
      font: 500 11px/1 var(--spotpatch-font-mono);
      font-variant-numeric: tabular-nums;
      text-align: right;
    }
    .spotpatch-execution-more {
      display: grid;
      width: 24px;
      height: 24px;
      place-items: center;
      border: 0;
      border-radius: 50%;
      padding: 0;
      color: var(--spotpatch-text-muted);
      background: transparent;
      font-size: 15px;
      line-height: 1;
      transition: background var(--spotpatch-duration-fast) ease;
    }
    .spotpatch-execution-island:hover .spotpatch-execution-more { background: var(--spotpatch-hover); }
    [data-expanded="true"] .spotpatch-execution-meta-dot,
    [data-expanded="true"] .spotpatch-execution-meta-label,
    [data-expanded="true"] .spotpatch-execution-timer { display: none; }
    [data-expanded="true"] .spotpatch-execution-more {
      width: 28px;
      height: 28px;
      background: var(--spotpatch-hover);
    }
    .spotpatch-execution-recent {
      position: absolute;
      top: 62px;
      right: 20px;
      left: 20px;
      display: grid;
    }
    .spotpatch-execution-recent-item {
      display: grid;
      min-height: 28px;
      grid-template-columns: 56px minmax(0, 1fr) auto;
      align-items: center;
      border-top: 1px solid var(--spotpatch-border-subtle);
    }
    .spotpatch-execution-recent-item:first-child { border-top: 0; }
    .spotpatch-execution-recent-kind,
    .spotpatch-execution-recent-state {
      color: var(--spotpatch-text-muted);
      font: 500 10.5px/1 var(--spotpatch-font-mono);
    }
    .spotpatch-execution-recent-kind { text-transform: uppercase; }
    .spotpatch-execution-recent-detail {
      overflow: hidden;
      color: var(--spotpatch-text-secondary);
      font-size: 11.5px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spotpatch-execution-recent-item[data-state="active"] .spotpatch-execution-recent-kind { color: var(--spotpatch-accent-soft); }
    .spotpatch-execution-recent-item[data-state="active"] .spotpatch-execution-recent-detail { color: var(--spotpatch-text); }
    .spotpatch-execution-recent-item[data-state="failure"] .spotpatch-execution-recent-kind { color: var(--spotpatch-danger-text); }
    .spotpatch-island-sweep {
      position: absolute;
      z-index: 2;
      bottom: 0;
      left: 44px;
      width: 22%;
      height: 1px;
      border-radius: var(--spotpatch-radius-pill);
      background: linear-gradient(90deg, transparent, var(--spotpatch-accent), var(--spotpatch-accent-cyan), transparent);
      box-shadow: 0 0 8px var(--spotpatch-accent-line);
      opacity: 0;
      pointer-events: none;
      transform: translate3d(-160%, 0, 0);
    }
    [data-motion-reveal="true"] .spotpatch-shell > * {
      animation: spotpatch-motion-section-in ${milliseconds(MOTION.revealSeconds)} var(--spotpatch-ease-out) both;
      animation-delay: ${sectionRevealDelay(0)};
    }
    [data-motion-reveal="true"] .spotpatch-shell > :nth-child(2) { animation-delay: ${sectionRevealDelay(1)}; }
    [data-motion-reveal="true"] .spotpatch-shell > :nth-child(3) { animation-delay: ${sectionRevealDelay(2)}; }
    @keyframes spotpatch-motion-section-in {
      from { opacity: 0; transform: translate3d(0, 8px, 0); }
    }
    @keyframes spotpatch-motion-copy-in {
      from { opacity: 0; filter: blur(2px); transform: translate3d(0, 4px, 0); }
    }
    @keyframes spotpatch-motion-copy-out {
      to { opacity: 0; filter: blur(2px); transform: translate3d(0, -4px, 0); }
    }
    @keyframes spotpatch-motion-status-breathe {
      50% { opacity: .4; transform: scale(.8); }
    }
    @keyframes spotpatch-motion-logo-glow {
      50% { filter: drop-shadow(0 0 7px var(--spotpatch-accent-line)); }
    }
    .spotpatch-floating-surface[data-motion-paused="true"] *,
    .spotpatch-floating-surface[data-motion-paused="true"] *::before {
      animation-play-state: paused;
    }
    @media (prefers-reduced-motion: reduce) {
      .spotpatch-execution-headline,
      .spotpatch-execution-headline-outgoing,
      .spotpatch-execution-action,
      .spotpatch-execution-action-outgoing {
        filter: none !important;
        transform: none !important;
      }
      .spotpatch-island-sweep { display: none; }
    }
    @media (max-width: 520px) {
      .spotpatch-execution-island {
        gap: 10px;
        padding-right: 14px;
        padding-left: 14px;
      }
      .spotpatch-execution-action-wrap { display: none; }
      .spotpatch-execution-recent-item { grid-template-columns: 48px minmax(0, 1fr); }
      .spotpatch-execution-recent-state { display: none; }
    }
  `;
  return style;
}

export function createFloatingSurfaceMotionController(
  document: Document,
  elements: FloatingSurfaceMotionElements,
  reconcile: () => void,
): FloatingSurfaceMotionController {
  let currentScene: FloatingSurfaceProjection["scene"] | undefined;
  let currentActivityKey: string | undefined;
  let morphTimeline: gsap.core.Timeline | undefined;
  let dispatchTimeline: gsap.core.Timeline | undefined;
  let pendingProjection: PendingProjection | undefined;
  let dispatchSource: HTMLElement | undefined;
  let dispatchTarget: HTMLElement | undefined;
  let disposed = false;

  const handleVisibility = (): void => {
    elements.surface.dataset.motionPaused = String(document.hidden);
  };
  document.addEventListener("visibilitychange", handleVisibility);
  handleVisibility();

  const morphElements = [
    elements.surface,
    elements.pill,
    elements.planner,
    elements.execution.root,
    elements.execution.mark,
    elements.execution.content,
    elements.execution.meta,
    elements.execution.recent,
  ];

  const sharedExecutionElements = [
    elements.execution.mark,
    elements.execution.content,
    elements.execution.meta,
  ];

  function captureSurfaceLayout(includeSharedOffsets = false): SurfaceLayout {
    const surfaceRect = elements.surface.getBoundingClientRect();
    const computedRadius = document.defaultView
      ?.getComputedStyle(elements.surface)
      .borderRadius.trim();

    const sharedOffsets = new Map<HTMLElement, ElementOffset>();
    if (includeSharedOffsets && finiteRect(surfaceRect)) {
      for (const element of sharedExecutionElements) {
        const elementRect = element.getBoundingClientRect();
        if (!finiteRect(elementRect)) continue;
        sharedOffsets.set(
          element,
          Object.freeze({
            x: elementRect.left - surfaceRect.left,
            y: elementRect.top - surfaceRect.top,
          }),
        );
      }
    }

    return Object.freeze({
      geometry: Object.freeze({
        borderRadius: visibleBorderRadius(computedRadius, surfaceRect),
        rect: surfaceRect,
      }),
      sharedOffsets,
    });
  }

  function syncRecentVisibility(): void {
    elements.execution.recent.hidden =
      elements.execution.root.dataset.expanded !== "true";
  }

  function clearMorphProperties(): void {
    gsap.set(morphElements, {
      clearProps:
        "borderRadius,filter,height,opacity,transform,visibility,width,willChange",
    });
    delete elements.surface.dataset.motionMorphing;
    delete elements.planner.dataset.motionReveal;
    syncRecentVisibility();
  }

  function clearMorph(): void {
    morphTimeline?.kill();
    morphTimeline = undefined;
    gsap.killTweensOf(morphElements);
    clearMorphProperties();
  }

  function interruptMorph(includeSharedOffsets = false): SurfaceLayout {
    morphTimeline?.kill();
    morphTimeline = undefined;
    gsap.killTweensOf(morphElements);
    const layout = captureSurfaceLayout(includeSharedOffsets);
    clearMorphProperties();
    return layout;
  }

  function clearDispatch(): void {
    dispatchTimeline?.kill();
    dispatchTimeline = undefined;
    if (dispatchSource !== undefined) {
      gsap.killTweensOf(dispatchSource);
      gsap.set(dispatchSource, { clearProps: "filter,transform" });
      dispatchSource = undefined;
    }
    if (dispatchTarget !== undefined) {
      gsap.killTweensOf(dispatchTarget);
      gsap.set(dispatchTarget, { clearProps: "boxShadow" });
      dispatchTarget = undefined;
    }
    elements.surface.dataset.agentCharging = "false";
  }

  function completeDispatch(): void {
    dispatchTimeline = undefined;
    if (dispatchSource !== undefined) {
      gsap.set(dispatchSource, { clearProps: "filter,transform" });
      dispatchSource = undefined;
    }
    if (dispatchTarget !== undefined) {
      gsap.set(dispatchTarget, { clearProps: "boxShadow" });
      dispatchTarget = undefined;
    }
    elements.surface.dataset.agentCharging = "false";
  }

  function sweepOnce(): void {
    if (!supportsMotion(document) || document.hidden) return;
    gsap.killTweensOf(elements.execution.sweep);
    gsap.fromTo(
      elements.execution.sweep,
      { autoAlpha: 0, xPercent: -160 },
      {
        autoAlpha: 0.72,
        xPercent: 620,
        duration: MOTION.sweepSeconds,
        ease: "power2.inOut",
        onComplete: () => {
          gsap.set(elements.execution.sweep, {
            clearProps: "opacity,transform,visibility",
          });
        },
      },
    );
  }

  function animateGeometry(
    previous: SurfaceLayout,
    next: SurfaceLayout,
    activeScene: HTMLElement,
    reveal: boolean,
    detailTransition?: DetailTransition,
  ): void {
    const geometryHasChanged =
      geometryChanged(previous.geometry.rect, next.geometry.rect) ||
      previous.geometry.borderRadius !== next.geometry.borderRadius;
    const sharedLayoutHasChanged = sharedExecutionElements.some((element) => {
      const previousOffset = previous.sharedOffsets.get(element);
      const nextOffset = next.sharedOffsets.get(element);
      return (
        previousOffset !== undefined &&
        nextOffset !== undefined &&
        (Math.abs(previousOffset.x - nextOffset.x) > 0.5 ||
          Math.abs(previousOffset.y - nextOffset.y) > 0.5)
      );
    });

    if (
      !supportsMotion(document) ||
      !finiteRect(previous.geometry.rect) ||
      !finiteRect(next.geometry.rect) ||
      (!geometryHasChanged && !sharedLayoutHasChanged && detailTransition === undefined)
    ) {
      clearMorphProperties();
      return;
    }

    const morphDuration =
      detailTransition === "expand" ? MOTION.expandSeconds : MOTION.morphSeconds;
    elements.surface.dataset.motionMorphing = "true";
    morphTimeline = gsap.timeline({
      defaults: { overwrite: "auto" },
      onComplete: () => {
        clearMorphProperties();
        reconcile();
        morphTimeline = undefined;
      },
    });

    if (geometryHasChanged) {
      morphTimeline.fromTo(
        elements.surface,
        {
          borderRadius: previous.geometry.borderRadius,
          height: previous.geometry.rect.height,
          width: previous.geometry.rect.width,
          x: previous.geometry.rect.left - next.geometry.rect.left,
          y: previous.geometry.rect.top - next.geometry.rect.top,
          willChange: "width,height,transform",
        },
        {
          borderRadius: next.geometry.borderRadius,
          height: next.geometry.rect.height,
          width: next.geometry.rect.width,
          x: 0,
          y: 0,
          duration: morphDuration,
          ease: "expo.inOut",
        },
        0,
      );
    }

    for (const element of sharedExecutionElements) {
      const previousOffset = previous.sharedOffsets.get(element);
      const nextOffset = next.sharedOffsets.get(element);
      if (previousOffset === undefined || nextOffset === undefined) continue;
      const x = previousOffset.x - nextOffset.x;
      const y = previousOffset.y - nextOffset.y;
      if (Math.abs(x) <= 0.5 && Math.abs(y) <= 0.5) continue;
      morphTimeline.fromTo(
        element,
        { x, y, willChange: "transform" },
        {
          x: 0,
          y: 0,
          duration: morphDuration,
          ease: "expo.inOut",
        },
        0,
      );
    }

    if (detailTransition === "expand") {
      morphTimeline.fromTo(
        elements.execution.recent,
        { autoAlpha: 0, filter: "blur(4px)", y: 6 },
        {
          autoAlpha: 1,
          filter: "blur(0px)",
          y: 0,
          duration: MOTION.detailRevealSeconds,
          ease: "power3.out",
        },
        MOTION.detailRevealDelaySeconds,
      );
    } else if (detailTransition === "collapse") {
      morphTimeline.fromTo(
        elements.execution.recent,
        { autoAlpha: 1, filter: "blur(0px)", y: 0 },
        {
          autoAlpha: 0,
          filter: "blur(3px)",
          y: -4,
          duration: MOTION.detailRetireSeconds,
          ease: "power2.in",
        },
        0,
      );
    }

    if (reveal && activeScene === elements.planner) {
      // The planner rises in sections (header, body, actions) through CSS, so
      // opening it adds no computed-style reads to the click. The timeline
      // only spans the reveal so completion and interruption clear it.
      elements.planner.dataset.motionReveal = "true";
      morphTimeline.call(
        () => undefined,
        [],
        MOTION.sceneRevealDelaySeconds +
          MOTION.revealSeconds +
          MOTION.revealStaggerSeconds * (PLANNER_SECTION_COUNT - 1),
      );
    } else if (reveal) {
      morphTimeline.fromTo(
        activeScene,
        { autoAlpha: 0, y: 8 },
        {
          autoAlpha: 1,
          y: 0,
          duration: MOTION.revealSeconds,
          ease: "power3.out",
          clearProps: "transform,opacity,visibility",
        },
        MOTION.sceneRevealDelaySeconds,
      );
    }
  }

  function applyProjection(
    projection: FloatingSurfaceProjection,
    renderContent: () => void,
  ): void {
    if (disposed) return;
    const previousScene = currentScene;
    const sceneChanged = previousScene !== projection.scene;
    const layerChanged =
      previousScene === undefined ||
      surfaceLayer(previousScene) !== surfaceLayer(projection.scene);
    const wasExpanded = elements.execution.root.dataset.expanded === "true";
    const executionRemainsActive =
      previousScene !== undefined &&
      surfaceLayer(previousScene) === "execution" &&
      surfaceLayer(projection.scene) === "execution";
    const preserveInterruptedSharedLayout =
      executionRemainsActive && (wasExpanded || morphTimeline?.isActive() === true);
    const previousGeometry = interruptMorph(preserveInterruptedSharedLayout);
    const activityChanged = currentActivityKey !== projection.activity?.key;

    elements.surface.dataset.scene = projection.scene;
    elements.surface.dataset.tone = projection.tone;
    elements.surface.style.setProperty(
      "--spotpatch-island-compact-width",
      `${String(compactIslandWidth(projection))}px`,
    );
    renderContent();
    const activeScene = setSceneVisibility(elements, projection);
    const isExpanded = elements.execution.root.dataset.expanded === "true";
    const detailTransition: DetailTransition =
      executionRemainsActive && wasExpanded && !isExpanded ? "collapse" : undefined;
    if (detailTransition === "collapse") {
      elements.execution.recent.hidden = false;
    }
    reconcile();
    const nextGeometry = captureSurfaceLayout(
      preserveInterruptedSharedLayout || detailTransition !== undefined,
    );
    currentScene = projection.scene;
    currentActivityKey = projection.activity?.key;
    animateGeometry(
      previousGeometry,
      nextGeometry,
      activeScene,
      layerChanged,
      detailTransition,
    );

    const executionActive =
      projection.scene === "handoff" ||
      projection.scene === "running" ||
      projection.scene === "success" ||
      projection.scene === "failed";
    if (executionActive && (sceneChanged || activityChanged)) sweepOnce();
  }

  function updateLayout(updateContent: () => void): void {
    if (disposed) return;
    const wasExpanded = elements.execution.root.dataset.expanded === "true";
    const previousGeometry = interruptMorph(true);
    updateContent();
    const isExpanded = elements.execution.root.dataset.expanded === "true";
    const detailTransition: DetailTransition = wasExpanded
      ? isExpanded
        ? undefined
        : "collapse"
      : isExpanded
        ? "expand"
        : undefined;
    if (detailTransition === "collapse") {
      elements.execution.recent.hidden = false;
    }
    reconcile();
    const nextGeometry = captureSurfaceLayout(true);
    const activeScene = elements.execution.root.hidden
      ? elements.planner.hidden
        ? elements.pill
        : elements.planner
      : elements.execution.root;
    animateGeometry(
      previousGeometry,
      nextGeometry,
      activeScene,
      false,
      detailTransition,
    );
  }

  function cancel(): void {
    pendingProjection = undefined;
    clearMorph();
    clearDispatch();
    gsap.killTweensOf(elements.execution.sweep);
    gsap.set(elements.execution.sweep, {
      clearProps: "opacity,transform,visibility",
    });
  }

  function render(
    projection: FloatingSurfaceProjection,
    renderContent: () => void,
  ): void {
    if (disposed) return;
    const dispatchActive = dispatchTimeline?.isActive() === true;
    const leavesChargingScene =
      projection.scene !== "planner" && projection.scene !== "agent-charging";

    if (dispatchActive && currentScene === "agent-charging" && leavesChargingScene) {
      pendingProjection = Object.freeze({ projection, renderContent });
      return;
    }

    if (dispatchActive && projection.scene !== "agent-charging") {
      pendingProjection = undefined;
      clearDispatch();
    }

    applyProjection(projection, renderContent);
  }

  function dispatch(source: HTMLElement, target: HTMLElement): void {
    if (disposed || dispatchTimeline?.isActive() === true) return;
    if (!supportsMotion(document)) return;

    clearDispatch();
    dispatchSource = source;
    dispatchTarget = target;
    elements.surface.dataset.agentCharging = "true";
    dispatchTimeline = gsap.timeline({
      onComplete: () => {
        const nextProjection = pendingProjection;
        pendingProjection = undefined;
        completeDispatch();
        if (nextProjection !== undefined) {
          applyProjection(nextProjection.projection, nextProjection.renderContent);
        }
      },
    });
    dispatchTimeline.fromTo(
      source,
      { filter: "brightness(1)", scaleX: 1, scaleY: 1 },
      {
        filter: "brightness(1.06)",
        scaleX: 0.995,
        scaleY: 0.97,
        duration: MOTION.pressSeconds,
        ease: "power2.out",
        yoyo: true,
        repeat: 1,
        clearProps: "filter,transform",
      },
      0,
    );
    dispatchTimeline.fromTo(
      target,
      { boxShadow: THEME_MOTION_COLORS.dispatchGlowRest },
      {
        boxShadow: THEME_MOTION_COLORS.dispatchGlow,
        duration: MOTION.targetFeedbackSeconds,
        yoyo: true,
        repeat: 1,
        clearProps: "boxShadow",
      },
      MOTION.targetFeedbackDelaySeconds,
    );
    dispatchTimeline.to({}, { duration: MOTION.dispatchSeconds }, 0);
  }

  return Object.freeze({
    cancel,
    dispatch,
    render,
    updateLayout,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      cancel();
      document.removeEventListener("visibilitychange", handleVisibility);
    },
  });
}
