export const SOURCE_MARKER_ATTRIBUTE = "data-spotpatch-source" as const;

const SOURCE_MARKER_PATTERN = /^([A-Za-z0-9_-]+):([1-9]\d*):([1-9]\d*)(:astro)?$/;

export interface SourceMarker {
  readonly fileId: string;
  readonly line: number;
  readonly column: number;
  readonly kind?: "astro";
}

export function formatSourceMarker(marker: SourceMarker): string {
  return [
    marker.fileId,
    String(marker.line),
    String(marker.column),
    ...(marker.kind === undefined ? [] : [marker.kind]),
  ].join(":");
}

export function parseSourceMarker(value: string | null): SourceMarker | undefined {
  if (value === null) {
    return undefined;
  }

  const match = SOURCE_MARKER_PATTERN.exec(value);

  if (match === null) {
    return undefined;
  }

  const fileId = match[1];
  const line = Number(match[2]);
  const column = Number(match[3]);

  if (
    fileId === undefined ||
    !Number.isSafeInteger(line) ||
    !Number.isSafeInteger(column)
  ) {
    return undefined;
  }

  return Object.freeze({
    fileId,
    line,
    column,
    ...(match[4] === undefined ? {} : { kind: "astro" as const }),
  });
}
