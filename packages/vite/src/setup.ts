import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

export type SupportedPackageManager = "npm" | "pnpm";

interface ApplicationManifest {
  readonly packageManager?: unknown;
}

export interface InstallCommand {
  readonly arguments: readonly string[];
  readonly executable: string;
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath);
    return true;
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return false;
    }

    throw error;
  }
}

export async function detectPackageManager(
  appRoot = process.cwd(),
  userAgent = process.env.npm_config_user_agent ?? "",
): Promise<SupportedPackageManager> {
  const manifestPath = path.join(appRoot, "package.json");
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as ApplicationManifest;
  const declared = manifest.packageManager;

  if (typeof declared === "string") {
    const name = declared.split("@", 1)[0];

    if (name === "pnpm" || name === "npm") {
      return name;
    }

    throw new Error(
      `SpotPatch setup supports npm and pnpm projects; package.json declares ${declared}.`,
    );
  }

  const [hasPnpmLock, hasNpmLock] = await Promise.all([
    pathExists(path.join(appRoot, "pnpm-lock.yaml")),
    pathExists(path.join(appRoot, "package-lock.json")),
  ]);

  if (hasPnpmLock !== hasNpmLock) {
    return hasPnpmLock ? "pnpm" : "npm";
  }

  if (hasPnpmLock && hasNpmLock) {
    throw new Error(
      "SpotPatch setup found both pnpm-lock.yaml and package-lock.json; remove the stale lockfile or run installation and init separately.",
    );
  }

  if (userAgent.startsWith("pnpm/")) {
    return "pnpm";
  }

  if (userAgent.startsWith("npm/")) {
    return "npm";
  }

  throw new Error(
    "SpotPatch setup could not determine npm or pnpm; run installation and init separately.",
  );
}

export function createInstallCommand(
  packageManager: SupportedPackageManager,
  platform = process.platform,
): InstallCommand {
  return Object.freeze({
    executable: platform === "win32" ? `${packageManager}.cmd` : packageManager,
    arguments: Object.freeze(
      packageManager === "pnpm"
        ? ["add", "-D", "@spotpatch/vite@latest"]
        : ["install", "--save-dev", "@spotpatch/vite@latest"],
    ),
  });
}

export async function installLatestAdapter(
  packageManager: SupportedPackageManager,
  appRoot = process.cwd(),
): Promise<void> {
  const command = createInstallCommand(packageManager);

  process.stdout.write(
    `[spotpatch:vite] installing @spotpatch/vite@latest with ${packageManager}...\n`,
  );

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.executable, command.arguments, {
      cwd: appRoot,
      env: process.env,
      shell: false,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `SpotPatch setup installation failed (${signal ?? `exit ${String(code)}`}).`,
        ),
      );
    });
  });
}
