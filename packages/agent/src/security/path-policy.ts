import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import { ERROR_CODES, SpotPatchError } from "@spotpatch/shared";

const PROTECTED_DIRECTORIES = new Set([
  ".git",
  ".ssh",
  ".spotpatch",
  "coverage",
  "dist",
  "node_modules",
]);

const PROTECTED_FILE_NAMES = new Set([
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

function deny(): never {
  throw new SpotPatchError(ERROR_CODES.TOOL_PATH_DENIED);
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) < 32) {
      return true;
    }
  }

  return false;
}

export function normalizeAgentPath(value: string): string {
  if (
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.includes("%") ||
    value.includes(":") ||
    path.posix.isAbsolute(value)
  ) {
    return deny();
  }

  const segments = value.split("/");

  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        hasControlCharacter(segment),
    )
  ) {
    return deny();
  }

  const normalized = path.posix.normalize(value);

  if (normalized !== value || normalized.startsWith("../")) {
    return deny();
  }

  return normalized;
}

export function assertAgentPathAllowed(value: string): string {
  const normalized = normalizeAgentPath(value);
  const segments = normalized.toLowerCase().split("/");
  const fileName = segments.at(-1) ?? "";

  if (
    segments.some((segment) => PROTECTED_DIRECTORIES.has(segment)) ||
    PROTECTED_FILE_NAMES.has(fileName) ||
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
    return deny();
  }

  return normalized;
}

function assertPathInsideRoot(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);

  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    deny();
  }
}

export async function resolveExistingAgentPath(
  root: string,
  relativePath: string,
): Promise<string> {
  const normalized = assertAgentPathAllowed(relativePath);
  const [realRoot, candidateStats] = await Promise.all([
    realpath(root),
    lstat(path.resolve(root, ...normalized.split("/"))).catch(() => undefined),
  ]);

  if (
    candidateStats === undefined ||
    !candidateStats.isFile() ||
    candidateStats.isSymbolicLink()
  ) {
    return deny();
  }

  const candidate = await realpath(path.resolve(realRoot, ...normalized.split("/")));
  assertPathInsideRoot(realRoot, candidate);
  return candidate;
}

export async function resolveWritableAgentPath(
  root: string,
  relativePath: string,
): Promise<string> {
  const normalized = assertAgentPathAllowed(relativePath);
  const realRoot = await realpath(root);
  const candidate = path.resolve(realRoot, ...normalized.split("/"));
  assertPathInsideRoot(realRoot, candidate);
  let current = realRoot;

  for (const segment of normalized.split("/").slice(0, -1)) {
    current = path.join(current, segment);
    const stats = await lstat(current).catch(() => undefined);

    if (stats === undefined) {
      break;
    }

    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      return deny();
    }
  }

  const existingStats = await lstat(candidate).catch(() => undefined);

  if (
    existingStats !== undefined &&
    (!existingStats.isFile() || existingStats.isSymbolicLink())
  ) {
    return deny();
  }

  return candidate;
}

export function isRestartSensitivePath(relativePath: string): boolean {
  const normalized = relativePath.toLowerCase();
  const fileName = normalized.split("/").at(-1) ?? "";

  return (
    fileName === "package.json" ||
    fileName.startsWith("vite.config.") ||
    fileName.startsWith("tsconfig") ||
    fileName.startsWith("tailwind.config.") ||
    fileName.startsWith("postcss.config.")
  );
}
