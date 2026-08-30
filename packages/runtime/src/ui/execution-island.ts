import { createButton, createMarkedElement } from "./dom.js";
import { BRAND_MARK_CONTENT } from "./brand-mark-content.js";
import { createBrandMark } from "./brand-mark.js";
import type {
  FloatingSurfaceProjection,
  MotionExecutionIsland,
} from "./motion-extension-contract.js";

const TIMER_INTERVAL_MS = 1_000;

export type { ExecutionActivityKind } from "./motion-extension-contract.js";

function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / TIMER_INTERVAL_MS));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const twoDigits = (value: number): string => String(value).padStart(2, "0");

  return hours > 0
    ? `${twoDigits(hours)}:${twoDigits(minutes)}:${twoDigits(seconds)}`
    : `${twoDigits(totalMinutes)}:${twoDigits(seconds)}`;
}

function validTimestamp(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function prefersReducedMotion(window: Window): boolean {
  const matchMedia: unknown = Reflect.get(window, "matchMedia");
  if (typeof matchMedia !== "function") return false;
  const result: unknown = Reflect.apply(matchMedia, window, [
    "(prefers-reduced-motion: reduce)",
  ]);
  return (
    typeof result === "object" &&
    result !== null &&
    "matches" in result &&
    result.matches === true
  );
}

export function createExecutionIsland(
  document: Document,
  now: () => number = Date.now,
): MotionExecutionIsland {
  const window = document.defaultView;

  if (window === null) {
    throw new Error("SpotPatch Execution Island requires an associated window.");
  }

  const root = createButton(document, "", "spotpatch-execution-island");
  root.hidden = true;
  root.setAttribute("aria-hidden", "true");
  root.setAttribute("aria-expanded", "false");

  const logo = createBrandMark(
    document,
    BRAND_MARK_CONTENT,
    "spotpatch-execution-island",
  );
  logo.classList.add("spotpatch-execution-logo");
  const mark = createMarkedElement(document, "span");
  mark.className = "spotpatch-execution-mark";
  mark.append(logo);

  const content = createMarkedElement(document, "span");
  content.className = "spotpatch-execution-content";
  content.setAttribute("role", "status");
  content.setAttribute("aria-live", "polite");
  content.setAttribute("aria-atomic", "true");
  const headlineWrap = createMarkedElement(document, "span");
  headlineWrap.className = "spotpatch-execution-headline-wrap";
  const headline = createMarkedElement(document, "strong");
  headline.className = "spotpatch-execution-headline";
  const headlineOutgoing = createMarkedElement(document, "strong");
  headlineOutgoing.className = "spotpatch-execution-headline-outgoing";
  headlineOutgoing.setAttribute("aria-hidden", "true");
  headlineWrap.append(headlineOutgoing, headline);
  const actionWrap = createMarkedElement(document, "span");
  actionWrap.className = "spotpatch-execution-action-wrap";
  const action = createMarkedElement(document, "span");
  action.className = "spotpatch-execution-action";
  const actionOutgoing = createMarkedElement(document, "span");
  actionOutgoing.className = "spotpatch-execution-action-outgoing";
  actionOutgoing.setAttribute("aria-hidden", "true");
  actionWrap.append(actionOutgoing, action);
  const recent = createMarkedElement(document, "span");
  recent.className = "spotpatch-execution-recent";
  content.append(headlineWrap, actionWrap);

  const meta = createMarkedElement(document, "span");
  meta.className = "spotpatch-execution-meta";
  const metaDot = createMarkedElement(document, "span");
  metaDot.className = "spotpatch-execution-meta-dot";
  metaDot.setAttribute("aria-hidden", "true");
  const metaLabel = createMarkedElement(document, "span");
  metaLabel.className = "spotpatch-execution-meta-label";
  const timer = createMarkedElement(document, "span");
  timer.className = "spotpatch-execution-timer";
  timer.hidden = true;
  meta.append(metaDot, metaLabel, timer);

  const more = createMarkedElement(document, "span");
  more.className = "spotpatch-execution-more";
  more.textContent = "•••";
  more.setAttribute("aria-hidden", "true");
  meta.append(more);

  const sweep = createMarkedElement(document, "span");
  sweep.className = "spotpatch-island-sweep";
  sweep.setAttribute("aria-hidden", "true");
  root.append(mark, content, meta, recent, sweep);

  const elements = Object.freeze({
    action,
    actionOutgoing,
    content,
    headline,
    headlineOutgoing,
    logo,
    mark,
    meta,
    metaDot,
    metaLabel,
    more,
    recent,
    root,
    sweep,
    timer,
  });
  let currentProjection: FloatingSurfaceProjection | undefined;
  let expandable = false;
  let expanded = false;
  let timerHandle: number | undefined;
  let startedAt: number | undefined;
  let disposed = false;

  const updateExpandedState = (): void => {
    expanded = expandable && expanded;
    root.dataset.expandable = String(expandable);
    root.dataset.expanded = String(expanded);
    root.setAttribute("aria-expanded", String(expanded));
    more.textContent = expanded ? "×" : "•••";
    recent.hidden = !expanded;
  };

  const animateCopyChange = (
    element: HTMLElement,
    outgoing: HTMLElement,
    value: string,
  ): void => {
    if (element.textContent === value) return;
    outgoing.textContent = element.textContent;
    element.textContent = value;
    root.classList.remove("spotpatch-execution-copy-changing");
    if (!prefersReducedMotion(window)) {
      void root.offsetWidth;
      root.classList.add("spotpatch-execution-copy-changing");
    }
  };
  const syncProjectionCopy = (projection: FloatingSurfaceProjection): void => {
    const visibleHeadline = expanded
      ? (projection.expandedHeadline ?? projection.headline)
      : projection.headline;
    const visibleAction = expanded
      ? (projection.expandedAction ?? projection.action)
      : projection.action;
    animateCopyChange(headline, headlineOutgoing, visibleHeadline);
    animateCopyChange(action, actionOutgoing, visibleAction);
    root.setAttribute(
      "aria-label",
      [visibleHeadline, visibleAction, projection.meta].filter(Boolean).join(". "),
    );
  };

  const stopTimer = (): void => {
    if (timerHandle === undefined) return;
    window.clearInterval(timerHandle);
    timerHandle = undefined;
  };
  const updateTimer = (): void => {
    if (startedAt === undefined) return;
    timer.textContent = formatElapsed(now() - startedAt);
  };
  const startTimer = (): void => {
    if (timerHandle !== undefined || startedAt === undefined || document.hidden) {
      return;
    }
    updateTimer();
    timerHandle = window.setInterval(updateTimer, TIMER_INTERVAL_MS);
  };
  const syncTimer = (projection: FloatingSurfaceProjection): void => {
    stopTimer();
    startedAt =
      projection.scene === "running" ? validTimestamp(projection.startedAt) : undefined;
    const timed = startedAt !== undefined;
    timer.hidden = !timed;
    metaLabel.textContent = projection.meta;
    if (timed) startTimer();
  };
  const handleVisibility = (): void => {
    if (document.hidden) {
      stopTimer();
    } else if (currentProjection !== undefined) {
      syncTimer(currentProjection);
    }
  };
  document.addEventListener("visibilitychange", handleVisibility);

  return Object.freeze({
    canExpand: () => expandable,
    elements,
    isExpanded: () => expanded,
    root,
    setExpanded(nextExpanded: boolean): void {
      expanded = nextExpanded;
      updateExpandedState();
      if (currentProjection !== undefined) syncProjectionCopy(currentProjection);
    },
    render(projection: FloatingSurfaceProjection): void {
      if (disposed) return;
      currentProjection = projection;
      root.dataset.executionScene = projection.scene;
      meta.dataset.tone = projection.tone;
      syncTimer(projection);

      recent.replaceChildren(
        ...projection.recentActivities.slice(-3).map((item) => {
          const row = createMarkedElement(document, "span");
          row.className = "spotpatch-execution-recent-item";
          row.dataset.state = item.state;
          const kind = createMarkedElement(document, "span");
          kind.className = "spotpatch-execution-recent-kind";
          kind.textContent = item.kind;
          const detail = createMarkedElement(document, "span");
          detail.className = "spotpatch-execution-recent-detail";
          detail.textContent = item.detail ?? item.label;
          const state = createMarkedElement(document, "span");
          state.className = "spotpatch-execution-recent-state";
          state.textContent = item.state;
          row.append(kind, detail, state);
          return row;
        }),
      );
      expandable = projection.recentActivities.length > 0;
      if (projection.scene === "success" || projection.scene === "failed") {
        expanded = false;
      }
      updateExpandedState();
      syncProjectionCopy(projection);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      stopTimer();
      document.removeEventListener("visibilitychange", handleVisibility);
    },
  });
}
