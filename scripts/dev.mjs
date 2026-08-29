import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BUILD_ARGUMENTS = Object.freeze(["--filter", "@spotpatch/vite...", "build"]);
const WATCH_ARGUMENTS = Object.freeze([
  "--parallel",
  "--stream",
  "--filter",
  "@spotpatch/vite...",
  "--if-present",
  "dev",
]);
const PLAYGROUND_ARGUMENTS = Object.freeze([
  "--filter",
  "@spotpatch/playground",
  "dev",
]);
const SIGNAL_EXIT_CODES = Object.freeze({
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
});
const SHUTDOWN_SIGNALS = Object.freeze(Object.keys(SIGNAL_EXIT_CODES));
const FORCE_SHUTDOWN_DELAY_MS = 5_000;

function exitOutcome(child) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    child.once("error", (error) => {
      finish({ code: 1, error, signal: null });
    });
    child.once("close", (code, signal) => {
      finish({ code, signal });
    });
  });
}

function normalizedExitCode(outcome, zeroIsFailure = false) {
  if (outcome.code === 0) return zeroIsFailure ? 1 : 0;
  if (typeof outcome.code === "number") return outcome.code;
  return outcome.signal === "SIGINT" ? 130 : 1;
}

function reportSpawnError(name, outcome) {
  if (!("error" in outcome)) return;
  const detail =
    outcome.error instanceof Error ? outcome.error.message : "unknown error";
  process.stderr.write(`SpotPatch could not start ${name}: ${detail}\n`);
}

async function main() {
  const pnpmCli = process.env.npm_execpath;
  if (pnpmCli === undefined || pnpmCli.length === 0) {
    process.stderr.write("SpotPatch development must be started with `pnpm dev`.\n");
    return 1;
  }

  const activeChildren = new Set();
  let requestedSignal;
  let forceShutdownTimer;

  const startPnpm = (arguments_, stdio) => {
    const child = spawn(process.execPath, [pnpmCli, ...arguments_], {
      cwd: REPOSITORY_ROOT,
      env: process.env,
      shell: false,
      stdio,
    });
    activeChildren.add(child);
    const outcome = exitOutcome(child).finally(() => {
      activeChildren.delete(child);
    });
    return Object.freeze({ child, outcome });
  };

  const signalChildren = (signal) => {
    for (const child of activeChildren) {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    }
  };

  const stopChildren = (signal) => {
    signalChildren(signal);
    if (activeChildren.size === 0 || forceShutdownTimer !== undefined) return;
    forceShutdownTimer = setTimeout(() => {
      signalChildren("SIGKILL");
    }, FORCE_SHUTDOWN_DELAY_MS);
    forceShutdownTimer.unref();
  };

  const handleSignal = (signal) => {
    if (requestedSignal !== undefined) return;
    requestedSignal = signal;
    stopChildren(signal);
  };
  const signalHandlers = new Map(
    SHUTDOWN_SIGNALS.map((signal) => [signal, () => handleSignal(signal)]),
  );

  for (const [signal, handler] of signalHandlers) {
    process.on(signal, handler);
  }

  try {
    const build = startPnpm(BUILD_ARGUMENTS, "inherit");
    const buildOutcome = await build.outcome;
    reportSpawnError("the initial workspace build", buildOutcome);
    if (requestedSignal !== undefined) return SIGNAL_EXIT_CODES[requestedSignal];
    if (buildOutcome.code !== 0) return normalizedExitCode(buildOutcome);

    // Package watchers never need terminal input. Keeping stdin closed reserves the
    // interactive terminal exclusively for the playground's managed-Agent consent.
    const watchers = startPnpm(WATCH_ARGUMENTS, ["ignore", "inherit", "inherit"]);
    const playground = startPnpm(PLAYGROUND_ARGUMENTS, "inherit");
    const first = await Promise.race([
      watchers.outcome.then((outcome) => ({ name: "package watchers", outcome })),
      playground.outcome.then((outcome) => ({ name: "playground", outcome })),
    ]);

    reportSpawnError(first.name, first.outcome);
    stopChildren(requestedSignal ?? "SIGTERM");
    await Promise.all([watchers.outcome, playground.outcome]);

    if (requestedSignal !== undefined) return SIGNAL_EXIT_CODES[requestedSignal];
    return normalizedExitCode(first.outcome, first.name === "package watchers");
  } finally {
    if (activeChildren.size > 0) {
      stopChildren(requestedSignal ?? "SIGTERM");
    }
    if (activeChildren.size === 0 && forceShutdownTimer !== undefined) {
      clearTimeout(forceShutdownTimer);
    }
    for (const [signal, handler] of signalHandlers) {
      process.off(signal, handler);
    }
  }
}

process.exitCode = await main();
