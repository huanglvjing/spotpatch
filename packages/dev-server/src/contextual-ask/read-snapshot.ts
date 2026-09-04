import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

import type {
  AskSourceGrant,
  AskSourceGrantEntry,
  AskSourceReadResult,
  AskSourceSearchMatch,
  ContextualAskReadSnapshot,
} from "@spotpatch/agent";
import {
  CONTEXTUAL_ASK_LIMITS,
  type AskSourceConfidence,
  type SpotSelectionContext,
} from "@spotpatch/shared";
import { parseSync, Visitor } from "oxc-parser";

import type { SourceRegistry } from "../registry/source-registry.js";
import { ContextualAskError } from "./error.js";

const SOURCE_EXTENSIONS = Object.freeze([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".css",
  ".scss",
  ".sass",
  ".less",
] as const);
const PROTECTED_DIRECTORIES = new Set([
  ".git",
  ".ssh",
  ".spotpatch",
  "coverage",
  "dist",
  "node_modules",
]);
const PROTECTED_FILES = new Set([
  ".gitmodules",
  ".git-credentials",
  ".netrc",
  ".npmrc",
  ".pnpmrc",
  ".pypirc",
  ".yarnrc",
  "bun.lock",
  "bun.lockb",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);
const decoder = new TextDecoder("utf-8", { fatal: true });

interface AuthorizedSeed {
  readonly absolutePath: string;
  readonly fileId: string;
  readonly confidence: AskSourceConfidence;
  readonly targetIds: readonly string[];
  readonly sourceVersion?: string;
}

interface CapturedSource extends AskSourceGrantEntry {
  readonly absolutePath: string;
  readonly content: string;
}

export interface CapturedAskReadSnapshot {
  readonly grant: AskSourceGrant;
  readonly snapshot: ContextualAskReadSnapshot;
  dispose(): void;
  isStale(): Promise<boolean>;
  projectCitation(
    handleId: string,
    startLine: number,
    endLine: number,
  ): AskSourceGrantEntry & Readonly<{ startLine: number; endLine: number }>;
}

export interface CaptureAskReadSnapshotOptions {
  readonly root: string;
  readonly registry: SourceRegistry;
  readonly selection: SpotSelectionContext;
  readonly signal?: AbortSignal;
  readonly createHandleId?: () => string;
}

function deny(
  code: "ASK_SELECTION_REQUIRED" | "ASK_SELECTION_STALE" | "ASK_SOURCE_SCOPE_DENIED",
): never {
  throw new ContextualAskError(code);
}

function toPosixRelative(realRoot: string, absolutePath: string): string {
  const relative = path.relative(realRoot, absolutePath);
  if (
    relative.length === 0 ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return deny("ASK_SOURCE_SCOPE_DENIED");
  }
  const normalized = relative.split(path.sep).join("/");
  const segments = normalized.toLowerCase().split("/");
  const fileName = segments.at(-1) ?? "";
  if (
    segments.some((segment) => PROTECTED_DIRECTORIES.has(segment)) ||
    PROTECTED_FILES.has(fileName) ||
    fileName === ".env" ||
    fileName === ".envrc" ||
    fileName === ".dev.vars" ||
    fileName.startsWith(".env.") ||
    fileName.endsWith(".pem") ||
    fileName.endsWith(".key") ||
    fileName.endsWith(".p12") ||
    fileName.endsWith(".pfx") ||
    fileName.startsWith("id_rsa")
  ) {
    return deny("ASK_SOURCE_SCOPE_DENIED");
  }
  return normalized;
}

async function assertNoSymlinkPath(
  realRoot: string,
  absolutePath: string,
): Promise<void> {
  const relative = toPosixRelative(realRoot, absolutePath);
  let current = realRoot;
  for (const segment of relative.split("/")) {
    current = path.join(current, segment);
    const metadata = await lstat(current).catch(() => undefined);
    if (metadata === undefined || metadata.isSymbolicLink()) {
      deny("ASK_SOURCE_SCOPE_DENIED");
    }
  }
}

async function readSecureSource(
  realRoot: string,
  absolutePath: string,
): Promise<
  Readonly<{ content: string; contentHash: string; relativePath: string; size: number }>
> {
  const normalizedAbsolute = path.normalize(path.resolve(absolutePath));
  const relativePath = toPosixRelative(realRoot, normalizedAbsolute);
  await assertNoSymlinkPath(realRoot, normalizedAbsolute);
  const canonical = await realpath(normalizedAbsolute).catch(() => undefined);
  if (canonical === undefined || canonical !== normalizedAbsolute) {
    return deny("ASK_SOURCE_SCOPE_DENIED");
  }

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(normalizedAbsolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1) {
      return deny("ASK_SOURCE_SCOPE_DENIED");
    }
    if (before.size > CONTEXTUAL_ASK_LIMITS.maximumReadBytesPerFile) {
      throw new ContextualAskError("ASK_LIMIT_EXCEEDED");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      bytes.byteLength !== before.size ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytes.includes(0)
    ) {
      return deny("ASK_SOURCE_SCOPE_DENIED");
    }
    let content: string;
    try {
      content = decoder.decode(bytes);
    } catch (error: unknown) {
      throw new ContextualAskError("ASK_SOURCE_SCOPE_DENIED", { cause: error });
    }
    return Object.freeze({
      content,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      relativePath,
      size: bytes.byteLength,
    });
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function confidence(value: string): AskSourceConfidence {
  return value === "exact" || value === "probable" ? value : "approximate";
}

async function authorizeSeeds(
  selection: SpotSelectionContext,
  registry: SourceRegistry,
  root: string,
  realRoot: string,
): Promise<AuthorizedSeed[]> {
  const byPath = new Map<string, AuthorizedSeed>();
  for (const target of selection.targets) {
    let fileId = target.react.source?.fileId ?? target.source.fileId;
    let sourceVersion: string | undefined;
    if (target.react.componentSourceId !== undefined) {
      const anchor = registry.resolveDataFlowComponent(target.react.componentSourceId);
      if (anchor === undefined || target.react.sourceVersion !== anchor.sourceVersion) {
        deny("ASK_SELECTION_STALE");
      }
      fileId = anchor.fileId;
      sourceVersion = anchor.sourceVersion;
    }
    if (fileId === undefined) continue;
    const registered = registry.resolve(fileId);
    if (registered === undefined) deny("ASK_SELECTION_STALE");
    const canonical = await realpath(registered).catch(() => undefined);
    if (canonical === undefined) deny("ASK_SELECTION_STALE");
    const absolutePath = path.normalize(canonical);
    const registeredRelative = toPosixRelative(realRoot, absolutePath);
    const claimedRelative =
      target.react.source?.relativePath ?? target.source.relativePath;
    if (
      claimedRelative !== undefined &&
      claimedRelative.split("\\").join("/") !== registeredRelative
    ) {
      deny("ASK_SELECTION_STALE");
    }
    const existing = byPath.get(absolutePath);
    const targetIds = Object.freeze([
      ...(existing?.targetIds ?? []),
      ...(existing?.targetIds.includes(target.targetId) === true
        ? []
        : [target.targetId]),
    ]);
    byPath.set(
      absolutePath,
      Object.freeze({
        absolutePath,
        fileId,
        confidence: confidence(
          target.react.source?.confidence ?? target.source.confidence,
        ),
        targetIds,
        ...(sourceVersion === undefined ? {} : { sourceVersion }),
      }),
    );
  }
  for (const target of selection.targets) {
    for (const rule of target.styles.matchedRules) {
      const claimed = rule.source;
      if (
        claimed === undefined ||
        claimed.startsWith("/") ||
        claimed.includes("\\") ||
        claimed.includes("\0") ||
        claimed
          .split("/")
          .some((segment) => segment === "" || segment === "." || segment === "..")
      ) {
        continue;
      }
      const registeredPath = path.resolve(root, ...claimed.split("/"));
      const fileId = registry.findRegisteredId(registeredPath);
      if (fileId === undefined) continue;
      const canonical = await realpath(registeredPath).catch(() => undefined);
      if (canonical === undefined) continue;
      const absolutePath = path.normalize(canonical);
      toPosixRelative(realRoot, absolutePath);
      const existing = byPath.get(absolutePath);
      const targetIds = Object.freeze([
        ...(existing?.targetIds ?? []),
        ...(existing?.targetIds.includes(target.targetId) === true
          ? []
          : [target.targetId]),
      ]);
      byPath.set(
        absolutePath,
        Object.freeze({
          absolutePath,
          fileId,
          confidence: existing?.confidence ?? "probable",
          targetIds,
          ...(existing?.sourceVersion === undefined
            ? {}
            : { sourceVersion: existing.sourceVersion }),
        }),
      );
    }
  }
  if (byPath.size === 0) deny("ASK_SELECTION_REQUIRED");
  return [...byPath.values()];
}

function localSpecifiers(filePath: string, content: string): readonly string[] {
  const found = new Set<string>();
  if (/\.(?:css|scss|sass|less)$/iu.test(filePath)) {
    const pattern = /@import\s+(?:url\(\s*)?["']([^"']+)["']/gu;
    for (const match of content.matchAll(pattern)) {
      if (match[1]?.startsWith(".")) found.add(match[1]);
    }
    return [...found].sort();
  }
  try {
    const parsed = parseSync(filePath, content, { sourceType: "module" });
    if (parsed.errors.length > 0) return [];
    const add = (value: unknown): void => {
      if (typeof value === "string" && value.startsWith(".")) found.add(value);
    };
    const visitor = new Visitor({
      ImportDeclaration(node) {
        add(node.source.value);
      },
      ExportNamedDeclaration(node) {
        add(node.source?.value);
      },
      ExportAllDeclaration(node) {
        add(node.source.value);
      },
      ImportExpression(node) {
        if ("value" in node.source) add(node.source.value);
      },
    });
    visitor.visit(parsed.program);
  } catch {
    return [];
  }
  return [...found].sort();
}

function importCandidates(importer: string, specifier: string): readonly string[] {
  const base = path.resolve(path.dirname(importer), specifier);
  if (path.extname(base) !== "") return Object.freeze([base]);
  return Object.freeze([
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ]);
}

function countLines(content: string): number {
  return content.length === 0 ? 1 : content.split("\n").length;
}

function publicSourceEntry(source: CapturedSource): AskSourceGrantEntry {
  return Object.freeze({
    handleId: source.handleId,
    fileId: source.fileId,
    relativePath: source.relativePath,
    label: source.label,
    lineCount: source.lineCount,
    size: source.size,
    contentHash: source.contentHash,
    confidence: source.confidence,
    targetIds: source.targetIds,
    ...(source.sourceVersion === undefined
      ? {}
      : { sourceVersion: source.sourceVersion }),
  });
}

function assertSelectionEvidenceCurrent(
  selection: SpotSelectionContext,
  captured: readonly CapturedSource[],
): void {
  for (const target of selection.targets) {
    if (target.code === undefined) continue;
    const source = captured.find(
      (candidate) => candidate.relativePath === target.code?.relativePath,
    );
    if (source === undefined) deny("ASK_SELECTION_STALE");
    const lines = source.content.split(/\r?\n/u);
    if (target.code.endLine > lines.length) deny("ASK_SELECTION_STALE");
    const currentExcerpt = lines
      .slice(target.code.startLine - 1, target.code.endLine)
      .join("\n");
    if (currentExcerpt !== target.code.excerpt) deny("ASK_SELECTION_STALE");
  }
}

export async function captureAskReadSnapshot(
  options: CaptureAskReadSnapshotOptions,
): Promise<CapturedAskReadSnapshot> {
  options.signal?.throwIfAborted();
  const realRoot = await realpath(options.root).catch(() => undefined);
  if (realRoot === undefined) deny("ASK_SOURCE_SCOPE_DENIED");
  const seeds = await authorizeSeeds(
    options.selection,
    options.registry,
    options.root,
    realRoot,
  );
  const createHandleId =
    options.createHandleId ?? (() => randomBytes(16).toString("base64url"));
  const captured: CapturedSource[] = [];
  const capturedPaths = new Set<string>();
  const queue = [...seeds];
  let totalBytes = 0;
  let truncated = false;

  while (queue.length > 0) {
    options.signal?.throwIfAborted();
    const candidate = queue.shift();
    if (candidate === undefined || capturedPaths.has(candidate.absolutePath)) continue;
    if (captured.length >= CONTEXTUAL_ASK_LIMITS.maximumReadFiles) {
      truncated = true;
      break;
    }
    let read;
    try {
      read = await readSecureSource(realRoot, candidate.absolutePath);
      options.signal?.throwIfAborted();
    } catch (error: unknown) {
      if (captured.length < seeds.length) throw error;
      truncated = true;
      continue;
    }
    if (totalBytes + read.size > CONTEXTUAL_ASK_LIMITS.maximumReadBytesTotal) {
      if (captured.length < seeds.length)
        throw new ContextualAskError("ASK_LIMIT_EXCEEDED");
      truncated = true;
      continue;
    }
    capturedPaths.add(candidate.absolutePath);
    totalBytes += read.size;
    const entry = Object.freeze({
      handleId: createHandleId(),
      fileId: candidate.fileId,
      relativePath: read.relativePath,
      label: path.basename(read.relativePath),
      lineCount: countLines(read.content),
      size: read.size,
      contentHash: read.contentHash,
      confidence: candidate.confidence,
      targetIds: Object.freeze([...candidate.targetIds]),
      ...(candidate.sourceVersion === undefined
        ? {}
        : { sourceVersion: candidate.sourceVersion }),
      absolutePath: candidate.absolutePath,
      content: read.content,
    } satisfies CapturedSource);
    captured.push(entry);

    for (const specifier of localSpecifiers(candidate.absolutePath, read.content)) {
      options.signal?.throwIfAborted();
      for (const importPath of importCandidates(candidate.absolutePath, specifier)) {
        if (capturedPaths.has(importPath)) continue;
        const metadata = await lstat(importPath).catch(() => undefined);
        if (metadata?.isFile() !== true || metadata.isSymbolicLink()) continue;
        const fileId =
          options.registry.findRegisteredId(importPath) ??
          options.registry.register(importPath);
        queue.push(
          Object.freeze({
            absolutePath: path.normalize(importPath),
            fileId,
            confidence: "probable" as const,
            targetIds: candidate.targetIds,
          }),
        );
        break;
      }
    }
  }

  assertSelectionEvidenceCurrent(options.selection, captured);

  const sourceByHandle = new Map(captured.map((source) => [source.handleId, source]));
  const publicEntries = Object.freeze(
    captured.map((source) => publicSourceEntry(source)),
  );
  const contextHash = createHash("sha256")
    .update(
      JSON.stringify({
        selectionId: options.selection.selectionId,
        sources: publicEntries.map((source) => ({
          relativePath: source.relativePath,
          contentHash: source.contentHash,
          targetIds: source.targetIds,
          sourceVersion: source.sourceVersion ?? null,
        })),
      }),
    )
    .digest("hex");
  let disposed = false;
  const requireSource = (handleId: string): CapturedSource => {
    if (disposed) throw new ContextualAskError("ASK_RESULT_EXPIRED");
    const source = sourceByHandle.get(handleId);
    if (source === undefined) throw new ContextualAskError("ASK_SOURCE_SCOPE_DENIED");
    return source;
  };
  const snapshot: ContextualAskReadSnapshot = Object.freeze({
    manifest: () => {
      if (disposed) throw new ContextualAskError("ASK_RESULT_EXPIRED");
      return publicEntries;
    },
    read(
      handleId: string,
      range: Readonly<{ startLine?: number; endLine?: number }> = {},
    ): AskSourceReadResult {
      const source = requireSource(handleId);
      const startLine = range.startLine ?? 1;
      const endLine = range.endLine ?? source.lineCount;
      if (
        !Number.isSafeInteger(startLine) ||
        !Number.isSafeInteger(endLine) ||
        startLine < 1 ||
        endLine < startLine ||
        endLine > source.lineCount
      ) {
        throw new ContextualAskError("ASK_SOURCE_SCOPE_DENIED");
      }
      return Object.freeze({
        handleId,
        startLine,
        endLine,
        content: source.content
          .split("\n")
          .slice(startLine - 1, endLine)
          .join("\n"),
      });
    },
    search(query: string): readonly AskSourceSearchMatch[] {
      if (
        query.length === 0 ||
        query.length > CONTEXTUAL_ASK_LIMITS.maximumSearchQueryCharacters ||
        query.includes("\0")
      ) {
        throw new ContextualAskError("ASK_SOURCE_SCOPE_DENIED");
      }
      const normalized = query.toLocaleLowerCase("en-US");
      const matches: AskSourceSearchMatch[] = [];
      for (const source of captured) {
        for (const [index, line] of source.content.split("\n").entries()) {
          if (line.toLocaleLowerCase("en-US").includes(normalized)) {
            matches.push(
              Object.freeze({
                handleId: source.handleId,
                line: index + 1,
                preview: line.slice(
                  0,
                  CONTEXTUAL_ASK_LIMITS.maximumSearchPreviewCharacters,
                ),
              }),
            );
            if (matches.length >= CONTEXTUAL_ASK_LIMITS.maximumSearchResults) {
              return Object.freeze(matches);
            }
          }
        }
      }
      return Object.freeze(matches);
    },
  });

  return Object.freeze({
    grant: Object.freeze({ contextHash, truncated, sources: publicEntries }),
    snapshot,
    dispose(): void {
      disposed = true;
      sourceByHandle.clear();
      captured.splice(0, captured.length);
    },
    async isStale(): Promise<boolean> {
      for (const source of captured) {
        try {
          const current = await readSecureSource(realRoot, source.absolutePath);
          if (current.contentHash !== source.contentHash) return true;
        } catch {
          return true;
        }
      }
      return false;
    },
    projectCitation(handleId: string, startLine: number, endLine: number) {
      const source = requireSource(handleId);
      if (
        !Number.isSafeInteger(startLine) ||
        !Number.isSafeInteger(endLine) ||
        startLine < 1 ||
        endLine < startLine ||
        endLine > source.lineCount
      ) {
        throw new ContextualAskError("ASK_ANSWER_INVALID");
      }
      return Object.freeze({ ...publicSourceEntry(source), startLine, endLine });
    },
  });
}
