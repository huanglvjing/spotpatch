import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";

import type { SpotAnnotation } from "@spotpatch/shared";

import { assertAgentPathAllowed } from "../security/path-policy.js";
import { readAgentTextFile } from "../security/text-file.js";

const MAX_CONVENTION_FILES = 16;
const MAX_EXAMPLE_FILES = 4;
const MAX_FILE_CHARACTERS = 4_000;
const MAX_MANIFEST_ENTRIES = 80;

const CONVENTION_FILE_PATTERNS = Object.freeze([
  /^AGENTS\.md$/iu,
  /^CONTRIBUTING(?:\.[^.]+)?$/iu,
  /^package\.json$/u,
  /^(?:tsconfig|jsconfig)(?:\.[^.]+)?\.json$/u,
  /^\.editorconfig$/u,
  /^biome\.jsonc?$/u,
  /^eslint\.config\.[cm]?[jt]s$/u,
  /^\.eslintrc(?:\.[cm]?[jt]s|\.json|\.ya?ml)?$/u,
  /^prettier\.config\.[cm]?[jt]s$/u,
  /^\.prettierrc(?:\.[cm]?[jt]s|\.json|\.json5|\.ya?ml)?$/u,
]);

const EXAMPLE_EXCLUDE_PATTERN =
  /(?:^|\.)(?:d|generated|min|spec|test|stories)\.[^.]+$/iu;

export interface AgentProjectConventionFile {
  readonly content: string;
  readonly kind: "config" | "example" | "manifest";
  readonly path: string;
}

export interface AgentProjectConventions {
  readonly files: readonly AgentProjectConventionFile[];
}

export interface CollectProjectConventionsOptions {
  readonly annotation: SpotAnnotation;
  readonly maximumFileBytes: number;
  readonly root: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringKeys(value: unknown): readonly string[] {
  return isRecord(value)
    ? Object.keys(value).sort((left, right) => left.localeCompare(right, "en"))
    : [];
}

function summarizeManifest(content: string): string {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return content.slice(0, MAX_FILE_CHARACTERS);
  }

  if (!isRecord(parsed)) {
    return content.slice(0, MAX_FILE_CHARACTERS);
  }

  const dependencies = [
    ...stringKeys(parsed.dependencies),
    ...stringKeys(parsed.devDependencies),
    ...stringKeys(parsed.peerDependencies),
  ];
  const summary = {
    ...(typeof parsed.name === "string" ? { name: parsed.name } : {}),
    ...(typeof parsed.type === "string" ? { type: parsed.type } : {}),
    ...(typeof parsed.packageManager === "string"
      ? { packageManager: parsed.packageManager }
      : {}),
    scripts: stringKeys(parsed.scripts).slice(0, MAX_MANIFEST_ENTRIES),
    dependencies: [...new Set(dependencies)].slice(0, MAX_MANIFEST_ENTRIES),
  };
  return JSON.stringify(summary, undefined, 2);
}

function boundedContent(relativePath: string, content: string): string {
  const normalized =
    path.posix.basename(relativePath) === "package.json"
      ? summarizeManifest(content)
      : content;
  return normalized.slice(0, MAX_FILE_CHARACTERS);
}

function targetPaths(annotation: SpotAnnotation): readonly string[] {
  const paths = annotation.targets.flatMap((target) => {
    const candidate = target.code?.relativePath ?? target.source.relativePath;

    if (candidate === undefined) {
      return [];
    }

    try {
      return [assertAgentPathAllowed(candidate)];
    } catch {
      return [];
    }
  });
  return Object.freeze([...new Set(paths)]);
}

function conventionDirectories(relativePaths: readonly string[]): readonly string[] {
  const directories = new Set<string>();

  for (const relativePath of relativePaths) {
    let directory = path.posix.dirname(relativePath);

    while (directory !== ".") {
      directories.add(directory);
      const parent = path.posix.dirname(directory);

      if (parent === directory) {
        break;
      }

      directory = parent;
    }
  }

  directories.add("");
  return Object.freeze([...directories]);
}

