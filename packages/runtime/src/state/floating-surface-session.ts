import type {
  FloatingSurfaceAlignment,
  FloatingSurfacePosition,
} from "../ui/floating-surface-position.js";

const STORAGE_PREFIX = "spotpatch:floating-surface:";
const SNAPSHOT_VERSION = 1;
const MAX_SNAPSHOT_CHARACTERS = 1_024;

export interface FloatingSurfaceSession {
  readonly clear: () => void;
  readonly load: () => FloatingSurfacePosition | undefined;
  readonly save: (position: FloatingSurfacePosition) => void;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function finiteRatio(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
  );
}

function alignment(value: unknown): value is FloatingSurfaceAlignment {
  return value === "start" || value === "end";
}

function parseSnapshot(value: unknown): FloatingSurfacePosition | undefined {
  const snapshot = record(value);

  if (
    snapshot?.version !== SNAPSHOT_VERSION ||
    !alignment(snapshot.horizontal) ||
    !alignment(snapshot.vertical) ||
    !finiteRatio(snapshot.xRatio) ||
    !finiteRatio(snapshot.yRatio)
  ) {
    return undefined;
  }

  return Object.freeze({
    horizontal: snapshot.horizontal,
    vertical: snapshot.vertical,
    xRatio: snapshot.xRatio,
    yRatio: snapshot.yRatio,
  });
}

export function createFloatingSurfaceSession(
  window: Window,
  sessionId: string,
): FloatingSurfaceSession {
  const key = `${STORAGE_PREFIX}${sessionId}`;
  let storage: Storage | undefined;

  try {
    storage = window.sessionStorage;
  } catch {
    storage = undefined;
  }

  return Object.freeze({
    clear(): void {
      try {
        storage?.removeItem(key);
      } catch {
        // Position restoration is optional; an unavailable store cannot disable the UI.
      }
    },

    load(): FloatingSurfacePosition | undefined {
      let serialized: string | null;

      try {
        serialized = storage?.getItem(key) ?? null;
      } catch {
        return undefined;
      }

      if (serialized === null || serialized.length > MAX_SNAPSHOT_CHARACTERS) {
        return undefined;
      }

      try {
        return parseSnapshot(JSON.parse(serialized) as unknown);
      } catch {
        return undefined;
      }
    },

    save(position: FloatingSurfacePosition): void {
      try {
        storage?.setItem(
          key,
          JSON.stringify({ version: SNAPSHOT_VERSION, ...position }),
        );
      } catch {
        // Position restoration is optional; the current in-memory position remains valid.
      }
    },
  });
}
