export type FloatingSurfaceScene =
  | "pill"
  | "capturing"
  | "planner"
  | "agent-charging"
  | "handoff"
  | "running"
  | "success"
  | "failed";

export type FloatingSurfaceTone =
  "neutral" | "capturing" | "ready" | "running" | "success" | "danger";

export interface FloatingSurfaceActivity {
  readonly key: string;
  readonly label: string;
  readonly state: "active" | "success" | "failure" | "info";
}

export interface FloatingSurfaceProjection {
  readonly action: string;
  readonly activity?: FloatingSurfaceActivity;
  readonly headline: string;
  readonly meta: string;
  readonly recentActivities: readonly FloatingSurfaceActivity[];
  readonly scene: FloatingSurfaceScene;
  readonly startedAt?: string;
  readonly tone: FloatingSurfaceTone;
}

export interface ExecutionIslandElements {
  readonly action: HTMLElement;
  readonly activityLane: HTMLElement;
  readonly activityLabel: HTMLElement;
  readonly core: HTMLElement;
  readonly headline: HTMLElement;
  readonly meta: HTMLElement;
  readonly recent: HTMLElement;
  readonly root: HTMLButtonElement;
  readonly streak: HTMLElement;
  readonly timer: HTMLElement;
}

export interface ExecutionIslandView {
  readonly dispose: () => void;
  readonly render: (projection: FloatingSurfaceProjection) => void;
  readonly root: HTMLButtonElement;
}

export interface MotionExecutionIsland extends ExecutionIslandView {
  readonly elements: ExecutionIslandElements;
}

export interface FloatingSurfaceMotionElements {
  readonly execution: ExecutionIslandElements;
  readonly pill: HTMLButtonElement;
  readonly planner: HTMLElement;
  readonly surface: HTMLElement;
}

export interface FloatingSurfaceMotionController {
  readonly cancel: () => void;
  readonly dispatch: (source: HTMLElement, target: HTMLElement) => void;
  readonly dispose: () => void;
  readonly render: (projection: FloatingSurfaceProjection) => void;
}

export interface FloatingSurfaceMotionExtension {
  readonly createExecutionIsland: (document: Document) => MotionExecutionIsland;
  readonly createController: (
    document: Document,
    elements: FloatingSurfaceMotionElements,
    reconcile: () => void,
  ) => FloatingSurfaceMotionController;
  readonly createStyles: (document: Document) => HTMLStyleElement;
}

const MOTION_EXTENSION_KEY = Symbol.for("spotpatch.motion.v1");
type ExtensionStore = Partial<Record<symbol, FloatingSurfaceMotionExtension>>;

export function registerFloatingSurfaceMotionExtension(
  extension: FloatingSurfaceMotionExtension,
): void {
  (globalThis as ExtensionStore)[MOTION_EXTENSION_KEY] = extension;
}

export function getFloatingSurfaceMotionExtension():
  FloatingSurfaceMotionExtension | undefined {
  return (globalThis as ExtensionStore)[MOTION_EXTENSION_KEY];
}
