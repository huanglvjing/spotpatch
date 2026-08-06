import type { CodeContext, SourceConfidence, StyleContext } from "@spotpatch/shared";

import type { ElementSourceResolution } from "../source/source-resolver.js";

export type ApiConnectionStatus = "connected" | "failed" | "loading" | "not-required";
export type CollectionStatus = "failed" | "loading" | "ready";

export interface SelectionSummaryInput {
  readonly apiStatus: ApiConnectionStatus;
  readonly code?: CodeContext;
  readonly collectionStatus: CollectionStatus;
  readonly resolution: ElementSourceResolution;
  readonly spotPatchVersion: string;
  readonly styles?: StyleContext;
  readonly viteVersion: string;
}

const CONFIDENCE_LABELS = Object.freeze({
  exact: "精确元素源码",
  probable: "可能的所属组件",
  approximate: "最近业务容器",
  unknown: "未找到源码",
} satisfies Record<SourceConfidence, string>);

function sourceLocation(
  resolution: ElementSourceResolution,
  context: CodeContext | undefined,
): string {
  const path = context?.relativePath ?? resolution.source.relativePath;
  const line = resolution.source.line;
  const column = resolution.source.column;

  if (path !== undefined && line !== undefined) {
    return `${path}:${String(line)}${column === undefined ? "" : `:${String(column)}`}`;
  }

  if (path !== undefined) {
    return path;
  }

  if (line !== undefined) {
    return `line ${String(line)}${column === undefined ? "" : `, column ${String(column)}`}`;
  }

  return "Unavailable";
}

export function createSelectionSummary(input: SelectionSummaryInput): string {
  const lines = [
    `SpotPatch: ${input.spotPatchVersion}`,
    `Vite: ${input.viteVersion}`,
    `Source: ${sourceLocation(input.resolution, input.code)}`,
    `Confidence: ${input.resolution.source.confidence} (${CONFIDENCE_LABELS[input.resolution.source.confidence]})`,
    `Origin: ${input.resolution.source.origin}`,
  ];

  if (input.resolution.react.componentName !== undefined) {
    lines.push(`Component: ${input.resolution.react.componentName}`);
  }

  if (input.resolution.react.componentStack.length > 0) {
    lines.push(`Stack: ${input.resolution.react.componentStack.join(" > ")}`);
  }

  if (
    !input.resolution.react.supported &&
    input.resolution.react.version !== undefined
  ) {
    lines.push(`React ${input.resolution.react.version}: unsupported`);
  }

  lines.push(
    `React adapter: ${input.resolution.react.supported ? "available" : "unavailable"}`,
    `API: ${input.apiStatus}`,
    `Browser context: ${input.collectionStatus}`,
  );

  if (input.code !== undefined) {
    lines.push(`Boundary: ${input.code.boundary}`);
  } else if (input.apiStatus === "loading") {
    lines.push("Source context: loading…");
  } else if (input.apiStatus === "failed") {
    lines.push("Source context: unavailable");
  }

  if (input.styles !== undefined) {
    lines.push(`CSS warnings: ${String(input.styles.warnings.length)}`);
    lines.push(...input.styles.warnings.map((warning) => `Warning: ${warning}`));
  }

  return lines.join("\n");
}
