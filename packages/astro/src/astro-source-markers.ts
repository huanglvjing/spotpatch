import path from "node:path";

import { parse } from "@astrojs/compiler-rs";
import { formatSourceMarker, SOURCE_MARKER_ATTRIBUTE } from "@spotpatch/shared";
import { MagicString } from "magic-string";
import {
  collectDataFlowInstrumentation,
  createDataFlowSourceVersion,
  type CollectedDataFlowInstrumentation,
} from "@spotpatch/compiler";

import { projectAstroSource } from "./source-projections.js";

interface AstroMarkerInput {
  readonly code: string;
  readonly absolutePath: string;
  readonly root: string;
  readonly fileId: string;
  readonly onExistingMarker?: () => void;
  readonly dataFlow?: Readonly<{ helperModule: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function injectAstroSourceMarkers(input: AstroMarkerInput):
  | {
      readonly code: string;
      readonly map: ReturnType<MagicString["generateMap"]>;
      readonly markerCount: number;
      readonly dataFlow?: CollectedDataFlowInstrumentation;
    }
  | undefined {
  const parsed = parse(input.code);
  if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new SyntaxError("Astro source parsing failed.");
  }
  const edited = new MagicString(input.code);
  let markerCount = 0;
  const lineStarts = [0];
  for (let i = 0; i < input.code.length; i += 1)
    if (input.code[i] === "\n") lineStarts.push(i + 1);

  function mark(node: Record<string, unknown>): void {
    const name = node.name;
    if (
      !isRecord(name) ||
      name.type !== "JSXIdentifier" ||
      typeof name.name !== "string" ||
      !/^[a-z]/u.test(name.name)
    )
      return;
    if (["script", "style", "slot"].includes(name.name)) return;
    if (
      !Array.isArray(node.attributes) ||
      typeof node.start !== "number" ||
      !Number.isSafeInteger(node.start) ||
      typeof name.end !== "number" ||
      !Number.isSafeInteger(name.end) ||
      node.start < 0 ||
      input.code.slice(node.start, name.end) !== `<${name.name}`
    ) {
      throw new SyntaxError("Astro source position could not be verified.");
    }
    if (
      node.attributes.some(
        (attribute: unknown) =>
          isRecord(attribute) &&
          attribute.type === "JSXAttribute" &&
          isRecord(attribute.name) &&
          attribute.name.name === SOURCE_MARKER_ATTRIBUTE,
      )
    ) {
      input.onExistingMarker?.();
      return;
    }
    let low = 0;
    let high = lineStarts.length;
    while (low + 1 < high) {
      const mid = Math.floor((low + high) / 2);
      if ((lineStarts[mid] ?? 0) <= node.start) low = mid;
      else high = mid;
    }
    const value = formatSourceMarker({
      fileId: input.fileId,
      line: low + 1,
      column: node.start - (lineStarts[low] ?? 0) + 1,
      kind: "astro",
    });
    // Astro renders spreads as HTML. The first duplicate attribute wins in the
    // browser, unlike JSX object-spread precedence; keep our marker first.
    edited.appendLeft(name.end, ` ${SOURCE_MARKER_ATTRIBUTE}=${JSON.stringify(value)}`);
    markerCount += 1;
  }

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;
    if (
      value.type === "AstroFrontmatter" ||
      value.type === "AstroScript" ||
      value.type === "AstroStyle"
    )
      return;
    if (
      value.type === "JSXElement" &&
      isRecord(value.openingElement) &&
      isRecord(value.openingElement.name) &&
      ["script", "style"].includes(String(value.openingElement.name.name))
    )
      return;
    if (value.type === "JSXOpeningElement") mark(value);
    for (const child of Object.values(value)) visit(child);
  }
  visit(parsed.ast);
  let dataFlow: CollectedDataFlowInstrumentation | undefined;
  if (input.dataFlow !== undefined) {
    const { helperModule } = input.dataFlow;
    const sourceVersion = createDataFlowSourceVersion(input.code);
    const scopes = projectAstroSource(input.absolutePath, input.code) ?? [];
    const collected = scopes
      .filter((scope) => scope.instrument)
      .map((scope) =>
        collectDataFlowInstrumentation({
          absolutePath: input.absolutePath,
          root: input.root,
          code: scope.code,
          helperModule,
          moduleScope: { sourceVersion, importOffset: scope.start },
        }),
      );
    dataFlow = Object.freeze({
      sourceVersion,
      anchors: Object.freeze(collected.flatMap((scope) => scope.anchors)),
      diagnostics: Object.freeze(collected.flatMap((scope) => scope.diagnostics)),
      edits: Object.freeze(collected.flatMap((scope) => scope.edits)),
    });
    for (const edit of dataFlow.edits) {
      if (edit.placement === "left") edited.appendLeft(edit.offset, edit.content);
      else edited.prependRight(edit.offset, edit.content);
    }
  }
  if (markerCount === 0 && (dataFlow?.edits.length ?? 0) === 0) return undefined;
  return Object.freeze({
    code: edited.toString(),
    map: edited.generateMap({
      hires: true,
      includeContent: true,
      source: path.relative(input.root, input.absolutePath).split(path.sep).join("/"),
    }),
    markerCount,
    ...(dataFlow === undefined ? {} : { dataFlow }),
  });
}
