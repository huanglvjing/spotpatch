import { gsap } from "gsap";

import type {
  FloatingSurfaceMotionController,
  FloatingSurfaceMotionElements,
  FloatingSurfaceProjection,
} from "./motion-extension-contract.js";

const MOTION = Object.freeze({
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
  elements.execution.hidden = !executionActive;
  elements.execution.inert = !executionActive;
  elements.execution.setAttribute("aria-hidden", String(!executionActive));

  return pillActive
    ? elements.pill
    : plannerActive
      ? elements.planner
      : elements.execution;
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
      --spotpatch-island-radius: 24px;
      --spotpatch-island-compact-width: min(430px, calc(100vw - 32px));
      --spotpatch-motion-fast: 140ms;
      --spotpatch-motion-ease: cubic-bezier(.2, .8, .2, 1);
      color-scheme: dark;
      -webkit-font-smoothing: antialiased;
      border: 1px solid rgb(255 255 255 / 11%);
      border-radius: var(--spotpatch-island-radius);
      background: rgb(10 10 14 / 98%);
      box-shadow: 0 28px 72px -28px rgb(0 0 0 / 78%), inset 0 1px rgb(255 255 255 / 6%);
      overflow: hidden;
      transform-origin: 100% 100%;
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
      width: var(--spotpatch-island-compact-width);
    }
    .spotpatch-floating-surface[data-scene="planner"],
    .spotpatch-floating-surface[data-scene="agent-charging"] {
      border-radius: 18px;
    }
    .spotpatch-floating-surface::before {
      position: absolute;
      z-index: 0;
      inset: -45%;
      background: radial-gradient(circle at 68% 86%, rgb(84 112 255 / 24%), transparent 40%), radial-gradient(circle at 35% 22%, rgb(139 92 246 / 18%), transparent 34%);
      content: "";
      opacity: 0;
      pointer-events: none;
      transform: translate3d(0, 12%, 0) scale(.92);
    }
    .spotpatch-floating-surface[data-tone="capturing"]::before,
    .spotpatch-floating-surface[data-tone="running"]::before { opacity: .72; }
    .spotpatch-floating-surface[data-tone="success"]::before {
      background: radial-gradient(circle at 60% 82%, rgb(52 211 153 / 22%), transparent 42%);
      opacity: .76;
    }
    .spotpatch-floating-surface[data-tone="danger"]::before {
      background: radial-gradient(circle at 60% 82%, rgb(251 113 133 / 18%), transparent 42%);
      opacity: .7;
    }
    .spotpatch-floating-surface[data-scene="running"]::before {
      animation: spotpatch-motion-breathe 2.6s ease-in-out infinite;
    }
    .spotpatch-floating-surface[data-motion-paused="true"]::before { animation-play-state: paused; }
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
      display: grid;
      box-sizing: border-box;
      width: 100%;
      min-height: 112px;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 6px 18px;
      align-items: center;
      border: 0;
      padding: 18px 20px;
      color: var(--spotpatch-text);
      background: transparent;
      cursor: pointer;
      text-align: left;
    }
    .spotpatch-execution-copy { display: grid; min-width: 0; gap: 2px; }
    .spotpatch-execution-identity,
    .spotpatch-execution-phase {
      color: var(--spotpatch-text-secondary);
      font: 650 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
      letter-spacing: .035em;
      text-transform: uppercase;
    }
    .spotpatch-execution-title {
      overflow: hidden;
      color: #f8fafc;
      font-size: 15px;
      font-weight: 700;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spotpatch-execution-detail {
      overflow: hidden;
      color: var(--spotpatch-text-secondary);
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spotpatch-execution-status { display: grid; justify-items: center; gap: 6px; }
    .spotpatch-execution-orbit {
      position: relative;
      width: 38px;
      height: 38px;
      border: 1px solid rgb(139 123 255 / 38%);
      border-radius: 50%;
      box-shadow: inset 0 0 18px rgb(109 93 246 / 14%), 0 0 22px rgb(82 168 255 / 9%);
    }
    .spotpatch-execution-orbit::before {
      position: absolute;
      inset: 8px;
      border-radius: inherit;
      background: linear-gradient(135deg, var(--spotpatch-accent), var(--spotpatch-accent-cyan));
      box-shadow: 0 0 16px rgb(109 93 246 / 42%);
      content: "";
    }
    [data-scene="running"] .spotpatch-execution-orbit { animation: spotpatch-motion-orbit 1.8s linear infinite; }
    [data-scene="success"] .spotpatch-execution-orbit { border-color: rgb(52 211 153 / 52%); }
    [data-scene="success"] .spotpatch-execution-orbit::before { background: var(--spotpatch-success); }
    [data-scene="failed"] .spotpatch-execution-orbit { border-color: rgb(251 113 133 / 45%); }
    [data-scene="failed"] .spotpatch-execution-orbit::before { background: var(--spotpatch-danger); }
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
      border-color: rgb(82 168 255 / 55%);
      box-shadow: inset 0 0 0 1px rgb(139 123 255 / 14%), 0 0 28px -16px rgb(82 168 255 / 64%);
    }
    @keyframes spotpatch-motion-breathe {
      0%, 100% { opacity: .48; transform: translate3d(-2%, 11%, 0) scale(.92); }
      50% { opacity: .88; transform: translate3d(2%, 7%, 0) scale(1.03); }
    }
    @keyframes spotpatch-motion-pill-pulse {
      0%, 100% { box-shadow: 0 0 0 4px rgb(99 102 241 / 10%); transform: scale(1); }
      50% { box-shadow: 0 0 0 7px rgb(99 102 241 / 4%); transform: scale(1.12); }
    }
    @keyframes spotpatch-motion-orbit { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      .spotpatch-floating-surface::before,
      .spotpatch-execution-orbit,
      .spotpatch-trigger::before { animation: none !important; }
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
  let timeline: gsap.core.Timeline | undefined;
  let signalTimeline: gsap.core.Timeline | undefined;
  let signalTarget: HTMLElement | undefined;
  let disposed = false;

  const handleVisibility = (): void => {
    elements.surface.dataset.motionPaused = String(document.hidden);
  };
  document.addEventListener("visibilitychange", handleVisibility);
  handleVisibility();

  function cancel(): void {
    timeline?.kill();
    timeline = undefined;
    signalTimeline?.kill();
    signalTimeline = undefined;
    if (signalTarget !== undefined) {
      gsap.killTweensOf(signalTarget);
      gsap.set(signalTarget, { clearProps: "boxShadow" });
      signalTarget = undefined;
    }
    gsap.killTweensOf([
      elements.surface,
      elements.pill,
      elements.planner,
      elements.execution,
      signalLayer.path,
      ...signalLayer.particles,
    ]);
    gsap.set(
      [elements.surface, elements.pill, elements.planner, elements.execution],
      { clearProps: "transform,opacity,visibility" },
    );
    signalLayer.root.style.display = "none";
    elements.surface.dataset.agentCharging = "false";
  }

  function render(projection: FloatingSurfaceProjection): void {
    if (disposed) return;
    const previousRect = elements.surface.getBoundingClientRect();
    const sceneChanged = currentScene !== projection.scene;
    cancel();

    elements.executionIdentity.textContent = projection.identity;
    elements.executionTitle.textContent = projection.title;
    elements.executionDetail.textContent = projection.detail;
    elements.executionPhase.textContent = projection.phase;
    elements.surface.dataset.scene = projection.scene;
    elements.surface.dataset.tone = projection.tone;
    elements.surface.dataset.agentCharging = String(
      projection.scene === "agent-charging",
    );
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

    timeline = gsap.timeline({ defaults: { overwrite: "auto" } });
    timeline.fromTo(
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
    timeline.fromTo(
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

  function signal(source: HTMLElement, target: HTMLElement): void {
    if (disposed || !supportsMotion(document)) return;
    signalTimeline?.kill();
    if (signalTarget !== undefined) {
      gsap.killTweensOf(signalTarget);
      gsap.set(signalTarget, { clearProps: "boxShadow" });
    }
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
      return;
    }

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
    elements.surface.dataset.agentCharging = "true";

    signalTimeline = gsap.timeline({
      onComplete: () => {
        signalLayer.root.style.display = "none";
        if (signalTarget !== undefined) {
          gsap.set(signalTarget, { clearProps: "boxShadow" });
          signalTarget = undefined;
        }
        signalTimeline = undefined;
      },
    });
    signalTimeline.to(signalLayer.path, {
      strokeDashoffset: 0,
      duration: MOTION.signalSeconds,
      ease: "power2.inOut",
    });
    for (const [index, particle] of signalLayer.particles.entries()) {
      signalTimeline.fromTo(
        particle,
        { attr: { cx: start.x, cy: start.y }, autoAlpha: 0 },
        {
          attr: { cx: end.x, cy: end.y },
          autoAlpha: 1,
          duration: MOTION.signalSeconds * 0.7,
          ease: "power2.inOut",
        },
        index * 0.045,
      );
      signalTimeline.to(particle, { autoAlpha: 0, duration: 0.12 }, "-=0.12");
    }
    signalTimeline.fromTo(
      target,
      { boxShadow: "0 0 0 rgb(82 168 255 / 0%)" },
      {
        boxShadow: "0 0 30px rgb(82 168 255 / 24%)",
        duration: 0.28,
        yoyo: true,
        repeat: 1,
      },
      "-=0.3",
    );
  }

  return Object.freeze({
    cancel,
    render,
    signal,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      cancel();
      document.removeEventListener("visibilitychange", handleVisibility);
      signalLayer.root.remove();
    },
  });
}
