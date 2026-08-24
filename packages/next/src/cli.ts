import { createRequire } from "node:module";
import path from "node:path";

import { runSpotPatchBridgeCli } from "@spotpatch/bridge";

import { runNextDevelopment } from "./cli-owner.js";
import {
  applyNextIntegrationPlan,
  checkNextIntegration,
  planNextIntegration,
} from "./initializer.js";
import { inspectNextProject } from "./project.js";

function writeUsage(): void {
  process.stderr.write(
    "Usage: spotpatch-next <dev|init|check|connect|bridge>\n" +
      "  dev [next dev options]  Start the local Next.js development server.\n" +
      "  init                    Preview and apply safe integration changes.\n" +
      "  check                   Verify the integration without writing files.\n" +
      "  connect codex           Start the zero-setup Codex Agent connector.\n" +
      "  bridge                  Run external-Agent MCP, CLI, or setup commands.\n",
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

function writeTrustedModeStatus(available: boolean): void {
  process.stdout.write(
    available
      ? "[spotpatch:next] trusted fast mode is available in the page selector.\n"
      : "[spotpatch:next] review mode is ready; trusted fast mode needs a local TypeScript project check.\n",
  );
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
    writeTrustedModeStatus(plan.trustedFastModeAvailable);
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
  writeTrustedModeStatus(plan.trustedFastModeAvailable);
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

  const mode = result.trustedFastModeAvailable
    ? "trusted fast mode available"
    : "review mode";
  process.stdout.write(
    `[spotpatch:next] integration verified for Next.js ${project.nextVersion} · ${mode}.\n`,
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

  if (command === "bridge") {
    return runSpotPatchBridgeCli(rest, { adapter: "next" });
  }

  if (command === "connect") {
    return runSpotPatchBridgeCli(arguments_, { adapter: "next" });
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
