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

export interface FloatingSurfaceProjection {
  readonly detail: string;
  readonly identity: string;
  readonly phase: string;
  readonly scene: FloatingSurfaceScene;
  readonly title: string;
  readonly tone: FloatingSurfaceTone;
}

export interface FloatingSurfaceMotionElements {
  readonly execution: HTMLButtonElement;
  readonly executionDetail: HTMLElement;
  readonly executionIdentity: HTMLElement;
  readonly executionPhase: HTMLElement;
  readonly executionTitle: HTMLElement;
  readonly pill: HTMLButtonElement;
  readonly planner: HTMLElement;
  readonly surface: HTMLElement;
}

export interface FloatingSurfaceMotionController {
  readonly cancel: () => void;
  readonly dispose: () => void;
  readonly render: (projection: FloatingSurfaceProjection) => void;
  readonly signal: (source: HTMLElement, target: HTMLElement) => void;
}

export interface FloatingSurfaceMotionExtension {
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
