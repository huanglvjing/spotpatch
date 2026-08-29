import { createButton, createMarkedElement } from "./dom.js";
import type {
  FloatingSurfaceProjection,
  MotionExecutionIsland,
} from "./motion-extension-contract.js";

const TIMER_INTERVAL_MS = 1_000;

export type ExecutionActivityKind =
  | "prepare"
  | "dispatch"
  | "discover"
  | "search"
  | "read"
  | "patch"
  | "check"
  | "audit"
  | "apply"
  | "sync"
  | "unknown";

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

  const core = createMarkedElement(document, "span");
  core.className = "spotpatch-agent-core";
  core.setAttribute("aria-hidden", "true");
  const coreSeed = createMarkedElement(document, "span");
  coreSeed.className = "spotpatch-agent-core-seed";
  core.append(coreSeed);

  const content = createMarkedElement(document, "span");
  content.className = "spotpatch-execution-content";
  const headline = createMarkedElement(document, "strong");
  headline.className = "spotpatch-execution-headline";
  const action = createMarkedElement(document, "span");
  action.className = "spotpatch-execution-action";
  const activityLane = createMarkedElement(document, "span");
  activityLane.className = "spotpatch-execution-activity";
  activityLane.hidden = true;
  const activitySheen = createMarkedElement(document, "span");
  activitySheen.className = "spotpatch-execution-activity-sheen";
  const activityOutgoing = createMarkedElement(document, "span");
  activityOutgoing.className = "spotpatch-execution-activity-outgoing";
  activityOutgoing.setAttribute("aria-hidden", "true");
  const activityLabel = createMarkedElement(document, "span");
  activityLabel.className = "spotpatch-execution-activity-label";
  activityLane.append(activitySheen, activityOutgoing, activityLabel);
  const recent = createMarkedElement(document, "span");
  recent.className = "spotpatch-execution-recent";
  recent.setAttribute("aria-hidden", "true");
  content.append(headline, action, activityLane, recent);

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

  const streak = createMarkedElement(document, "span");
  streak.className = "spotpatch-island-streak";
  streak.setAttribute("aria-hidden", "true");
  root.append(core, content, meta, streak);

  const elements = Object.freeze({
    action,
    activityLabel,
    activityLane,
    core,
    headline,
    meta,
    recent,
    root,
    streak,
    timer,
  });
  let currentProjection: FloatingSurfaceProjection | undefined;
  let currentActivityKey: string | undefined;
  let timerHandle: number | undefined;
  let startedAt: number | undefined;
  let disposed = false;

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
    metaLabel.hidden = timed;
    metaLabel.textContent = timed ? "" : projection.meta;
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
    elements,
    root,
    render(projection: FloatingSurfaceProjection): void {
      if (disposed) return;
      currentProjection = projection;
      root.dataset.executionScene = projection.scene;
      headline.textContent = projection.headline;
      action.textContent = projection.action;
      meta.dataset.tone = projection.tone;
      root.setAttribute(
        "aria-label",
        [projection.headline, projection.action, projection.meta]
          .filter(Boolean)
          .join(". "),
      );
      syncTimer(projection);

      const activity = projection.activity;
      activityLane.hidden = activity === undefined;
      activityLane.dataset.state = activity?.state ?? "info";
      if (activity !== undefined && activity.key !== currentActivityKey) {
        activityOutgoing.textContent = activityLabel.textContent;
        activityLabel.textContent = activity.label;
        activityLane.classList.remove("spotpatch-execution-activity-enter");
        const reducedMotion = prefersReducedMotion(window);
        if (!reducedMotion) {
          void activityLane.offsetWidth;
          activityLane.classList.add("spotpatch-execution-activity-enter");
        }
      } else {
        activityLabel.textContent = activity?.label ?? "";
      }
      currentActivityKey = activity?.key;

      recent.replaceChildren(
        ...projection.recentActivities.slice(-3).map((item) => {
          const row = createMarkedElement(document, "span");
          row.className = "spotpatch-execution-recent-item";
          row.dataset.state = item.state;
          row.textContent = item.label;
          return row;
        }),
      );
      recent.hidden = projection.recentActivities.length < 2;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      stopTimer();
      document.removeEventListener("visibilitychange", handleVisibility);
    },
  });
}
