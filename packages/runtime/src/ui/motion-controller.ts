import { gsap } from "gsap";

import type {
  FloatingSurfaceMotionController,
  FloatingSurfaceMotionElements,
  FloatingSurfaceProjection,
} from "./motion-extension-contract.js";

const MOTION = Object.freeze({
  contentMilliseconds: 220,
  detailRevealDelaySeconds: 0.1,
  detailRevealSeconds: 0.3,
  detailRetireSeconds: 0.15,
  dispatchSeconds: 0.54,
  expandSeconds: 0.54,
  morphSeconds: 0.48,
  pressSeconds: 0.12,
  revealSeconds: 0.26,
  sceneRevealDelaySeconds: 0.06,
  sweepSeconds: 0.68,
  targetFeedbackDelaySeconds: 0.08,
  targetFeedbackSeconds: 0.22,
});

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
      --spotpatch-island-surface: #050608;
      --spotpatch-island-primary: #f7f7fb;
      --spotpatch-island-subtle: #5f646e;
      --spotpatch-island-line: rgb(255 255 255 / 10%);
      --spotpatch-island-violet: #8b67ff;
      --spotpatch-island-cyan: #4dc8ff;
      --spotpatch-island-mint: #59dcb6;
      --spotpatch-island-error: #ef6f88;
      --spotpatch-island-compact-height: ${String(ISLAND_SIZE.compactHeight)}px;
      --spotpatch-island-compact-width: ${String(ISLAND_SIZE.runningWidth)}px;
      --spotpatch-island-expanded-height: ${String(ISLAND_SIZE.expandedHeight)}px;
      --spotpatch-island-expanded-width: ${String(ISLAND_SIZE.expandedWidth)}px;
      --spotpatch-island-ease: cubic-bezier(.22, 1, .36, 1);
      position: fixed;
      box-sizing: border-box;
      color-scheme: dark;
      -webkit-font-smoothing: antialiased;
      overflow: hidden;
      border: 1px solid var(--spotpatch-island-line);
      background:
        linear-gradient(180deg, rgb(255 255 255 / 2.8%), transparent 24%),
        rgb(5 6 8 / 98.8%);
      box-shadow:
        0 24px 60px rgb(13 17 28 / 18%),
        0 3px 10px rgb(13 17 28 / 10%),
        inset 0 1px rgb(255 255 255 / 6.5%),
        inset 0 0 0 1px rgb(255 255 255 / 1.2%);
      transform-origin: 100% 100%;
    }
    .spotpatch-floating-surface::before {
      position: absolute;
      z-index: 0;
      inset: 0;
      background:
        radial-gradient(180px 70px at 0% 50%, rgb(139 103 255 / 7%), transparent 72%),
        radial-gradient(180px 70px at 100% 50%, rgb(77 200 255 / 4.5%), transparent 72%);
      content: "";
      opacity: 0;
      pointer-events: none;
    }
    .spotpatch-floating-surface[data-scene="pill"],
    .spotpatch-floating-surface[data-scene="capturing"] {
      width: max-content;
      border-radius: 999px;
    }
    .spotpatch-floating-surface[data-scene="planner"] { border-radius: 18px; }
    .spotpatch-floating-surface[data-scene="agent-charging"],
    .spotpatch-floating-surface[data-scene="handoff"],
    .spotpatch-floating-surface[data-scene="running"],
    .spotpatch-floating-surface[data-scene="success"],
    .spotpatch-floating-surface[data-scene="failed"] {
      width: min(var(--spotpatch-island-compact-width), calc(100vw - 32px));
      height: var(--spotpatch-island-compact-height);
      max-width: calc(100vw - 32px);
      border-radius: 31px;
    }
    .spotpatch-floating-surface[data-scene="agent-charging"]::before,
    .spotpatch-floating-surface[data-scene="handoff"]::before,
    .spotpatch-floating-surface[data-scene="running"]::before,
    .spotpatch-floating-surface[data-scene="success"]::before,
    .spotpatch-floating-surface[data-scene="failed"]::before { opacity: .82; }
    .spotpatch-floating-surface:has(.spotpatch-execution-island[data-expanded="true"]) {
      width: min(var(--spotpatch-island-expanded-width), calc(100vw - 32px));
      height: min(var(--spotpatch-island-expanded-height), calc(100vh - 32px));
      border-radius: 30px;
    }
    .spotpatch-floating-surface > .spotpatch-trigger,
    .spotpatch-floating-surface > .spotpatch-dialog,
    .spotpatch-floating-surface > .spotpatch-execution-island {
      position: relative;
      z-index: 1;
    }
    .spotpatch-floating-surface > .spotpatch-trigger {
      display: inline-flex;
      min-height: 44px;
      align-items: center;
      gap: 10px;
      border: 0;
      border-radius: 999px;
      padding: 10px 17px;
      color: #f8fafc;
      background: transparent;
      box-shadow: none;
      cursor: pointer;
      font-size: 14px;
      font-weight: 650;
      touch-action: none;
      user-select: none;
    }
    .spotpatch-trigger::before {
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: var(--spotpatch-accent);
      box-shadow: 0 0 0 4px rgb(99 102 241 / 10%);
      content: "";
    }
    .spotpatch-trigger:hover { transform: translateY(-1px); }
    .spotpatch-trigger[aria-pressed="true"] { background: rgb(139 123 255 / 14%); }
    .spotpatch-trigger[aria-pressed="true"]::before {
      animation: spotpatch-motion-pill-pulse 1.8s ease-in-out infinite;
    }
    .spotpatch-trigger[data-dragging="true"] {
      cursor: grabbing;
      transform: scale(.98);
    }
    .spotpatch-floating-surface .spotpatch-dialog { filter: none; }
    .spotpatch-floating-surface .spotpatch-shell {
      border: 0;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
    }
    .spotpatch-brand-name {
      color: #fff;
      font-size: 13.5px;
      font-weight: 680;
      letter-spacing: -.01em;
    }
    .spotpatch-brand-context {
      color: #8e98aa;
      font-size: 10.5px;
      font-weight: 560;
      letter-spacing: .02em;
    }
    .spotpatch-title {
      margin: 0;
      color: #fff;
      font-size: 18px;
      font-weight: 680;
      letter-spacing: -.015em;
    }
    .spotpatch-subtitle {
      max-width: 390px;
      margin: 4px 0 0;
      color: var(--spotpatch-text-secondary);
      font-size: 12.5px;
      line-height: 1.5;
    }
    .spotpatch-execution-island {
      position: relative;
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
      color: var(--spotpatch-island-primary);
      background: transparent;
      cursor: pointer;
      text-align: left;
      touch-action: none;
    }
    .spotpatch-execution-island[data-expanded="true"] {
      min-height: var(--spotpatch-island-expanded-height);
      grid-template-columns: auto minmax(0, 1fr) auto;
      grid-template-rows: auto 1fr;
      align-items: start;
      row-gap: 16px;
      border-radius: 30px;
      padding: 18px 20px 16px;
    }
    .spotpatch-execution-mark {
      display: grid;
      width: 23px;
      height: 23px;
      flex: none;
      place-items: center;
    }
    .spotpatch-execution-logo {
      width: 22px;
      height: 22px;
      overflow: visible;
      filter: drop-shadow(0 0 7px rgb(139 103 255 / 16%));
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
      color: var(--spotpatch-island-primary);
      font-size: 15px;
      font-weight: 690;
      letter-spacing: -.018em;
      line-height: 1.35;
    }
    .spotpatch-execution-action,
    .spotpatch-execution-action-outgoing {
      color: #696f79;
      font-size: 11px;
      font-weight: 400;
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
      animation: spotpatch-motion-copy-in ${String(MOTION.contentMilliseconds)}ms var(--spotpatch-island-ease) both;
    }
    .spotpatch-execution-copy-changing .spotpatch-execution-headline-outgoing,
    .spotpatch-execution-copy-changing .spotpatch-execution-action-outgoing {
      animation: spotpatch-motion-copy-out ${String(MOTION.contentMilliseconds)}ms ease-in both;
    }
    .spotpatch-execution-meta {
      display: inline-flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      flex: none;
      color: #989da8;
      font-size: 11px;
      font-weight: 620;
      white-space: nowrap;
    }
    .spotpatch-execution-meta-dot {
      width: 6px;
      height: 6px;
      flex: none;
      border-radius: 50%;
      background: var(--spotpatch-island-violet);
      box-shadow: 0 0 8px rgb(139 103 255 / 38%);
    }
    [data-execution-scene="agent-charging"] .spotpatch-execution-meta-dot,
    [data-execution-scene="handoff"] .spotpatch-execution-meta-dot,
    [data-execution-scene="running"] .spotpatch-execution-meta-dot {
      animation: spotpatch-motion-status-breathe 1.8s ease-in-out infinite;
    }
    .spotpatch-execution-meta[data-tone="success"] .spotpatch-execution-meta-dot {
      background: var(--spotpatch-island-mint);
      box-shadow: 0 0 8px rgb(89 220 182 / 24%);
    }
    .spotpatch-execution-meta[data-tone="danger"] .spotpatch-execution-meta-dot {
      background: var(--spotpatch-island-error);
      box-shadow: 0 0 8px rgb(239 111 136 / 22%);
    }
    .spotpatch-execution-timer {
      width: 34px;
      color: #737985;
      font: 400 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
      text-align: right;
    }
    .spotpatch-execution-more {
      display: grid;
      width: 24px;
      height: 24px;
      padding: 0;
      border: 0;
      background: transparent;
      color: #686e78;
      font-size: 15px;
      line-height: 1;
      place-items: center;
    }
    [data-expanded="true"] .spotpatch-execution-meta-dot,
    [data-expanded="true"] .spotpatch-execution-meta-label,
    [data-expanded="true"] .spotpatch-execution-timer { display: none; }
    [data-expanded="true"] .spotpatch-execution-more {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: rgb(255 255 255 / 4.5%);
      color: #828894;
    }
    .spotpatch-execution-recent {
      position: absolute;
      top: 62px;
      right: 20px;
      left: 20px;
      display: grid;
      margin-top: 0;
    }
    .spotpatch-execution-recent[hidden] { display: none; }
    .spotpatch-execution-recent-item {
      display: grid;
      min-height: 28px;
      grid-template-columns: 52px minmax(0, 1fr) auto;
      align-items: center;
      border-top: 1px solid rgb(255 255 255 / 5.5%);
    }
    .spotpatch-execution-recent-item:first-child { border-top: 0; }
    .spotpatch-execution-recent-kind {
      color: #666c76;
      font: 600 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
      text-transform: uppercase;
    }
    .spotpatch-execution-recent-detail {
      overflow: hidden;
      color: #b2b6bf;
      font-size: 11px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spotpatch-execution-recent-state {
      color: #626974;
      font: 500 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .spotpatch-execution-recent-item[data-state="active"] .spotpatch-execution-recent-kind {
      color: var(--spotpatch-island-violet);
    }
    .spotpatch-execution-recent-item[data-state="active"] .spotpatch-execution-recent-detail {
      color: #f2f3f7;
    }
    .spotpatch-execution-recent-item[data-state="failure"] .spotpatch-execution-recent-kind {
      color: var(--spotpatch-island-error);
    }
    .spotpatch-island-sweep {
      position: absolute;
      z-index: 2;
      bottom: 0;
      left: 44px;
      width: 20%;
      height: 1px;
      border-radius: 999px;
      background: linear-gradient(90deg, transparent, var(--spotpatch-island-violet), var(--spotpatch-island-cyan), transparent);
      box-shadow: 0 0 7px rgb(139 103 255 / 18%);
      opacity: 0;
      pointer-events: none;
      transform: translate3d(-160%, 0, 0);
    }
    @keyframes spotpatch-motion-copy-in {
      from { opacity: 0; filter: blur(2px); transform: translate3d(0, 3px, 0); }
      to { opacity: 1; filter: blur(0); transform: translate3d(0, 0, 0); }
    }
    @keyframes spotpatch-motion-copy-out {
      from { opacity: 1; filter: blur(0); transform: translate3d(0, 0, 0); }
      to { opacity: 0; filter: blur(2px); transform: translate3d(0, -3px, 0); }
    }
    @keyframes spotpatch-motion-status-breathe {
      50% { opacity: .42; transform: scale(.82); }
    }
    @keyframes spotpatch-motion-pill-pulse {
      50% { box-shadow: 0 0 0 6px rgb(99 102 241 / 5%); opacity: .72; }
    }
    .spotpatch-floating-surface[data-motion-paused="true"] .spotpatch-execution-meta-dot,
    .spotpatch-floating-surface[data-motion-paused="true"] .spotpatch-trigger::before {
      animation-play-state: paused;
    }
    @media (prefers-reduced-motion: reduce) {
      .spotpatch-trigger::before,
      .spotpatch-execution-meta-dot,
      .spotpatch-execution-headline,
      .spotpatch-execution-headline-outgoing,
      .spotpatch-execution-action,
      .spotpatch-execution-action-outgoing {
        animation: none !important;
        filter: none !important;
        transform: none !important;
      }
      .spotpatch-island-sweep { display: none; }
    }
    @media (max-width: 520px) {
      .spotpatch-execution-island {
        grid-template-columns: auto minmax(0, 1fr) auto;
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

    if (reveal) {
      morphTimeline.fromTo(
        activeScene,
        { autoAlpha: 0, y: 4 },
        {
          autoAlpha: 1,
          y: 0,
          duration: MOTION.revealSeconds,
          ease: "power2.out",
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
      { boxShadow: "0 0 0 rgb(100 120 255 / 0%)" },
      {
        boxShadow: "0 0 18px rgb(100 120 255 / 14%)",
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
