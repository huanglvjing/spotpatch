import { gsap } from "gsap";

import type {
  FloatingSurfaceMotionController,
  FloatingSurfaceMotionElements,
  FloatingSurfaceProjection,
} from "./motion-extension-contract.js";

const MOTION = Object.freeze({
  dispatchSeconds: 1.02,
  morphSeconds: 0.68,
  revealSeconds: 0.32,
  signalSeconds: 0.58,
  particleCount: 5,
});

function setSceneVisibility(
  elements: FloatingSurfaceMotionElements,
  projection: FloatingSurfaceProjection,
): HTMLElement {
  const pillActive = projection.scene === "pill" || projection.scene === "capturing";
  const plannerActive =
    projection.scene === "planner" || projection.scene === "agent-charging";
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

export function createFloatingSurfaceMotionStyles(
  document: Document,
): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = `
    .spotpatch-floating-surface {
      --spotpatch-island-panel: #090b10;
      --spotpatch-island-primary: #f8f9ff;
      --spotpatch-island-secondary: #8b91a1;
      --spotpatch-island-violet: #8c63ff;
      --spotpatch-island-blue: #5d71ff;
      --spotpatch-island-cyan: #2ec3ff;
      --spotpatch-island-mint: #50e0b6;
      --spotpatch-island-radius: 30px;
      --spotpatch-island-compact-width: min(590px, calc(100vw - 32px));
      --spotpatch-motion-fast: 140ms;
      --spotpatch-motion-ease: cubic-bezier(.2, .8, .2, 1);
      color-scheme: dark;
      -webkit-font-smoothing: antialiased;
      border: 1px solid rgb(180 187 210 / 24%);
      border-radius: var(--spotpatch-island-radius);
      background: var(--spotpatch-island-panel);
      box-shadow: 0 20px 52px -26px rgb(8 10 18 / 64%), inset 0 1px rgb(255 255 255 / 8%);
      overflow: hidden;
      transform-origin: 100% 100%;
      transition: border-color var(--spotpatch-motion-fast) var(--spotpatch-motion-ease);
    }
    .spotpatch-floating-surface[data-scene="pill"],
    .spotpatch-floating-surface[data-scene="capturing"] {
      border-radius: 999px;
      width: max-content;
    }
    .spotpatch-floating-surface[data-scene="handoff"],
    .spotpatch-floating-surface[data-scene="running"],
    .spotpatch-floating-surface[data-scene="success"],
    .spotpatch-floating-surface[data-scene="failed"] {
      border-radius: var(--spotpatch-island-radius);
      width: max-content;
      max-width: var(--spotpatch-island-compact-width);
    }
    .spotpatch-floating-surface[data-scene="planner"],
    .spotpatch-floating-surface[data-scene="agent-charging"] {
      border-radius: 18px;
    }
    .spotpatch-floating-surface::before {
      position: absolute;
      z-index: 0;
      width: 220px;
      height: 150px;
      top: -82px;
      left: -94px;
      border-radius: 50%;
      background: var(--spotpatch-island-violet);
      content: "";
      opacity: 0;
      filter: blur(38px);
      pointer-events: none;
      transform: translate3d(0, 0, 0) scale(.96);
    }
    .spotpatch-floating-surface[data-tone="capturing"]::before,
    .spotpatch-floating-surface[data-tone="running"]::before { opacity: .09; }
    .spotpatch-floating-surface[data-tone="success"]::before {
      background: var(--spotpatch-island-mint);
      opacity: .08;
    }
    .spotpatch-floating-surface[data-tone="danger"]::before {
      background: var(--spotpatch-danger);
      opacity: .07;
    }
    .spotpatch-floating-surface[data-scene="running"]::before {
      animation: spotpatch-motion-ambient 7s ease-in-out infinite;
    }
    .spotpatch-floating-surface[data-scene="running"]:has(.spotpatch-execution-island:hover) {
      border-color: rgb(180 187 210 / 32%);
    }
    .spotpatch-floating-surface > .spotpatch-trigger,
    .spotpatch-floating-surface > .spotpatch-dialog,
    .spotpatch-floating-surface > .spotpatch-execution-island { position: relative; z-index: 2; }
    .spotpatch-floating-surface > .spotpatch-trigger {
      position: relative;
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
      transition: border-color var(--spotpatch-motion-fast) var(--spotpatch-motion-ease), box-shadow var(--spotpatch-motion-fast) var(--spotpatch-motion-ease), transform var(--spotpatch-motion-fast) var(--spotpatch-motion-ease);
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
    .spotpatch-trigger[aria-pressed="true"]::before { animation: spotpatch-motion-pill-pulse 1.5s ease-in-out infinite; }
    .spotpatch-trigger[data-dragging="true"] { cursor: grabbing; transform: scale(.98); transition: none; }
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
      width: max-content;
      min-width: min(520px, calc(100vw - 32px));
      max-width: var(--spotpatch-island-compact-width);
      min-height: 92px;
      grid-template-columns: 44px minmax(300px, 1fr) auto;
      gap: 12px;
      align-items: center;
      border: 0;
      border-radius: inherit;
      padding: 12px 16px;
      color: var(--spotpatch-island-primary);
      background: transparent;
      cursor: pointer;
      text-align: left;
      touch-action: none;
      transition: min-height 220ms var(--spotpatch-motion-ease), transform var(--spotpatch-motion-fast) var(--spotpatch-motion-ease);
    }
    [data-scene="handoff"] .spotpatch-execution-island,
    [data-scene="failed"] .spotpatch-execution-island {
      min-width: min(500px, calc(100vw - 32px));
    }
    [data-scene="success"] .spotpatch-execution-island {
      min-width: min(470px, calc(100vw - 32px));
    }
    .spotpatch-execution-island:hover {
      min-height: 94px;
      transform: translateY(-1px);
    }
    .spotpatch-execution-island[data-dragging="true"] { transform: none; transition: none; }
    .spotpatch-agent-core {
      position: relative;
      display: grid;
      width: 44px;
      height: 44px;
      place-items: center;
      overflow: hidden;
      border: 1px solid rgb(140 99 255 / 20%);
      border-radius: 15px;
      background: rgb(255 255 255 / 3%);
      box-shadow: inset 0 1px rgb(255 255 255 / 5%);
      transition: border-color 460ms var(--spotpatch-motion-ease), color 460ms var(--spotpatch-motion-ease), background-color 460ms var(--spotpatch-motion-ease);
    }
    .spotpatch-agent-core-seed {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--spotpatch-island-violet), var(--spotpatch-island-blue) 58%, var(--spotpatch-island-cyan));
      box-shadow: 0 0 0 7px rgb(140 99 255 / 5%), 0 0 14px rgb(93 113 255 / 20%);
      animation: spotpatch-motion-core 1.7s ease-in-out infinite;
      transition: opacity 400ms ease, transform 400ms var(--spotpatch-motion-ease);
    }
    [data-scene="success"] .spotpatch-agent-core {
      border-color: rgb(80 224 182 / 22%);
      color: var(--spotpatch-island-mint);
      background: rgb(80 224 182 / 7%);
    }
    [data-scene="success"] .spotpatch-agent-core-seed { opacity: 0; animation: none; }
    [data-scene="success"] .spotpatch-agent-core::after {
      content: "✓";
      font-size: 18px;
      font-weight: 700;
      animation: spotpatch-motion-success-core 460ms var(--spotpatch-motion-ease) both;
    }
    [data-scene="failed"] .spotpatch-agent-core { border-color: rgb(251 113 133 / 24%); }
    [data-scene="failed"] .spotpatch-agent-core-seed { background: var(--spotpatch-danger); animation: none; }
    .spotpatch-execution-content { display: grid; min-width: 0; gap: 2px; }
    .spotpatch-execution-headline {
      overflow: hidden;
      color: var(--spotpatch-island-primary);
      font-size: 16px;
      font-weight: 650;
      letter-spacing: -.012em;
      line-height: 1.35;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spotpatch-execution-action {
      overflow: hidden;
      color: var(--spotpatch-island-secondary);
      font-size: 11.5px;
      line-height: 1.4;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spotpatch-execution-meta {
      display: inline-flex;
      min-width: 56px;
      align-items: center;
      justify-content: flex-end;
      gap: 7px;
      color: #cfd4df;
      font: 600 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
      white-space: nowrap;
    }
    .spotpatch-execution-meta-dot {
      width: 6px;
      height: 6px;
      flex: none;
      border-radius: 50%;
      background: var(--spotpatch-island-blue);
      box-shadow: 0 0 9px rgb(93 113 255 / 30%);
    }
    .spotpatch-execution-meta[data-tone="success"] .spotpatch-execution-meta-dot { background: var(--spotpatch-island-mint); }
    .spotpatch-execution-meta[data-tone="danger"] .spotpatch-execution-meta-dot { background: var(--spotpatch-danger); }
    .spotpatch-execution-activity {
      position: relative;
      display: block;
      height: 20px;
      margin-top: 5px;
      overflow: hidden;
      border: 1px solid rgb(255 255 255 / 5.5%);
      border-radius: 7px;
      background: rgb(255 255 255 / 2.2%);
    }
    .spotpatch-execution-activity[hidden],
    .spotpatch-execution-recent[hidden] { display: none; }
    .spotpatch-execution-activity-label {
      position: relative;
      z-index: 1;
      display: flex;
      height: 100%;
      align-items: center;
      overflow: hidden;
      padding: 0 8px;
      color: #707786;
      font: 500 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spotpatch-execution-activity-outgoing {
      position: absolute;
      z-index: 1;
      inset: 0;
      display: flex;
      align-items: center;
      overflow: hidden;
      padding: 0 8px;
      color: #707786;
      font: 500 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
      opacity: 0;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spotpatch-execution-activity-sheen {
      position: absolute;
      inset: 0 auto 0 0;
      width: 34%;
      background: linear-gradient(90deg, transparent, rgb(140 99 255 / 8%), rgb(46 195 255 / 7%), transparent);
      opacity: 0;
      transform: translate3d(-120%, 0, 0);
    }
    .spotpatch-execution-activity-enter .spotpatch-execution-activity-label { animation: spotpatch-motion-activity-copy 220ms var(--spotpatch-motion-ease); }
    .spotpatch-execution-activity-enter .spotpatch-execution-activity-outgoing { animation: spotpatch-motion-activity-copy-out 220ms var(--spotpatch-motion-ease); }
    .spotpatch-execution-activity-enter .spotpatch-execution-activity-sheen { animation: spotpatch-motion-activity-sheen 620ms ease-out; }
    .spotpatch-execution-recent {
      display: grid;
      max-height: 0;
      gap: 3px;
      overflow: hidden;
      opacity: 0;
      transform: translate3d(0, 2px, 0);
      transition: max-height 220ms var(--spotpatch-motion-ease), opacity 180ms ease, transform 220ms var(--spotpatch-motion-ease), margin 220ms var(--spotpatch-motion-ease);
    }
    .spotpatch-execution-island:hover:has(.spotpatch-execution-recent:not([hidden])) { min-height: 150px; }
    .spotpatch-execution-island:hover .spotpatch-execution-recent:not([hidden]) {
      max-height: 54px;
      margin-top: 5px;
      opacity: 1;
      transform: translate3d(0, 0, 0);
    }
    .spotpatch-execution-recent-item {
      overflow: hidden;
      color: #646b79;
      font: 500 9.5px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spotpatch-island-streak {
      position: absolute;
      z-index: 0;
      top: 56%;
      left: 0;
      width: 42%;
      height: 1px;
      border-radius: 99px;
      background: linear-gradient(90deg, transparent, rgb(140 99 255 / 12%), rgb(93 113 255 / 44%), rgb(46 195 255 / 30%), transparent);
      opacity: 0;
      pointer-events: none;
      transform: translate3d(-120%, 0, 0);
    }
    [data-scene="running"] .spotpatch-island-streak { animation: spotpatch-motion-streak 6.8s ease-in-out infinite; }
    .spotpatch-motion-signal {
      position: absolute;
      z-index: 4;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: visible;
      pointer-events: none;
    }
    .spotpatch-motion-signal path { fill: none; stroke: url(#spotpatch-motion-gradient); stroke-linecap: round; stroke-width: 1.5; }
    .spotpatch-motion-signal circle { fill: #72e6ff; filter: drop-shadow(0 0 4px #8b7bff); }
    .spotpatch-floating-surface[data-agent-charging="true"] .spotpatch-agent,
    .spotpatch-floating-surface[data-agent-charging="true"] .spotpatch-external-handoff {
      position: relative;
      isolation: isolate;
      overflow: hidden;
      border-color: rgb(82 168 255 / 55%);
    }
    .spotpatch-floating-surface[data-agent-charging="true"] .spotpatch-agent::before,
    .spotpatch-floating-surface[data-agent-charging="true"] .spotpatch-external-handoff::before {
      position: absolute;
      z-index: 0;
      width: 110px;
      height: 110px;
      top: 8px;
      left: -90px;
      border-radius: 50%;
      background: radial-gradient(circle, rgb(140 99 255 / 26%), rgb(46 195 255 / 9%) 48%, transparent 72%);
      content: "";
      filter: blur(14px);
      pointer-events: none;
      animation: spotpatch-motion-agent-receive 820ms ease-out both;
    }
    .spotpatch-floating-surface[data-agent-charging="true"] .spotpatch-agent::after,
    .spotpatch-floating-surface[data-agent-charging="true"] .spotpatch-external-handoff::after {
      position: absolute;
      z-index: 4;
      inset: -1px;
      border-radius: inherit;
      padding: 1px;
      background: conic-gradient(from 0deg, transparent, rgb(140 99 255 / 68%), rgb(93 113 255 / 62%), rgb(46 195 255 / 48%), transparent 38%);
      content: "";
      opacity: 0;
      pointer-events: none;
      -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
      -webkit-mask-composite: xor;
      animation: spotpatch-motion-agent-border 920ms linear both;
    }
    @keyframes spotpatch-motion-ambient {
      50% { transform: translate3d(20px, 14px, 0) scale(1.04); }
    }
    @keyframes spotpatch-motion-core {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.15); }
    }
    @keyframes spotpatch-motion-success-core {
      from { opacity: 0; transform: scale(.72) rotate(-8deg); }
      to { opacity: 1; transform: scale(1) rotate(0deg); }
    }
    @keyframes spotpatch-motion-streak {
      0%, 58% { opacity: 0; transform: translate3d(-120%, 0, 0); }
      65% { opacity: .16; }
      88% { opacity: .52; transform: translate3d(340%, 0, 0); }
      100% { opacity: 0; transform: translate3d(340%, 0, 0); }
    }
    @keyframes spotpatch-motion-activity-copy {
      from { opacity: 0; transform: translate3d(0, 2px, 0); }
      to { opacity: 1; transform: translate3d(0, 0, 0); }
    }
    @keyframes spotpatch-motion-activity-copy-out {
      from { opacity: 1; transform: translate3d(0, 0, 0); }
      to { opacity: 0; transform: translate3d(0, -2px, 0); }
    }
    @keyframes spotpatch-motion-activity-sheen {
      0% { opacity: 0; transform: translate3d(-120%, 0, 0); }
      22% { opacity: 1; }
      100% { opacity: 0; transform: translate3d(340%, 0, 0); }
    }
    @keyframes spotpatch-motion-agent-receive {
      0% { opacity: 0; transform: translate3d(0, 0, 0); }
      18% { opacity: .75; }
      100% { opacity: 0; transform: translate3d(520px, 0, 0); }
    }
    @keyframes spotpatch-motion-agent-border {
      0% { opacity: 0; transform: rotate(0deg); }
      18% { opacity: 1; }
      78% { opacity: .7; }
      100% { opacity: 0; transform: rotate(360deg); }
    }
    @keyframes spotpatch-motion-pill-pulse {
      0%, 100% { box-shadow: 0 0 0 4px rgb(99 102 241 / 10%); transform: scale(1); }
      50% { box-shadow: 0 0 0 7px rgb(99 102 241 / 4%); transform: scale(1.12); }
    }
    .spotpatch-floating-surface[data-motion-paused="true"]::before,
    .spotpatch-floating-surface[data-motion-paused="true"] .spotpatch-agent-core-seed,
    .spotpatch-floating-surface[data-motion-paused="true"] .spotpatch-island-streak { animation-play-state: paused; }
    @media (prefers-reduced-motion: reduce) {
      .spotpatch-floating-surface::before,
      .spotpatch-agent-core-seed,
      .spotpatch-agent-core::after,
      .spotpatch-island-streak,
      .spotpatch-execution-activity-label,
      .spotpatch-execution-activity-outgoing,
      .spotpatch-execution-activity-sheen,
      .spotpatch-agent::before,
      .spotpatch-agent::after,
      .spotpatch-external-handoff::before,
      .spotpatch-external-handoff::after,
      .spotpatch-trigger::before { animation: none !important; }
      .spotpatch-execution-island,
      .spotpatch-execution-recent,
      .spotpatch-agent-core,
      .spotpatch-agent-core-seed { transition: none !important; }
    }
  `;
  return style;
}

