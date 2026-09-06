import { runSpotPatchBridgeCli } from "@spotpatch/bridge";

import {
  applyAstroIntegrationPlan,
  checkAstroIntegration,
  planAstroIntegration,
} from "./initializer.js";

function writeUsage(): void {
  process.stderr.write(
    "Usage: spotpatch-astro <init|check|bridge|connect> [options]\n" +
      "  init   Apply safe Astro integration changes; initialize managed Codex project authorization.\n" +
      "  check  Verify the Astro integration without writing files.\n" +
      "  connect codex  Start the advanced attached Codex connector.\n" +
      "  bridge Run the local external-Agent MCP, CLI, or setup commands.\n",
  );
}

function writeTrustedModeStatus(available: boolean): void {
  process.stdout.write(
    available
      ? "[spotpatch:astro] trusted fast mode is available in the page selector.\n"
      : "[spotpatch:astro] review mode is ready; trusted fast mode needs a local Astro project check.\n",
  );
}

async function runInit(arguments_: readonly string[]): Promise<number> {
  if (
    arguments_.length > 1 ||
    (arguments_.length === 1 && arguments_[0] !== "--allow-managed-codex")
  ) {
    throw new Error("Usage: init");
  }
  const plan = await planAstroIntegration();
  if (plan.changes.length === 0) {
    process.stdout.write("[spotpatch:astro] integration is already up to date.\n");
  } else {
    process.stdout.write("[spotpatch:astro] integration preview (resulting files):\n");
    for (const change of plan.changes) {
      process.stdout.write(`\n--- ${change.relativePath}\n${change.nextContent}`);
      if (!change.nextContent.endsWith("\n")) process.stdout.write("\n");
    }
    await applyAstroIntegrationPlan(plan);
    process.stdout.write(
      `[spotpatch:astro] updated ${String(plan.changes.length)} integration file(s).\n`,
    );
  }
  writeTrustedModeStatus(plan.trustedFastModeAvailable);
  return runSpotPatchBridgeCli(["init"], {
    adapter: "astro",
    cwd: plan.appRoot,
  });
}

async function runCheck(arguments_: readonly string[]): Promise<number> {
  if (arguments_.length !== 0) {
    throw new Error("SpotPatch check does not accept positional arguments.");
  }
  const result = await checkAstroIntegration();
  if (!result.ok) {
    for (const issue of result.issues) {
      process.stderr.write(`[spotpatch:astro] ${issue}\n`);
    }
    return 1;
  }
  const mode = result.trustedFastModeAvailable
    ? "trusted fast mode available"
    : "review mode";
  process.stdout.write(`[spotpatch:astro] integration verified · ${mode}.\n`);
  return 0;
}

async function main(arguments_: readonly string[]): Promise<number> {
  const [command, ...rest] = arguments_;
  if (command === "init") return runInit(rest);
  if (command === "check") return runCheck(rest);
  if (command === "bridge") {
    return runSpotPatchBridgeCli(rest, { adapter: "astro" });
  }
  if (command === "connect") {
    return runSpotPatchBridgeCli(arguments_, { adapter: "astro" });
  }
  writeUsage();
  return command === "--help" ? 0 : 1;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error: unknown) {
  process.stderr.write(
    `[spotpatch:astro] ${
      error instanceof Error ? error.message : "The command failed."
    }\n`,
  );
  process.exitCode = 1;
}
