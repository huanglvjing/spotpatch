export interface SourcePosition {
  readonly line: number;
  readonly column: number;
}

export function createLineStarts(code: string): readonly number[] {
  const starts = [0];

  for (let index = 0; index < code.length; index += 1) {
    if (code.charCodeAt(index) === 10) {
      starts.push(index + 1);
    }
  }

  return starts;
}

export function getSourcePosition(
  lineStarts: readonly number[],
  offset: number,
): SourcePosition {
  let lower = 0;
  let upper = lineStarts.length - 1;

  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2);
    const start = lineStarts[middle];

    if (start === undefined) {
      break;
    }

    if (start <= offset) {
      lower = middle + 1;
    } else {
      upper = middle - 1;
    }
  }

  const lineIndex = Math.max(0, upper);
  const lineStart = lineStarts[lineIndex] ?? 0;

  return Object.freeze({
    line: lineIndex + 1,
    column: offset - lineStart + 1,
  });
}