async function readSafeDirectory(
  root: string,
  relativeDirectory: string,
): Promise<readonly Dirent[]> {
  const absolutePath =
    relativeDirectory.length === 0
      ? root
      : path.join(root, ...relativeDirectory.split("/"));
  const metadata = await lstat(absolutePath).catch(() => undefined);

  if (metadata === undefined || !metadata.isDirectory() || metadata.isSymbolicLink()) {
    return Object.freeze([]);
  }

  const canonical = await realpath(absolutePath).catch(() => undefined);

  if (canonical === undefined) {
    return Object.freeze([]);
  }

  const relative = path.relative(root, canonical);

  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return Object.freeze([]);
  }

  return Object.freeze(await readdir(canonical, { withFileTypes: true }));
}

function joinRelative(directory: string, fileName: string): string {
  return directory.length === 0 ? fileName : `${directory}/${fileName}`;
}

async function readConventionFile(
  root: string,
  relativePath: string,
  kind: AgentProjectConventionFile["kind"],
  maximumFileBytes: number,
): Promise<AgentProjectConventionFile | undefined> {
  try {
    const file = await readAgentTextFile(root, relativePath, maximumFileBytes);
    return Object.freeze({
      path: file.relativePath,
      kind,
      content: boundedContent(file.relativePath, file.content),
    });
  } catch {
    return undefined;
  }
}

async function collectConfigFiles(
  root: string,
  directories: readonly string[],
  maximumFileBytes: number,
): Promise<readonly AgentProjectConventionFile[]> {
  const candidates: string[] = [];

  for (const directory of directories) {
    const entries = await readSafeDirectory(root, directory);

    for (const entry of entries
      .filter(
        (candidate) =>
          candidate.isFile() &&
          !candidate.isSymbolicLink() &&
          CONVENTION_FILE_PATTERNS.some((pattern) => pattern.test(candidate.name)),
      )
      .sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      const relativePath = joinRelative(directory, entry.name);

      if (!candidates.includes(relativePath)) {
        candidates.push(relativePath);
      }

      if (candidates.length >= MAX_CONVENTION_FILES) {
        break;
      }
    }

    if (candidates.length >= MAX_CONVENTION_FILES) {
      break;
    }
  }

  const files = await Promise.all(
    candidates.map((relativePath) =>
      readConventionFile(
        root,
        relativePath,
        path.posix.basename(relativePath) === "package.json" ? "manifest" : "config",
        maximumFileBytes,
      ),
    ),
  );
  return Object.freeze(
    files.filter((file): file is AgentProjectConventionFile => file !== undefined),
  );
}

async function collectExampleFiles(
  root: string,
  relativePaths: readonly string[],
  maximumFileBytes: number,
): Promise<readonly AgentProjectConventionFile[]> {
  const candidates: string[] = [];
  const visitedDirectories = new Set<string>();

  for (const targetPath of relativePaths) {
    const directory = path.posix.dirname(targetPath);

    if (visitedDirectories.has(directory)) {
      continue;
    }

    visitedDirectories.add(directory);
    const extension = path.posix.extname(targetPath);
    const entries = await readSafeDirectory(root, directory === "." ? "" : directory);
    const example = entries
      .filter((entry) => {
        const relativePath = joinRelative(
          directory === "." ? "" : directory,
          entry.name,
        );
        return (
          entry.isFile() &&
          !entry.isSymbolicLink() &&
          relativePath !== targetPath &&
          path.posix.extname(entry.name) === extension &&
          !EXAMPLE_EXCLUDE_PATTERN.test(entry.name)
        );
      })
      .sort((left, right) => left.name.localeCompare(right.name, "en"))[0];

    if (example !== undefined) {
      candidates.push(joinRelative(directory === "." ? "" : directory, example.name));
    }

    if (candidates.length >= MAX_EXAMPLE_FILES) {
      break;
    }
  }

  const files = await Promise.all(
    candidates.map((relativePath) =>
      readConventionFile(root, relativePath, "example", maximumFileBytes),
    ),
  );
  return Object.freeze(
    files.filter((file): file is AgentProjectConventionFile => file !== undefined),
  );
}

export async function collectProjectConventions(
  options: CollectProjectConventionsOptions,
): Promise<AgentProjectConventions> {
  const root = await realpath(options.root);
  const paths = targetPaths(options.annotation);
  const [configs, examples] = await Promise.all([
    collectConfigFiles(root, conventionDirectories(paths), options.maximumFileBytes),
    collectExampleFiles(root, paths, options.maximumFileBytes),
  ]);

  return Object.freeze({ files: Object.freeze([...configs, ...examples]) });
}
