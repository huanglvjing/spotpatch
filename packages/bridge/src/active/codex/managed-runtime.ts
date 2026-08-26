import { randomBytes } from "node:crypto";
import { lstat, readlink, realpath, rename, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ensurePrivateDirectory,
  resolvePrivateConfigBase,
} from "../../supervisor/private-store.js";

const AUTH_FILE_NAME = "auth.json";
const MAXIMUM_AUTH_FILE_BYTES = 1024 * 1024;
const RUNTIME_KEY_PATTERN = /^[a-f0-9]{64}$/u;

export interface ManagedCodexRuntimeOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly excludedRoot?: string;
  readonly runtimeBase?: string;
  readonly runtimeKey: string;
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function permissionsArePrivate(mode: number): boolean {
  return process.platform === "win32" || (mode & 0o077) === 0;
}

function isOwnedByCurrentUser(uid: number): boolean {
  const currentUid = process.getuid?.();
  return currentUid === undefined || uid === currentUid;
}

function validateRuntimeKey(runtimeKey: string): void {
  if (!RUNTIME_KEY_PATTERN.test(runtimeKey)) {
    throw new TypeError("The managed Codex runtime key is invalid.");
  }
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..")
  );
}

async function canonicalProspectivePath(candidate: string): Promise<string> {
  let existing = path.resolve(candidate);
  const missingSegments: string[] = [];
  for (;;) {
    const metadata = await lstat(existing).catch((error: unknown) => {
      if (isMissingPathError(error)) return undefined;
      throw error;
    });
    if (metadata !== undefined) {
      return path.join(await realpath(existing), ...missingSegments.reverse());
    }
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error("No existing path ancestor was found.");
    missingSegments.push(path.basename(existing));
    existing = parent;
  }
}

async function resolveSourceAuthFile(
  environment: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  const configuredHome = environment.CODEX_HOME;
  const sourceHome = configuredHome ?? path.join(os.homedir(), ".codex");
  if (!path.isAbsolute(sourceHome)) {
    throw new Error("CODEX_HOME must be absolute for managed isolation.");
  }

  const authFile = path.join(sourceHome, AUTH_FILE_NAME);
  const metadata = await lstat(authFile).catch((error: unknown) => {
    if (isMissingPathError(error)) return undefined;
    throw error;
  });
  if (metadata === undefined) return undefined;

  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size > MAXIMUM_AUTH_FILE_BYTES ||
    !permissionsArePrivate(metadata.mode) ||
    !isOwnedByCurrentUser(metadata.uid)
  ) {
    throw new Error("The Codex authentication file is not private and bounded.");
  }
  return realpath(authFile);
}

async function replaceAuthLink(
  runtimeHome: string,
  sourceAuthFile: string | undefined,
): Promise<void> {
  const authLink = path.join(runtimeHome, AUTH_FILE_NAME);
  const existing = await lstat(authLink).catch((error: unknown) => {
    if (isMissingPathError(error)) return undefined;
    throw error;
  });

  if (sourceAuthFile === undefined) {
    if (existing === undefined) return;
    if (!existing.isSymbolicLink() || !isOwnedByCurrentUser(existing.uid)) {
      throw new Error("The managed Codex authentication entry is not owned.");
    }
    await rm(authLink);
    return;
  }

  if (existing !== undefined) {
    if (!existing.isSymbolicLink() || !isOwnedByCurrentUser(existing.uid)) {
      throw new Error("The managed Codex authentication entry is not owned.");
    }
    if ((await readlink(authLink)) === sourceAuthFile) return;
  }

  const temporaryLink = path.join(
    runtimeHome,
    `.auth-${randomBytes(12).toString("hex")}.tmp`,
  );
  try {
    await symlink(sourceAuthFile, temporaryLink, "file");
    await rename(temporaryLink, authLink);
  } finally {
    await rm(temporaryLink, { force: true }).catch(() => undefined);
  }
}

async function resolveRuntimeHome(
  options: ManagedCodexRuntimeOptions,
): Promise<string> {
  validateRuntimeKey(options.runtimeKey);
  if (
    options.runtimeBase !== undefined &&
    options.excludedRoot !== undefined &&
    isWithin(
      await realpath(options.excludedRoot),
      await canonicalProspectivePath(options.runtimeBase),
    )
  ) {
    throw new Error("The managed Codex runtime cannot be stored in the project.");
  }
  const configBase = await resolvePrivateConfigBase(options.runtimeBase);
  const configuredRuntimeRoot = path.join(
    configBase,
    "external-agent-runtime",
    "codex",
  );
  if (
    options.excludedRoot !== undefined &&
    isWithin(await realpath(options.excludedRoot), configuredRuntimeRoot)
  ) {
    throw new Error("The managed Codex runtime cannot be stored in the project.");
  }
  await ensurePrivateDirectory(configuredRuntimeRoot);
  const runtimeRoot = await realpath(configuredRuntimeRoot);
  const runtimeHome = path.join(runtimeRoot, options.runtimeKey);
  await ensurePrivateDirectory(runtimeHome);
  return realpath(runtimeHome);
}

export async function prepareManagedCodexRuntimeHome(
  options: ManagedCodexRuntimeOptions,
): Promise<string> {
  const sourceAuthFile = await resolveSourceAuthFile(
    options.environment ?? process.env,
  );
  const runtimeHome = await resolveRuntimeHome(options);
  await replaceAuthLink(runtimeHome, sourceAuthFile);
  return runtimeHome;
}

export async function removeManagedCodexRuntimeHome(
  options: Omit<ManagedCodexRuntimeOptions, "environment" | "excludedRoot">,
): Promise<void> {
  validateRuntimeKey(options.runtimeKey);
  const configBase = await resolvePrivateConfigBase(options.runtimeBase);
  const configuredRuntimeRoot = path.join(
    configBase,
    "external-agent-runtime",
    "codex",
  );
  const runtimeRootMetadata = await lstat(configuredRuntimeRoot).catch(
    (error: unknown) => {
      if (isMissingPathError(error)) return undefined;
      throw error;
    },
  );
  if (runtimeRootMetadata === undefined) return;
  if (
    !runtimeRootMetadata.isDirectory() ||
    runtimeRootMetadata.isSymbolicLink() ||
    !permissionsArePrivate(runtimeRootMetadata.mode) ||
    !isOwnedByCurrentUser(runtimeRootMetadata.uid)
  ) {
    throw new Error("The managed Codex runtime root is not private.");
  }
  const runtimeRoot = await realpath(configuredRuntimeRoot);
  const runtimeHome = path.join(runtimeRoot, options.runtimeKey);
  const runtimeMetadata = await lstat(runtimeHome).catch((error: unknown) => {
    if (isMissingPathError(error)) return undefined;
    throw error;
  });
  if (runtimeMetadata === undefined) return;
  if (
    !runtimeMetadata.isDirectory() ||
    runtimeMetadata.isSymbolicLink() ||
    !permissionsArePrivate(runtimeMetadata.mode) ||
    !isOwnedByCurrentUser(runtimeMetadata.uid)
  ) {
    throw new Error("The managed Codex runtime is not owned.");
  }
  await rm(runtimeHome, { recursive: true, force: true });
}
