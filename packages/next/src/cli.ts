import { createRequire } from "node:module";
import path from "node:path";

import { runNextDevelopment } from "./cli-owner.js";
import {
  applyNextIntegrationPlan,
  checkNextIntegration,
  planNextIntegration,
} from "./initializer.js";
import { inspectNextProject } from "./project.js";

function writeUsage(): void {
  process.stderr.write(
    "Usage: spotpatch-next <dev|init|check>\n" +
      "  dev [next dev options]  Start the local Next.js development server.\n" +
      "  init                    Preview and apply safe integration changes.\n" +
      "  check                   Verify the integration without writing files.\n",
  );
}

function verifyAdapterExports(appRoot: string): void {
  const resolveFromApplication = createRequire(path.join(appRoot, "package.json"));

  for (const moduleId of [
    "@spotpatch/next",
    "@spotpatch/next/client",
    "@spotpatch/next/loader",
    "@spotpatch/next/noop",
  ]) {
    try {
      resolveFromApplication.resolve(moduleId);
    } catch (error: unknown) {
      throw new Error(`SpotPatch could not resolve the required export ${moduleId}.`, {
        cause: error,
      });
    }
  }
}

async function runInit(arguments_: readonly string[]): Promise<number> {
  if (arguments_.length !== 0) {
    throw new Error("SpotPatch init does not accept positional arguments.");
  }

  const project = await inspectNextProject();
  verifyAdapterExports(project.appRoot);
  const plan = await planNextIntegration(project.appRoot);

  if (plan.changes.length === 0) {
    process.stdout.write("[spotpatch:next] integration is already up to date.\n");
    return 0;
  }

  process.stdout.write("[spotpatch:next] integration preview (resulting files):\n");

  for (const change of plan.changes) {
    process.stdout.write(`\n--- ${change.relativePath}\n${change.nextContent}`);

    if (!change.nextContent.endsWith("\n")) {
      process.stdout.write("\n");
    }
  }

  await applyNextIntegrationPlan(plan);
  process.stdout.write(
    `[spotpatch:next] updated ${String(plan.changes.length)} integration file(s).\n`,
  );
  return 0;
}

async function runCheck(arguments_: readonly string[]): Promise<number> {
  if (arguments_.length !== 0) {
    throw new Error("SpotPatch check does not accept positional arguments.");
  }

  const project = await inspectNextProject();
  verifyAdapterExports(project.appRoot);
  const result = await checkNextIntegration(project.appRoot);

  if (!result.ok) {
    for (const issue of result.issues) {
      process.stderr.write(`[spotpatch:next] ${issue}\n`);
    }

    return 1;
  }

  process.stdout.write(
    `[spotpatch:next] integration verified for Next.js ${project.nextVersion}.\n`,
  );
  return 0;
}

async function main(arguments_: readonly string[]): Promise<number> {
  const [command, ...rest] = arguments_;

  if (command === "dev") {
    const integration = await checkNextIntegration();

    if (!integration.ok) {
      throw new Error(
        "SpotPatch Next integration is incomplete; run `spotpatch-next init` first.",
      );
    }

    return runNextDevelopment(rest);
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
    `[spotpatch:next] ${
      error instanceof Error ? error.message : "The command failed."
    }\n`,
  );
  process.exitCode = 1;
}
