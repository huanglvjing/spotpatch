import type {
  CodeContext,
  ElementContext,
  PageContext,
  ReactContext,
  SourceRef,
  SpotTargetContext,
  StyleContext,
} from "@spotpatch/shared";

const STORAGE_PREFIX = "spotpatch:selection:";
const SNAPSHOT_VERSION = 1;
const MAX_SNAPSHOT_CHARACTERS = 1_000_000;

export interface SelectionSnapshotTarget extends Omit<
  SpotTargetContext,
  "page" | "warnings"
> {
  readonly id: string;
  readonly page: PageContext;
}

export interface SelectionSnapshot {
  readonly activeTargetId?: string;
  readonly open: boolean;
  readonly sequence: number;
  readonly targets: readonly SelectionSnapshotTarget[];
}

export interface SelectionSession {
  readonly clear: () => void;
  readonly load: () => SelectionSnapshot | undefined;
  readonly save: (snapshot: SelectionSnapshot) => void;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function text(value: unknown): value is string {
  return typeof value === "string";
}

function optionalText(value: unknown): value is string | undefined {
  return value === undefined || text(value);
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 256 && value.every(text);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function optionalNumber(value: unknown): value is number | undefined {
  return value === undefined || finiteNumber(value);
}

function source(value: unknown): value is SourceRef {
  const item = record(value);
  return (
    item !== undefined &&
    text(item.origin) &&
    text(item.confidence) &&
    optionalText(item.fileId) &&
    optionalText(item.relativePath) &&
    optionalNumber(item.line) &&
    optionalNumber(item.column)
  );
}

function react(value: unknown): value is ReactContext {
  const item = record(value);
  return (
    item !== undefined &&
    typeof item.supported === "boolean" &&
    optionalText(item.version) &&
    optionalText(item.componentName) &&
    strings(item.componentStack) &&
    (item.source === undefined || source(item.source))
  );
}

function page(value: unknown): value is PageContext {
  const item = record(value);
  return (
    item !== undefined &&
    text(item.url) &&
    text(item.pathname) &&
    text(item.title) &&
    finiteNumber(item.viewportWidth) &&
    finiteNumber(item.viewportHeight) &&
    finiteNumber(item.devicePixelRatio)
  );
}

function element(value: unknown): value is ElementContext {
  const item = record(value);
  const rect = record(item?.rect);
  return (
    item !== undefined &&
    text(item.tagName) &&
    text(item.selector) &&
    text(item.sanitizedHtml) &&
    optionalText(item.textPreview) &&
    optionalText(item.role) &&
    rect !== undefined &&
    finiteNumber(rect.x) &&
    finiteNumber(rect.y) &&
    finiteNumber(rect.width) &&
    finiteNumber(rect.height)
  );
}

function styles(value: unknown): value is StyleContext {
  const item = record(value);
  const computed = record(item?.computed);
  return (
    item !== undefined &&
    strings(item.classNames) &&
    optionalText(item.inlineStyle) &&
    Array.isArray(item.matchedRules) &&
    item.matchedRules.length <= 256 &&
    item.matchedRules.every((value) => {
      const rule = record(value);
      return (
        rule !== undefined &&
        text(rule.selector) &&
        text(rule.declarations) &&
        optionalText(rule.source) &&
        optionalText(rule.media)
      );
    }) &&
    computed !== undefined &&
    Object.values(computed).every(text) &&
    strings(item.warnings)
  );
}

function code(value: unknown): value is CodeContext {
  const item = record(value);
  return (
    item !== undefined &&
    text(item.relativePath) &&
    text(item.language) &&
    finiteNumber(item.startLine) &&
    finiteNumber(item.endLine) &&
    text(item.excerpt) &&
    text(item.boundary)
  );
}

function target(value: unknown): value is SelectionSnapshotTarget {
  const item = record(value);
  return (
    item !== undefined &&
    text(item.id) &&
    text(item.instruction) &&
    page(item.page) &&
    source(item.source) &&
    react(item.react) &&
    element(item.element) &&
    styles(item.styles) &&
    (item.code === undefined || code(item.code))
  );
}

function parseSnapshot(
  value: unknown,
  maximumTargets: number,
): SelectionSnapshot | undefined {
  const item = record(value);
  if (
    item?.version !== SNAPSHOT_VERSION ||
    typeof item.open !== "boolean" ||
    !Number.isSafeInteger(item.sequence) ||
    Number(item.sequence) < 0 ||
    (item.activeTargetId !== undefined && typeof item.activeTargetId !== "string") ||
    !Array.isArray(item.targets) ||
    item.targets.length === 0 ||
    item.targets.length > maximumTargets ||
    !item.targets.every(target)
  ) {
    return undefined;
  }

  const targets = item.targets;
  const ids = targets.map(({ id }) => id);
  if (
    new Set(ids).size !== ids.length ||
    (item.activeTargetId !== undefined && !ids.includes(item.activeTargetId))
  ) {
    return undefined;
  }

  return {
    ...(item.activeTargetId === undefined
      ? {}
      : { activeTargetId: item.activeTargetId }),
    open: item.open,
    sequence: Number(item.sequence),
    targets,
  };
}

export function createSelectionSession(
  window: Window,
  sessionId: string,
  maximumTargets: number,
): SelectionSession {
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
        // Storage can be unavailable or full without disabling the picker.
      }
    },
    load(): SelectionSnapshot | undefined {
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
        return parseSnapshot(JSON.parse(serialized) as unknown, maximumTargets);
      } catch {
        return undefined;
      }
    },
    save(snapshot: SelectionSnapshot): void {
      try {
        storage?.setItem(
          key,
          JSON.stringify({ version: SNAPSHOT_VERSION, ...snapshot }),
        );
      } catch {
        // Persistence is best-effort; the active in-memory selection stays valid.
      }
    },
  });
}
