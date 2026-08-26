import { randomBytes } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function defaultConfigBase(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "SpotPatch");
  }
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    return path.join(
      localAppData !== undefined && path.isAbsolute(localAppData)
        ? localAppData
        : os.homedir(),
      "SpotPatch",
    );
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME;
  return path.join(
    xdgConfig !== undefined && path.isAbsolute(xdgConfig)
      ? xdgConfig
      : path.join(os.homedir(), ".config"),
    "spotpatch",
  );
}

function permissionsArePrivate(mode: number): boolean {
  return process.platform === "win32" || (mode & 0o077) === 0;
}

function isOwnedByCurrentUser(uid: number): boolean {
  const currentUid = process.getuid?.();
  return currentUid === undefined || uid === currentUid;
}

export async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = await lstat(directory);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    !permissionsArePrivate(metadata.mode) ||
    !isOwnedByCurrentUser(metadata.uid)
  ) {
    throw new Error("SpotPatch private storage directory is not private.");
  }
}

export async function resolvePrivateConfigBase(
  configuredBase?: string,
): Promise<string> {
  const configBase = path.resolve(configuredBase ?? defaultConfigBase());
  await ensurePrivateDirectory(configBase);
  return realpath(configBase);
}

export async function readPrivateJson(
  filePath: string,
  maximumBytes: number,
): Promise<unknown> {
  const metadata = await lstat(filePath).catch((error: unknown) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  });
  if (metadata === undefined) return undefined;
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    !permissionsArePrivate(metadata.mode) ||
    !isOwnedByCurrentUser(metadata.uid) ||
    metadata.size > maximumBytes
  ) {
    throw new Error("SpotPatch private storage file is not private or bounded.");
  }
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

export async function writePrivateJsonAtomic(
  filePath: string,
  temporaryPrefix: string,
  value: unknown,
): Promise<void> {
  const directory = path.dirname(filePath);
  await ensurePrivateDirectory(directory);
  const temporaryPath = path.join(
    directory,
    `.${temporaryPrefix}-${randomBytes(12).toString("hex")}.tmp`,
  );

  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, filePath);
  } catch (error: unknown) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