function createSignalLayer(document: Document): Readonly<{
  particles: readonly SVGCircleElement[];
  path: SVGPathElement;
  root: SVGSVGElement;
}> {
  const namespace = "http://www.w3.org/2000/svg";
  const root = document.createElementNS(namespace, "svg");
  root.classList.add("spotpatch-motion-signal");
  root.style.display = "none";
  const definitions = document.createElementNS(namespace, "defs");
  const gradient = document.createElementNS(namespace, "linearGradient");
  gradient.id = "spotpatch-motion-gradient";
  for (const [offset, color] of [
    ["0%", "#8b5cf6"],
    ["55%", "#4f8cff"],
    ["100%", "#72e6ff"],
  ] as const) {
    const stop = document.createElementNS(namespace, "stop");
    stop.setAttribute("offset", offset);
    stop.setAttribute("stop-color", color);
    gradient.append(stop);
  }
  definitions.append(gradient);
  const path = document.createElementNS(namespace, "path");
  path.setAttribute("pathLength", "1");
  const particles = Array.from({ length: MOTION.particleCount }, () => {
    const particle = document.createElementNS(namespace, "circle");
    particle.setAttribute("r", "2");
    return particle;
  });
  root.append(definitions, path, ...particles);
  return Object.freeze({ particles: Object.freeze(particles), path, root });
}

