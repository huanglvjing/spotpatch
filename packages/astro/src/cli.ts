import { runSpotPatchBridgeCli } from "@spotpatch/bridge";

const [command, ...args] = process.argv.slice(2);
if (command === "bridge" || command === "connect" || command === "init") {
  process.exitCode = await runSpotPatchBridgeCli(
    command === "bridge" ? args : [command, ...args],
    { adapter: "astro" },
  );
} else {
  process.stderr.write(
    "Usage: spotpatch-astro <init|bridge|connect> [options]\nInstall the integration with astro add @spotpatch/astro.\nThen run init to authorize managed Codex for this project.\n",
  );
  process.exitCode = command === "--help" ? 0 : 1;
}
