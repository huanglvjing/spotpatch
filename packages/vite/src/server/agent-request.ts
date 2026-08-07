import { realpath } from "node:fs/promises";
import path from "node:path";

import {
  ERROR_CODES,
  SpotPatchError,
  type AgentJobCreateRequest,
  type MatchedStyleRule,
  type SourceRef,
  type SpotAnnotation,
  type SpotTargetContext,
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
type ParsedTarget = ParsedAgentJobRequest["annotation"]["targets"][number];

function compactSourceRef(source: ParsedTarget["source"]): SourceRef {
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
  source: ParsedTarget["source"],
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
  rule: ParsedTarget["styles"]["matchedRules"][number],
): MatchedStyleRule {
  return Object.freeze({
    selector: rule.selector,
    declarations: rule.declarations,
    ...(rule.source === undefined ? {} : { source: rule.source }),
    ...(rule.media === undefined ? {} : { media: rule.media }),
  });
}

function targetIdentity(target: ParsedTarget): string {
  const source = target.source;

  if (
    source.fileId !== undefined &&
    source.line !== undefined &&
    source.column !== undefined
  ) {
    return `source:${source.fileId}:${String(source.line)}:${String(source.column)}`;
  }

  return [
    "element",
    source.origin,
    source.relativePath ?? "",
    target.element.selector,
    target.element.sanitizedHtml,
  ].join("\0");
}

async function authorizeTarget(
  target: ParsedTarget,
  input: AuthorizeAgentJobRequestOptions,
): Promise<SpotTargetContext> {
  const source = await authorizeSourceRef(target.source, input.registry, input.root);
  const reactSourceInput = target.react.source;
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

  if (marker === undefined && target.code !== undefined) {
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

  if (target.code !== undefined && target.code.relativePath !== code?.relativePath) {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
  }

  return Object.freeze({
    instruction: target.instruction,
    source,
    react: Object.freeze({
      supported: target.react.supported,
      ...(target.react.version === undefined ? {} : { version: target.react.version }),
      ...(target.react.componentName === undefined
        ? {}
        : { componentName: target.react.componentName }),
      componentStack: Object.freeze([...target.react.componentStack]),
      ...(reactSource === undefined ? {} : { source: reactSource }),
    }),
    element: Object.freeze({
      tagName: target.element.tagName,
      selector: target.element.selector,
      sanitizedHtml: target.element.sanitizedHtml,
      ...(target.element.textPreview === undefined
        ? {}
        : { textPreview: target.element.textPreview }),
      ...(target.element.role === undefined ? {} : { role: target.element.role }),
      rect: Object.freeze({ ...target.element.rect }),
    }),
    styles: Object.freeze({
      classNames: Object.freeze([...target.styles.classNames]),
      ...(target.styles.inlineStyle === undefined
        ? {}
        : { inlineStyle: target.styles.inlineStyle }),
      matchedRules: Object.freeze(target.styles.matchedRules.map(freezeMatchedRule)),
      computed: Object.freeze({ ...target.styles.computed }),
      warnings: Object.freeze([...target.styles.warnings]),
    }),
    ...(code === undefined ? {} : { code: Object.freeze({ ...code }) }),
    warnings: Object.freeze([...target.warnings]),
  });
}

export async function authorizeAgentJobRequest(
  input: AuthorizeAgentJobRequestOptions,
): Promise<AgentJobCreateRequest> {
  const requestedTargets = input.request.annotation.targets;

  if (requestedTargets.length > input.options.maxTargets) {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
  }

  const identities = requestedTargets.map(targetIdentity);

  if (new Set(identities).size !== identities.length) {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
  }

  const targets = Object.freeze(
    await Promise.all(requestedTargets.map((target) => authorizeTarget(target, input))),
  );

  const annotation = Object.freeze({
    schemaVersion: 3,
    id: input.request.annotation.id,
    locale: input.request.annotation.locale,
    page: Object.freeze({ ...input.request.annotation.page }),
    targets,
    createdAt: input.request.annotation.createdAt,
  }) satisfies SpotAnnotation;

  return Object.freeze({
    annotation,
    providerProfileId: input.request.providerProfileId,
    modelProfileId: input.request.modelProfileId,
    providerDataConsent: true,
  });
}
