import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";

import { serializeResolvedSpotPatchOptions } from "@spotpatch/dev-server";
import type { SpotPatchNextBundler } from "@spotpatch/shared";

import { parseNextDevArguments } from "./cli-args.js";
import {
  NEXT_ENVIRONMENT_KEYS,
  NEXT_IPC_PROTOCOL_VERSION,
} from "./internal/constants.js";
import {
  parseNextConfigureMessage,
  type NextConfigureAck,
  type ParsedNextConfigureMessage,
} from "./internal/ipc.js";
import { inspectNextProject } from "./project.js";
import { createNextSidecar, type NextSidecar } from "./sidecar.js";

const CONFIGURATION_STARTUP_TIMEOUT_MS = 60_000;
const FORCED_TERMINATION_TIMEOUT_MS = 5_000;
const MAX_CONFIGURATION_REQUESTS = 32;
const ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;

interface ChildResult {
  readonly code: number | null;
  readonly error: boolean;
  readonly signal: NodeJS.Signals | null;
}

interface Correlation {
  readonly nonce: string;
  readonly requestId: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultBundler(nextVersion: string): SpotPatchNextBundler {
  return Number(nextVersion.split(".", 1)[0]) >= 16 ? "turbopack" : "webpack";
}

function signalExitCode(signal: NodeJS.Signals | null): number {
  return signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1;
}

function sortedRecord(
  value: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

function configurationSignature(message: ParsedNextConfigureMessage): string {
  return JSON.stringify({
    appRoot: message.appRoot,
    credentials: sortedRecord(message.credentials),
    options: serializeResolvedSpotPatchOptions(message.options),
  });
}

function readCorrelation(value: unknown, nonce: string): Correlation | undefined {
  if (
    !isRecord(value) ||
    typeof value.nonce !== "string" ||
    value.nonce !== nonce ||
    !ID_PATTERN.test(value.nonce) ||
    typeof value.requestId !== "string" ||
    !ID_PATTERN.test(value.requestId)
  ) {
    return undefined;
  }

  return Object.freeze({ nonce, requestId: value.requestId });
}

function createAck(
  correlation: Correlation,
  result:
    | Readonly<{ ok: true }>
    | Readonly<{
        code: "CONFIGURATION_CONFLICT" | "CONFIGURATION_FAILED" | "INVALID_IPC";
        ok: false;
      }>,
): NextConfigureAck {
  return Object.freeze({
    ...result,
    nonce: correlation.nonce,
    protocolVersion: NEXT_IPC_PROTOCOL_VERSION,
    requestId: correlation.requestId,
    type: "spotpatch:next:configure-ack",
  });
}

function waitForChild(child: ChildProcess): Promise<ChildResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ChildResult): void => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(Object.freeze(result));
    };

    child.once("error", () => {
      finish({ code: null, error: true, signal: null });
    });
    child.once("exit", (code, signal) => {
      finish({ code, error: false, signal });
    });
  });
}

