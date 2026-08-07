import { realpath } from "node:fs/promises";
import path from "node:path";

import {
  ERROR_CODES,
  SpotPatchError,
  type AgentJobCreateRequest,
  type MatchedStyleRule,
  type SourceRef,
  type SpotAnnotation,
} from "@spotpatch/shared";
import type { agentJobCreateRequestSchema } from "@spotpatch/shared";
import type { z } from "zod";

import type { ResolvedSpotPatchOptions } from "../options.js";
import type { SourceRegistry } from "../registry/source-registry.js";
import { readSourceContext } from "./source-context.js";
import { resolveSourceFile } from "./source-file.js";

export interface AuthorizeAgentJobRequestOptions {
  readonly options: ResolvedSpotPatchOptions;
  readonly registry: SourceRegistry;
  readonly request: z.output<typeof agentJobCreateRequestSchema>;
  readonly root: string;
}

type ParsedAgentJobRequest = AuthorizeAgentJobRequestOptions["request"];

function compactSourceRef(
  source: ParsedAgentJobRequest["annotation"]["source"],
): SourceRef {
  return Object.freeze({
    origin: source.origin,
    confidence: source.confidence,
    ...(source.fileId === undefined ? {} : { fileId: source.fileId }),
    ...(source.relativePath === undefined ? {} : { relativePath: source.relativePath }),
    ...(source.line === undefined ? {} : { line: source.line }),
    ...(source.column === undefined ? {} : { column: source.column }),
  });
}

async function authorizeSourceRef(
  source: ParsedAgentJobRequest["annotation"]["source"],
  registry: SourceRegistry,
  root: string,
): Promise<SourceRef> {
  const markerOrigin = source.origin === "jsx-host" || source.origin === "dom-ancestor";

  if (
    markerOrigin &&
    (source.fileId === undefined ||
      source.line === undefined ||
      source.column === undefined)
  ) {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
  }

  if (source.fileId === undefined) {
    if (source.origin === "none" && source.relativePath !== undefined) {
      throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
    }

    return compactSourceRef(source);
  }

  const sourcePath = await resolveSourceFile({
    fileId: source.fileId,
    registry,
    root,
  });
  const relativePath = path
    .relative(await realpath(root), sourcePath)
    .split(path.sep)
    .join("/");

  if (source.relativePath !== undefined && source.relativePath !== relativePath) {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
  }

  return Object.freeze({
    ...compactSourceRef(source),
    relativePath,
  });
}

function freezeMatchedRule(
  rule: ParsedAgentJobRequest["annotation"]["styles"]["matchedRules"][number],
): MatchedStyleRule {
  return Object.freeze({
    selector: rule.selector,
    declarations: rule.declarations,
    ...(rule.source === undefined ? {} : { source: rule.source }),
    ...(rule.media === undefined ? {} : { media: rule.media }),
  });
}

export async function authorizeAgentJobRequest(
  input: AuthorizeAgentJobRequestOptions,
): Promise<AgentJobCreateRequest> {
  const source = await authorizeSourceRef(
    input.request.annotation.source,
    input.registry,
    input.root,
  );
  const reactSourceInput = input.request.annotation.react.source;
  const reactSource =
    reactSourceInput === undefined
      ? undefined
      : await authorizeSourceRef(reactSourceInput, input.registry, input.root);
  const marker =
    source.fileId === undefined ||
    source.line === undefined ||
    source.column === undefined
      ? undefined
      : Object.freeze({
          fileId: source.fileId,
          line: source.line,
          column: source.column,
          maxLines: input.options.budget.maxCodeLines,
        });

  if (marker === undefined && input.request.annotation.code !== undefined) {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
  }

  const code =
    marker === undefined
      ? undefined
      : await readSourceContext({
          request: marker,
          registry: input.registry,
          root: input.root,
          maxCharacters: input.options.budget.codeCharacters,
          maxLines: input.options.budget.maxCodeLines,
        });

  if (
    input.request.annotation.code !== undefined &&
    input.request.annotation.code.relativePath !== code?.relativePath
  ) {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
  }

  const annotation = Object.freeze({
    schemaVersion: 1,
    id: input.request.annotation.id,
    note: input.request.annotation.note,
    page: Object.freeze({ ...input.request.annotation.page }),
    source,
    react: Object.freeze({
      supported: input.request.annotation.react.supported,
      ...(input.request.annotation.react.version === undefined
        ? {}
        : { version: input.request.annotation.react.version }),
      ...(input.request.annotation.react.componentName === undefined
        ? {}
        : { componentName: input.request.annotation.react.componentName }),
      componentStack: Object.freeze([...input.request.annotation.react.componentStack]),
      ...(reactSource === undefined ? {} : { source: reactSource }),
    }),
    element: Object.freeze({
      tagName: input.request.annotation.element.tagName,
      selector: input.request.annotation.element.selector,
      sanitizedHtml: input.request.annotation.element.sanitizedHtml,
      ...(input.request.annotation.element.textPreview === undefined
        ? {}
        : { textPreview: input.request.annotation.element.textPreview }),
      ...(input.request.annotation.element.role === undefined
        ? {}
        : { role: input.request.annotation.element.role }),
      rect: Object.freeze({ ...input.request.annotation.element.rect }),
    }),
    styles: Object.freeze({
      classNames: Object.freeze([...input.request.annotation.styles.classNames]),
      ...(input.request.annotation.styles.inlineStyle === undefined
        ? {}
        : { inlineStyle: input.request.annotation.styles.inlineStyle }),
      matchedRules: Object.freeze(
        input.request.annotation.styles.matchedRules.map(freezeMatchedRule),
      ),
      computed: Object.freeze({ ...input.request.annotation.styles.computed }),
      warnings: Object.freeze([...input.request.annotation.styles.warnings]),
    }),
    ...(code === undefined ? {} : { code: Object.freeze({ ...code }) }),
    warnings: Object.freeze([...input.request.annotation.warnings]),
    createdAt: input.request.annotation.createdAt,
  }) satisfies SpotAnnotation;

  return Object.freeze({
    annotation,
    providerProfileId: input.request.providerProfileId,
    modelProfileId: input.request.modelProfileId,
    providerDataConsent: true,
  });
}
