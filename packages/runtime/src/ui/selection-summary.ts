import type {
  CodeContext,
  SourceConfidence,
  SpotPatchRuntimeConfig,
  StyleContext,
} from "@spotpatch/shared";

import type { ElementSourceResolution } from "../source/source-resolver.js";

export type ApiConnectionStatus = "connected" | "failed" | "loading" | "not-required";
export type CollectionStatus = "failed" | "loading" | "ready";

export interface SelectionSummaryInput {
  readonly apiStatus: ApiConnectionStatus;
  readonly code?: CodeContext;
  readonly collectionStatus: CollectionStatus;
  readonly framework: SpotPatchRuntimeConfig["framework"];
  readonly frameworkVersion: string;
  readonly resolution: ElementSourceResolution;
  readonly spotPatchVersion: string;
  readonly styles?: StyleContext;
}

export interface SelectionSummaryMessages {
  readonly available: string;
  readonly adapter: string;
  readonly api: string;
  readonly apiStatuses: Readonly<Record<ApiConnectionStatus, string>>;
  readonly boundary: string;
  readonly boundaries: Readonly<Record<CodeContext["boundary"], string>>;
  readonly browserContext: string;
  readonly collectionStatuses: Readonly<Record<CollectionStatus, string>>;
  readonly component: string;
  readonly confidence: string;
  readonly confidenceLabels: Readonly<Record<SourceConfidence, string>>;
  readonly cssWarnings: string;
  readonly origin: string;
  readonly source: string;
  readonly sourceContext: string;
  readonly stack: string;
  readonly target: (index: number, active: boolean) => string;
  readonly unavailable: string;
  readonly unsupported: string;
  readonly warning: string;
  readonly lineLocation: (line: number, column?: number) => string;
}

function sourceLocation(
  resolution: ElementSourceResolution,
  context: CodeContext | undefined,
  messages: SelectionSummaryMessages,
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
    return messages.lineLocation(line, column);
  }

  return messages.unavailable;
}

export function createSelectionSummary(
  input: SelectionSummaryInput,
  messages: SelectionSummaryMessages,
): string {
  const lines = [
    `SpotPatch: ${input.spotPatchVersion}`,
    `${{ next: "Next.js", vite: "Vite", astro: "Astro" }[input.framework]}: ${input.frameworkVersion}`,
    `${messages.source}: ${sourceLocation(input.resolution, input.code, messages)}`,
    `${messages.confidence}: ${input.resolution.source.confidence} (${messages.confidenceLabels[input.resolution.source.confidence]})`,
    `${messages.origin}: ${input.resolution.source.origin}`,
  ];

  if (input.resolution.react.componentName !== undefined) {
    lines.push(`${messages.component}: ${input.resolution.react.componentName}`);
  }

  if (input.resolution.react.componentStack.length > 0) {
    lines.push(
      `${messages.stack}: ${input.resolution.react.componentStack.join(" > ")}`,
    );
  }

  if (
    !input.resolution.react.supported &&
    input.resolution.react.version !== undefined
  ) {
    lines.push(`React ${input.resolution.react.version}: ${messages.unsupported}`);
  }

  lines.push(
    `${messages.adapter}: ${input.resolution.react.supported ? messages.available : messages.unavailable}`,
    `${messages.api}: ${messages.apiStatuses[input.apiStatus]}`,
    `${messages.browserContext}: ${messages.collectionStatuses[input.collectionStatus]}`,
  );

  if (input.code !== undefined) {
    lines.push(`${messages.boundary}: ${messages.boundaries[input.code.boundary]}`);
  } else if (input.apiStatus === "loading") {
    lines.push(`${messages.sourceContext}: ${messages.apiStatuses.loading}`);
  } else if (input.apiStatus === "failed") {
    lines.push(`${messages.sourceContext}: ${messages.unavailable}`);
  }

  if (input.styles !== undefined) {
    lines.push(`${messages.cssWarnings}: ${String(input.styles.warnings.length)}`);
    lines.push(
      ...input.styles.warnings.map((warning) => `${messages.warning}: ${warning}`),
    );
  }

  return lines.join("\n");
}