async function closeSidecar(sidecar: NextSidecar): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      sidecar.close(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error("SpotPatch Sidecar shutdown timed out."));
        }, FORCED_TERMINATION_TIMEOUT_MS);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export async function runNextDevelopment(
  arguments_: readonly string[],
): Promise<number> {
  const project = await inspectNextProject();
  const dev = parseNextDevArguments(
    arguments_,
    process.env,
    defaultBundler(project.nextVersion),
  );
  const launchNonce = randomBytes(24).toString("base64url");
  const configurationSecret = randomBytes(32).toString("base64url");
  const internalSecret = randomBytes(32).toString("base64url");
  const registryEpoch = randomBytes(24).toString("base64url");
  const lifecycle: {
    child?: ChildProcess;
    sidecar?: NextSidecar;
    sidecarFailed: boolean;
  } = {
    sidecarFailed: false,
  };
  const seenRequestIds = new Set<string>();
  let acceptedSignature: string | undefined;
  let activationFailed = false;
  let configured = false;
  let failureCode: string | undefined;
  let configurationQueue: Promise<void> = Promise.resolve();

  const handleConfiguration = async (
    value: unknown,
  ): Promise<NextConfigureAck | undefined> => {
    const correlation = readCorrelation(value, launchNonce);
    let message: ParsedNextConfigureMessage;

    try {
      message = parseNextConfigureMessage(value);
    } catch {
      failureCode = "INVALID_IPC";

      if (correlation !== undefined) {
        lifecycle.child?.kill("SIGTERM");
        return createAck(correlation, { code: "INVALID_IPC", ok: false });
      }

      lifecycle.child?.kill("SIGTERM");
      return undefined;
    }

    if (
      message.nonce !== launchNonce ||
      message.appRoot !== project.appRoot ||
      message.options.allowLan ||
      seenRequestIds.has(message.requestId) ||
      seenRequestIds.size >= MAX_CONFIGURATION_REQUESTS
    ) {
      failureCode = "INVALID_IPC";
      lifecycle.child?.kill("SIGTERM");
      return createAck(message, { code: "INVALID_IPC", ok: false });
    }

    seenRequestIds.add(message.requestId);
    const signature = configurationSignature(message);

    if (acceptedSignature !== undefined && acceptedSignature !== signature) {
      failureCode = "CONFIGURATION_CONFLICT";
      return createAck(message, {
        code: "CONFIGURATION_CONFLICT",
        ok: false,
      });
    }

    if (activationFailed) {
      return createAck(message, { code: "CONFIGURATION_FAILED", ok: false });
    }

    if (acceptedSignature === undefined) {
      acceptedSignature = signature;
      const sidecar = lifecycle.sidecar;

      if (sidecar === undefined) {
        activationFailed = true;
        failureCode = "CONFIGURATION_FAILED";
        return createAck(message, { code: "CONFIGURATION_FAILED", ok: false });
      }

      try {
        await sidecar.activate({
          appRoot: project.appRoot,
          bundler: dev.bundler,
          credentials: message.credentials,
          internalSecret,
          nextVersion: project.nextVersion,
          options: message.options,
          projectRoot: project.projectRoot,
          publicOrigin: dev.publicOrigin,
          registryEpoch,
          routerKind: project.routerKind,
        });
      } catch {
        activationFailed = true;
        failureCode = "CONFIGURATION_FAILED";
        return createAck(message, { code: "CONFIGURATION_FAILED", ok: false });
      }
    }

    if (!configured) {
      configured = true;
      clearTimeout(startupTimer);

      process.stdout.write(
        `[spotpatch:next] ready for Next.js ${project.nextVersion} (${dev.bundler}) at ${dev.publicOrigin}\n`,
      );
    }

    return createAck(message, { ok: true });
  };
  const enqueueConfiguration = (
    value: unknown,
  ): Promise<NextConfigureAck | undefined> => {
    const result = configurationQueue.then(() => handleConfiguration(value));
    configurationQueue = result.then(
      () => undefined,
      () => undefined,
    );

    return result.catch(() => {
      failureCode = "CONFIGURATION_FAILURE";
      lifecycle.child?.kill("SIGTERM");
      return undefined;
    });
  };
  const sidecar = await createNextSidecar({
    configuration: {
      configurationSecret,
      onConfiguration: enqueueConfiguration,
    },
    onFatalError() {
      lifecycle.sidecarFailed = true;
      lifecycle.child?.kill("SIGTERM");
    },
  });
  lifecycle.sidecar = sidecar;
  const childEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    [NEXT_ENVIRONMENT_KEYS.appRoot]: project.appRoot,
    [NEXT_ENVIRONMENT_KEYS.bundler]: dev.bundler,
    [NEXT_ENVIRONMENT_KEYS.configurationSecret]: configurationSecret,
    [NEXT_ENVIRONMENT_KEYS.internalOrigin]: sidecar.origin,
    [NEXT_ENVIRONMENT_KEYS.internalSecret]: internalSecret,
    [NEXT_ENVIRONMENT_KEYS.launchNonce]: launchNonce,
    [NEXT_ENVIRONMENT_KEYS.registryEpoch]: registryEpoch,
    [NEXT_ENVIRONMENT_KEYS.sidecarOrigin]: sidecar.origin,
  };
  const child = spawn(
    process.execPath,
    [project.nextEntry, "dev", ...dev.nextArguments],
    {
      cwd: project.appRoot,
      env: childEnvironment,
      shell: false,
      stdio: "inherit",
      windowsHide: true,
    },
  );
  lifecycle.child = child;
  const startupTimer = setTimeout(() => {
    failureCode = "CONFIGURATION_TIMEOUT";
    child.kill("SIGTERM");
  }, CONFIGURATION_STARTUP_TIMEOUT_MS);
  startupTimer.unref();

  let requestedSignal: NodeJS.Signals | undefined;
  let forceTimer: ReturnType<typeof setTimeout> | undefined;
  const forwardSignal = (signal: NodeJS.Signals): void => {
    if (requestedSignal !== undefined) {
      return;
    }

    requestedSignal = signal;
    child.kill(signal);
    forceTimer = setTimeout(() => {
      child.kill("SIGKILL");
    }, FORCED_TERMINATION_TIMEOUT_MS);
    forceTimer.unref();
  };
  const onSigint = (): void => {
    forwardSignal("SIGINT");
  };
  const onSigterm = (): void => {
    forwardSignal("SIGTERM");
  };
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  const result = await waitForChild(child);
  clearTimeout(startupTimer);

  process.off("SIGINT", onSigint);
  process.off("SIGTERM", onSigterm);

  if (forceTimer !== undefined) {
    clearTimeout(forceTimer);
  }

  await configurationQueue;

  try {
    await closeSidecar(sidecar);
  } catch {
    failureCode ??= "SHUTDOWN_FAILED";
  }

  if (failureCode !== undefined) {
    process.stderr.write(`[spotpatch:next] stopped (${failureCode}).\n`);
    return 1;
  }

  if (lifecycle.sidecarFailed || result.error) {
    process.stderr.write("[spotpatch:next] stopped (PROCESS_FAILURE).\n");
    return 1;
  }

  if (result.signal !== null || requestedSignal !== undefined) {
    return signalExitCode(result.signal ?? requestedSignal ?? null);
  }

  return result.code ?? 1;
}
