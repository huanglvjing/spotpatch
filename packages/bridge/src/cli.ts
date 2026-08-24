import { runSpotPatchBridgeCli } from "./cli-runner.js";

process.exitCode = await runSpotPatchBridgeCli(process.argv.slice(2));