export function createFloatingSurfaceMotionController(
  document: Document,
  elements: FloatingSurfaceMotionElements,
  reconcile: () => void,
): FloatingSurfaceMotionController {
  const signalLayer = createSignalLayer(document);
  elements.surface.append(signalLayer.root);
  let currentScene: FloatingSurfaceProjection["scene"] | undefined;
  let morphTimeline: gsap.core.Timeline | undefined;
  let dispatchTimeline: gsap.core.Timeline | undefined;
  let pendingProjection: FloatingSurfaceProjection | undefined;
  let dispatchSource: HTMLElement | undefined;
  let signalTarget: HTMLElement | undefined;
  let disposed = false;

  const handleVisibility = (): void => {
    elements.surface.dataset.motionPaused = String(document.hidden);
  };
  document.addEventListener("visibilitychange", handleVisibility);
  handleVisibility();

  function clearMorph(): void {
    morphTimeline?.kill();
    morphTimeline = undefined;
    gsap.killTweensOf([
      elements.surface,
      elements.pill,
      elements.planner,
      elements.execution.root,
      elements.execution.core,
      elements.execution.headline,
      elements.execution.action,
      elements.execution.meta,
    ]);
    gsap.set(
      [
        elements.surface,
        elements.pill,
        elements.planner,
        elements.execution.root,
        elements.execution.core,
        elements.execution.headline,
        elements.execution.action,
        elements.execution.meta,
      ],
      { clearProps: "transform,opacity,visibility" },
    );
  }

  function clearDispatch(): void {
    dispatchTimeline?.kill();
    dispatchTimeline = undefined;
    if (dispatchSource !== undefined) {
      gsap.killTweensOf(dispatchSource);
      gsap.set(dispatchSource, { clearProps: "filter,transform" });
      dispatchSource = undefined;
    }
    if (signalTarget !== undefined) {
      gsap.killTweensOf(signalTarget);
      gsap.set(signalTarget, { clearProps: "boxShadow" });
      signalTarget = undefined;
    }
    gsap.killTweensOf([signalLayer.path, ...signalLayer.particles]);
    gsap.set(signalLayer.particles, { clearProps: "opacity,visibility" });
    gsap.set(signalLayer.path, { clearProps: "strokeDasharray,strokeDashoffset" });
    signalLayer.root.style.display = "none";
    elements.surface.dataset.agentCharging = "false";
  }

  function cancel(): void {
    pendingProjection = undefined;
    clearMorph();
    clearDispatch();
  }

  function applyProjection(
    projection: FloatingSurfaceProjection,
    sharedIdentityRect?: DOMRect,
  ): void {
    if (disposed) return;
    const previousRect = elements.surface.getBoundingClientRect();
    const sceneChanged = currentScene !== projection.scene;
    const sharedElementTransition =
      currentScene === "agent-charging" &&
      projection.scene !== "planner" &&
      projection.scene !== "agent-charging" &&
      sharedIdentityRect !== undefined &&
      finiteRect(sharedIdentityRect);
    clearMorph();

    elements.surface.dataset.scene = projection.scene;
    elements.surface.dataset.tone = projection.tone;
    const activeScene = setSceneVisibility(elements, projection);
    reconcile();
    const nextRect = elements.surface.getBoundingClientRect();
    currentScene = projection.scene;

    if (
      !sceneChanged ||
      !supportsMotion(document) ||
      !finiteRect(previousRect) ||
      !finiteRect(nextRect)
    ) {
      gsap.set([elements.surface, activeScene], {
        clearProps: "transform,opacity,visibility",
      });
      return;
    }

    morphTimeline = gsap.timeline({
      defaults: { overwrite: "auto" },
      onComplete: () => {
        morphTimeline = undefined;
      },
    });
    morphTimeline.fromTo(
      elements.surface,
      {
        x: previousRect.left - nextRect.left,
        y: previousRect.top - nextRect.top,
        scaleX: previousRect.width / nextRect.width,
        scaleY: previousRect.height / nextRect.height,
      },
      {
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        duration: MOTION.morphSeconds,
        ease: "expo.inOut",
        clearProps: "transform",
      },
    );
    if (sharedElementTransition) {
      const coreRect = elements.execution.core.getBoundingClientRect();
      const sourceCenterX = sharedIdentityRect.left + sharedIdentityRect.width / 2;
      const sourceCenterY = sharedIdentityRect.top + sharedIdentityRect.height / 2;
      const coreCenterX = coreRect.left + coreRect.width / 2;
      const coreCenterY = coreRect.top + coreRect.height / 2;
      morphTimeline.fromTo(
        elements.execution.core,
        {
          autoAlpha: 0.72,
          scale: Math.min(1, sharedIdentityRect.width / coreRect.width),
          x: sourceCenterX - coreCenterX,
          y: sourceCenterY - coreCenterY,
        },
        {
          autoAlpha: 1,
          scale: 1,
          x: 0,
          y: 0,
          duration: MOTION.morphSeconds * 0.88,
          ease: "expo.inOut",
          clearProps: "transform,opacity,visibility",
        },
        0,
      );
      morphTimeline.fromTo(
        [
          elements.execution.headline,
          elements.execution.action,
          elements.execution.meta,
        ],
        { autoAlpha: 0, x: 6 },
        {
          autoAlpha: 1,
          x: 0,
          duration: MOTION.revealSeconds,
          ease: "power2.out",
          stagger: 0.035,
          clearProps: "transform,opacity,visibility",
        },
        0.28,
      );
    } else {
      morphTimeline.fromTo(
        activeScene,
        { autoAlpha: 0, y: projection.scene === "planner" ? 12 : 6 },
        {
          autoAlpha: 1,
          y: 0,
          duration: MOTION.revealSeconds,
          ease: "power2.out",
          clearProps: "transform,opacity,visibility",
        },
        "-=0.25",
      );
    }
  }

  function render(projection: FloatingSurfaceProjection): void {
    if (disposed) return;
    const dispatchActive = dispatchTimeline?.isActive() === true;
    const leavesChargingScene =
      projection.scene !== "planner" && projection.scene !== "agent-charging";

    if (dispatchActive && currentScene === "agent-charging" && leavesChargingScene) {
      pendingProjection = projection;
      return;
    }

    if (dispatchActive && projection.scene !== "agent-charging") {
      pendingProjection = undefined;
      clearDispatch();
    }

    applyProjection(projection);
  }

  function dispatch(source: HTMLElement, target: HTMLElement): void {
    if (disposed || dispatchTimeline?.isActive() === true) return;
    const pendingAtStart = pendingProjection;
    pendingProjection = undefined;

    if (!supportsMotion(document)) {
      if (pendingAtStart !== undefined) applyProjection(pendingAtStart);
      return;
    }

    clearDispatch();
    dispatchSource = source;
    signalTarget = target;
    gsap.killTweensOf([signalLayer.path, ...signalLayer.particles, signalTarget]);
    const surfaceRect = elements.surface.getBoundingClientRect();
    const sourceRect = source.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    if (
      !finiteRect(surfaceRect) ||
      !finiteRect(sourceRect) ||
      !finiteRect(targetRect)
    ) {
      clearDispatch();
      return;
    }

    const identity = target.querySelector<HTMLElement>(
      "[data-spotpatch-agent-identity]",
    );

    const start = Object.freeze({
      x: sourceRect.left - surfaceRect.left + sourceRect.width / 2,
      y: sourceRect.top - surfaceRect.top + sourceRect.height / 2,
    });
    const end = Object.freeze({
      x: targetRect.left - surfaceRect.left + targetRect.width / 2,
      y: targetRect.bottom - surfaceRect.top - 12,
    });
    const controlY =
      Math.min(start.y, end.y) - Math.max(34, Math.abs(end.x - start.x) * 0.12);
    signalLayer.path.setAttribute(
      "d",
      `M ${String(start.x)} ${String(start.y)} C ${String(start.x)} ${String(controlY)}, ${String(end.x)} ${String(controlY)}, ${String(end.x)} ${String(end.y)}`,
    );
    signalLayer.root.style.display = "block";
    gsap.set(signalLayer.path, { strokeDasharray: 1, strokeDashoffset: 1 });
    gsap.set(signalLayer.particles, {
      attr: { cx: start.x, cy: start.y },
      autoAlpha: 0,
    });

    dispatchTimeline = gsap.timeline({
      onComplete: () => {
        const sharedIdentityRect = identity?.getBoundingClientRect();
        const nextProjection = pendingProjection;
        pendingProjection = undefined;
        signalLayer.root.style.display = "none";
        if (signalTarget !== undefined) {
          gsap.set(signalTarget, { clearProps: "boxShadow" });
          signalTarget = undefined;
        }
        if (dispatchSource !== undefined) {
          gsap.set(dispatchSource, { clearProps: "filter,transform" });
          dispatchSource = undefined;
        }
        elements.surface.dataset.agentCharging = "false";
        dispatchTimeline = undefined;
        if (nextProjection !== undefined) {
          applyProjection(nextProjection, sharedIdentityRect);
        }
      },
    });
    dispatchTimeline.fromTo(
      source,
      { filter: "brightness(1)", scaleX: 1, scaleY: 1 },
      {
        filter: "brightness(1.08)",
        scaleX: 0.995,
        scaleY: 0.97,
        duration: 0.12,
        ease: "power2.out",
        yoyo: true,
        repeat: 1,
        clearProps: "filter,transform",
      },
      0,
    );
    dispatchTimeline.to(
      signalLayer.path,
      {
        strokeDashoffset: 0,
        duration: MOTION.signalSeconds,
        ease: "power2.inOut",
      },
      0.1,
    );
    for (const [index, particle] of signalLayer.particles.entries()) {
      dispatchTimeline.fromTo(
        particle,
        { attr: { cx: start.x, cy: start.y }, autoAlpha: 0 },
        {
          attr: { cx: end.x, cy: end.y },
          autoAlpha: 1,
          duration: MOTION.signalSeconds * 0.7,
          ease: "power2.inOut",
        },
        0.16 + index * 0.045,
      );
      dispatchTimeline.to(particle, { autoAlpha: 0, duration: 0.12 }, "-=0.12");
    }
    dispatchTimeline.call(
      () => {
        elements.surface.dataset.agentCharging = "true";
      },
      [],
      0.54,
    );
    dispatchTimeline.fromTo(
      target,
      { boxShadow: "0 0 0 rgb(82 168 255 / 0%)" },
      {
        boxShadow: "0 0 30px rgb(82 168 255 / 24%)",
        duration: 0.28,
        yoyo: true,
        repeat: 1,
      },
      0.54,
    );
    dispatchTimeline.to({}, { duration: MOTION.dispatchSeconds - 0.82 }, 0.82);
  }

  return Object.freeze({
    cancel,
    dispatch,
    render,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      cancel();
      document.removeEventListener("visibilitychange", handleVisibility);
      signalLayer.root.remove();
    },
  });
}
