import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import {
  applyViteIntegrationPlan,
  checkViteIntegration,
  planViteIntegration,
} from "./initializer.js";
import { detectPackageManager, installLatestAdapter } from "./setup.js";

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/u;

function writeUsage(): void {
  process.stderr.write(
    "Usage: spotpatch-vite <setup|init|check>\n" +
      "  setup  Install or upgrade @spotpatch/vite@latest, then initialize it.\n" +
      "  init   Preview and apply safe Vite integration changes.\n" +
      "  check  Verify the Vite integration without writing files.\n",
  );
}

async function inspectViteProject(appRoot = process.cwd()): Promise<string> {
  const resolveFromApplication = createRequire(path.join(appRoot, "package.json"));
  let adapterEntry: string;
  let viteManifestPath: string;

  try {
    adapterEntry = resolveFromApplication.resolve("@spotpatch/vite");
    viteManifestPath = resolveFromApplication.resolve("vite/package.json");
  } catch (error: unknown) {
    throw new Error(
      "SpotPatch could not resolve the local @spotpatch/vite and Vite packages.",
      { cause: error },
    );
  }

  if (adapterEntry.length === 0) {
    throw new Error("SpotPatch could not resolve the Vite adapter export.");
  }

  const manifest = JSON.parse(await readFile(viteManifestPath, "utf8")) as unknown;
  const version =
    typeof manifest === "object" &&
    manifest !== null &&
    "version" in manifest &&
    typeof manifest.version === "string"
      ? manifest.version
      : undefined;
  const match = version === undefined ? null : VERSION_PATTERN.exec(version);
  const major = Number(match?.[1]);

  if (
    version === undefined ||
    match === null ||
    !Number.isSafeInteger(major) ||
    major < 5 ||
    major >= 8
  ) {
    throw new Error(
      `SpotPatch Vite requires Vite >=5.0.0 <8.0.0; found ${version ?? "unknown"}.`,
    );
  }

  return version;
}

function writeTrustedModeStatus(available: boolean): void {
  process.stdout.write(
    available
      ? "[spotpatch:vite] trusted fast mode is available in the page selector.\n"
      : "[spotpatch:vite] review mode is ready; trusted fast mode needs a local TypeScript project check.\n",
  );
}

async function runInit(arguments_: readonly string[]): Promise<number> {
  if (arguments_.length !== 0) {
    throw new Error("SpotPatch init does not accept positional arguments.");
  }

  await inspectViteProject();
  const plan = await planViteIntegration();

  if (plan.changes.length === 0) {
    process.stdout.write("[spotpatch:vite] integration is already up to date.\n");
    writeTrustedModeStatus(plan.trustedFastModeAvailable);
    return 0;
  }

  process.stdout.write("[spotpatch:vite] integration preview (resulting files):\n");

  for (const change of plan.changes) {
    process.stdout.write(`\n--- ${change.relativePath}\n${change.nextContent}`);

    if (!change.nextContent.endsWith("\n")) {
      process.stdout.write("\n");
    }
  }

  await applyViteIntegrationPlan(plan);
  process.stdout.write(
    `[spotpatch:vite] updated ${String(plan.changes.length)} integration file(s).\n`,
  );
  writeTrustedModeStatus(plan.trustedFastModeAvailable);

  return 0;
}

async function runSetup(arguments_: readonly string[]): Promise<number> {
  if (arguments_.length !== 0) {
    throw new Error("SpotPatch setup does not accept positional arguments.");
  }

  const packageManager = await detectPackageManager();
  await installLatestAdapter(packageManager);
  return runInit([]);
}

async function runCheck(arguments_: readonly string[]): Promise<number> {
  if (arguments_.length !== 0) {
    throw new Error("SpotPatch check does not accept positional arguments.");
  }

  const version = await inspectViteProject();
  const result = await checkViteIntegration();

  if (!result.ok) {
    for (const issue of result.issues) {
      process.stderr.write(`[spotpatch:vite] ${issue}\n`);
    }

    return 1;
  }

  const mode = result.trustedFastModeAvailable
    ? "trusted fast mode available"
    : "review mode";
  process.stdout.write(
    `[spotpatch:vite] integration verified for Vite ${version} · ${mode}.\n`,
  );
  return 0;
}

async function main(arguments_: readonly string[]): Promise<number> {
  const [command, ...rest] = arguments_;

  if (command === "setup") {
    return runSetup(rest);
  }

  if (command === "init") {
    return runInit(rest);
  }

  if (command === "check") {
    return runCheck(rest);
  }

  writeUsage();
  return 1;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error: unknown) {
  process.stderr.write(
    `[spotpatch:vite] ${
      error instanceof Error ? error.message : "The command failed."
    }\n`,
  );
  process.exitCode = 1;
}
