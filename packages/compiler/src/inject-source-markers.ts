import path from "node:path";

import {
  formatSourceMarker,
  SOURCE_MARKER_ATTRIBUTE,
  type SourceMarker,
} from "@spotpatch/shared";
import { MagicString } from "magic-string";
import { parseSync, Visitor, type JSXOpeningElement } from "oxc-parser";

import {
  hasSourceMarkerAttribute,
  isIntrinsicOpeningElement,
} from "./intrinsic-element.js";
import { createLineStarts, getSourcePosition } from "./source-position.js";

export interface TransformWarning {
  readonly code: "EXISTING_SOURCE_MARKER";
  readonly line: number;
  readonly column: number;
}

export interface InjectSourceMarkersInput {
  readonly code: string;
  readonly absolutePath: string;
  readonly root: string;
  readonly fileId: string;
  readonly onWarning?: (warning: TransformWarning) => void;
}

export interface InjectSourceMarkersResult {
  readonly code: string;
  readonly map: ReturnType<MagicString["generateMap"]>;
  readonly markerCount: number;
}

function findAttributeInsertionOffset(code: string, node: JSXOpeningElement): number {
  let cursor = node.end - 2;

  while (cursor >= node.start && /\s/u.test(code[cursor] ?? "")) {
    cursor -= 1;
  }

  if (code[cursor] === "/") {
    cursor -= 1;
    while (cursor >= node.start && /\s/u.test(code[cursor] ?? "")) {
      cursor -= 1;
    }
  }

  return cursor + 1;
}

function normalizeRelativePath(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

function createMarker(fileId: string, line: number, column: number): SourceMarker {
  return Object.freeze({ fileId, line, column });
}

export function injectSourceMarkers(
  input: InjectSourceMarkersInput,
): InjectSourceMarkersResult | undefined {
  const parseResult = parseSync(input.absolutePath, input.code, {
    sourceType: "module",
  });

  const parseError = parseResult.errors[0];

  if (parseError !== undefined) {
    throw new SyntaxError(parseError.message);
  }

  const magicString = new MagicString(input.code);
  const lineStarts = createLineStarts(input.code);
  let markerCount = 0;

  const visitor = new Visitor({
    JSXOpeningElement(node) {
      if (!isIntrinsicOpeningElement(node)) {
        return;
      }

      const position = getSourcePosition(lineStarts, node.start);

      if (hasSourceMarkerAttribute(node)) {
        input.onWarning?.({
          code: "EXISTING_SOURCE_MARKER",
          line: position.line,
          column: position.column,
        });
        return;
      }

      const value = formatSourceMarker(
        createMarker(input.fileId, position.line, position.column),
      );
      const insertionOffset = findAttributeInsertionOffset(input.code, node);
      magicString.appendLeft(
        insertionOffset,
        ` ${SOURCE_MARKER_ATTRIBUTE}=${JSON.stringify(value)}`,
      );
      markerCount += 1;
    },
  });

  visitor.visit(parseResult.program);

  if (markerCount === 0) {
    return undefined;
  }

  return Object.freeze({
    code: magicString.toString(),
    map: magicString.generateMap({
      hires: true,
      includeContent: true,
      source: normalizeRelativePath(input.root, input.absolutePath),
    }),
    markerCount,
  });
}
