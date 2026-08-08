import { lstat, rm } from "node:fs/promises";
import path from "node:path";

import {
  chromium,
  expect as playwrightExpect,
  type Browser,
  type BrowserContext,
} from "@playwright/test";
import { afterAll, beforeAll, describe, expect as vitestExpect, it } from "vitest";

import probeContract from "../loader/probe-contract.json";
import { fileTreeContains } from "./artifact-scan.js";
import type { ProbeAssertion, ProbeCaseResult, ProbeCommand } from "./contracts.js";
import { writeCaseLog, writeEvidence } from "./evidence.js";
import { experimentRoot } from "./fixture-matrix.js";
import { getNextEntry, waitForNextServer } from "./next-process.js";
import {
  reserveLoopbackPort,
  runNodeCommand,
  startNodeCommand,
  stopNodeCommand,
  type RunningProcess,
} from "./process-control.js";
import { addAssertion, appendError, toErrorMessage } from "./probe-result.js";
import {
  assertRealHostUnchanged,
  inspectRealHost,
  prepareRealHostWorkDirectory,
  type RealHostSnapshot,
} from "./real-host-fixture.js";
import { STRESS_MODULE_COUNT, STRESS_ROUTE_SEGMENT } from "./stress-fixture.js";

const REAL_HOST_ROOT_ENVIRONMENT_KEY = "SPOTPATCH_NEXT_REAL_HOST_ROOT";
const ACTIVE_MARKER_PREFIX = probeContract.activePrefix;
const CONCURRENT_REQUEST_COUNT = 8;
const EXPECTED_CASE_COUNT = 3;
const NEXT_BUILD_TIMEOUT_MS = 240_000;
const BROWSER_ASSERTION_TIMEOUT_MS = 30_000;
const developmentCommands = Object.freeze([
  { bundler: "turbopack", args: ["dev"] },
  { bundler: "webpack", args: ["dev", "--webpack"] },
] satisfies readonly ProbeCommand[]);
const results: ProbeCaseResult[] = [];

let browser: Browser | undefined;
let hostSnapshot: RealHostSnapshot | undefined;

function getRequiredHostSnapshot(): RealHostSnapshot {
  if (hostSnapshot === undefined) {
    throw new Error("The real-host snapshot is not initialized.");
  }

  return hostSnapshot;
}

function getRequiredBrowser(): Browser {
  if (browser === undefined) {
    throw new Error("The real-host Chromium browser is not initialized.");
  }

  return browser;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

async function cleanupWorkDirectory(
  workDirectory: string,
  assertions: ProbeAssertion[],
): Promise<string | null> {
  try {
    await rm(workDirectory, { recursive: true, force: true });

    try {
      await lstat(workDirectory);
      throw new Error("The disposable real-host work directory still exists.");
    } catch (error: unknown) {
      if (!hasErrorCode(error, "ENOENT")) {
        throw error;
      }
    }

    assertions.push(
      Object.freeze({
        name: "real-host work directory cleanup",
        expected: "disposable real-host work directory removed",
        actual: "work directory removed",
        passed: true,
      }),
    );
    return null;
  } catch (error: unknown) {
    const message = toErrorMessage(error);
    assertions.push(
      Object.freeze({
        name: "real-host work directory cleanup",
        expected: "disposable real-host work directory removed",
        actual: message,
        passed: false,
      }),
    );
    return message;
  }
}

function getProcessEnvironment(probeId: string): Readonly<Record<string, string>> {
  return Object.freeze({
    SPOTPATCH_POC_LOADER_PATH: path.join(
      experimentRoot,
      "loader",
      "chain-probe-loader.cjs",
    ),
    SPOTPATCH_POC_PROBE_ID: probeId,
    SPOTPATCH_POC_TURBOPACK_SOURCE_MAP_MODE: probeContract.sourceMapModes.turbopack,
    SPOTPATCH_POC_WEBPACK_SOURCE_MAP_MODE: probeContract.sourceMapModes.webpack,
  });
}

async function executeDevelopmentCase(command: ProbeCommand): Promise<ProbeCaseResult> {
  const snapshot = getRequiredHostSnapshot();
  const caseId = `real-host-next16-development-${command.bundler}`;
  const workDirectory = path.join(experimentRoot, ".work", caseId);
  const probeId = caseId;
  const expectedMarkerValue = `${ACTIVE_MARKER_PREFIX}${probeId}`;
  const assertions: ProbeAssertion[] = [];
  const startedAt = Date.now();
  const port = await reserveLoopbackPort();
  const url = `http://127.0.0.1:${String(port)}`;
  const createDevArgs = (serverPort: number): readonly string[] => [
    ...command.args,
    "--hostname",
    "127.0.0.1",
    "--port",
    String(serverPort),
  ];
  const startDevelopmentServer = (
    serverPort: number,
    activeProbeId: string,
  ): RunningProcess =>
    startNodeCommand({
      entry: getNextEntry(snapshot.root),
      args: createDevArgs(serverPort),
      cwd: workDirectory,
      additions: getProcessEnvironment(activeProbeId),
    });
  let context: BrowserContext | undefined;
  let running: RunningProcess | undefined;
  const processLogs: string[] = [];
  let error: string | null = null;
  let sourceHashes: ProbeCaseResult["sourceHashes"] = Object.freeze({
    inputSha256: null,
    outputSha256: null,
  });
  let transformedModuleCount = 0;

  try {
    sourceHashes = await prepareRealHostWorkDirectory(snapshot, workDirectory);
    running = startDevelopmentServer(port, probeId);
    await waitForNextServer(url, running);

    const existingPageResponse = await fetch(url);
    const existingPageBody = await existingPageResponse.text();
    addAssertion(assertions, {
      name: "existing application route",
      expected: "the original home route returns the SpotPatch marketing page",
      actual: `status ${String(existingPageResponse.status)}`,
      passed:
        existingPageResponse.status === 200 && existingPageBody.includes("SpotPatch"),
    });

    const stressUrl = `${url}/${STRESS_ROUTE_SEGMENT}`;
    const stressResponses = await Promise.all(
      Array.from({ length: CONCURRENT_REQUEST_COUNT }, () => fetch(stressUrl)),
    );
    const stressBodies = await Promise.all(
      stressResponses.map(async (response) =>
        Object.freeze({ status: response.status, body: await response.text() }),
      ),
    );
    addAssertion(assertions, {
      name: "real-host concurrent cold requests",
      expected: `${String(CONCURRENT_REQUEST_COUNT)} successful marked responses`,
      actual: `${String(stressBodies.filter((response) => response.status === 200 && response.body.includes(expectedMarkerValue)).length)} successful marked responses`,
      passed: stressBodies.every(
        (response) =>
          response.status === 200 && response.body.includes(expectedMarkerValue),
      ),
    });

    context = await getRequiredBrowser().newContext();
    const stressPage = await context.newPage();
    await stressPage.goto(stressUrl, { waitUntil: "domcontentloaded" });
    const stressModules = stressPage.locator("[data-stress-module]");
    transformedModuleCount = await stressModules.count();
    addAssertion(assertions, {
      name: "real-host high-module compilation",
      expected: `${String(STRESS_MODULE_COUNT)} transformed TSX modules`,
      actual: `${String(transformedModuleCount)} transformed TSX modules`,
      passed: transformedModuleCount === STRESS_MODULE_COUNT,
    });
    const markerValues = await stressModules.evaluateAll(
      (elements, attributeName) =>
        elements.map((element) => element.getAttribute(attributeName)),
      probeContract.attributeName,
    );
    addAssertion(assertions, {
      name: "real-host marker determinism",
      expected: `all modules use ${expectedMarkerValue}`,
      actual: `${String(markerValues.filter((value) => value === expectedMarkerValue).length)} deterministic markers`,
      passed: markerValues.every((value) => value === expectedMarkerValue),
    });

    const contactPage = await context.newPage();
    await contactPage.goto(`${url}/contact`, { waitUntil: "domcontentloaded" });
    const firstInput = contactPage.locator("input").first();
    await firstInput.fill("SpotPatch hydration probe");
    await playwrightExpect(firstInput).toHaveValue("SpotPatch hydration probe", {
      timeout: BROWSER_ASSERTION_TIMEOUT_MS,
    });
    addAssertion(assertions, {
      name: "existing Client Component hydration",
      expected: "the controlled form accepts client-side input",
      actual: await firstInput.inputValue(),
      passed: (await firstInput.inputValue()) === "SpotPatch hydration probe",
    });

    await context.close();
    context = undefined;
    processLogs.push(running.getLogs());
    await stopNodeCommand(running);
    running = undefined;

    const restartPort = await reserveLoopbackPort();
    const restartUrl = `http://127.0.0.1:${String(restartPort)}`;
    const restartProbeId = `${probeId}-restart`;
    const restartMarkerValue = `${ACTIVE_MARKER_PREFIX}${restartProbeId}`;
    running = startDevelopmentServer(restartPort, restartProbeId);
    await waitForNextServer(restartUrl, running);
    context = await getRequiredBrowser().newContext();
    const restartPage = await context.newPage();
    await restartPage.goto(`${restartUrl}/${STRESS_ROUTE_SEGMENT}`, {
      waitUntil: "domcontentloaded",
    });
    const restartedModules = restartPage.locator("[data-stress-module]");
    const restartedMarkerValues = await restartedModules.evaluateAll(
      (elements, attributeName) =>
        elements.map((element) => element.getAttribute(attributeName)),
      probeContract.attributeName,
    );
    addAssertion(assertions, {
      name: "real-host warm cache restart isolation",
      expected: `${String(STRESS_MODULE_COUNT)} modules use the restarted probe marker and no stale marker`,
      actual: `${String(restartedMarkerValues.filter((value) => value === restartMarkerValue).length)} restarted markers`,
      passed:
        restartedMarkerValues.length === STRESS_MODULE_COUNT &&
        restartedMarkerValues.every((value) => value === restartMarkerValue),
    });
  } catch (caughtError: unknown) {
    error = toErrorMessage(caughtError);
  } finally {
    await context?.close();
    if (running !== undefined) {
      processLogs.push(running.getLogs());
      await stopNodeCommand(running);
    }
  }

  const logs =
    processLogs.length === 0
      ? "Next dev was not started."
      : processLogs.join("\n--- warm restart ---\n");

  let logPath: string;

  try {
    logPath = await writeCaseLog(caseId, logs, workDirectory, "real-host-poc");
  } finally {
    error = appendError(error, await cleanupWorkDirectory(workDirectory, assertions));
    try {
      await assertRealHostUnchanged(snapshot);
    } catch (caughtError: unknown) {
      error = appendError(error, toErrorMessage(caughtError));
    }
  }

  return Object.freeze({
    fixtureId: `real-host-next16-${snapshot.gitRevision.slice(0, 12)}`,
    kind: "development",
    bundler: command.bundler,
    nextVersion: snapshot.nextVersion,
    reactVersion: snapshot.reactVersion,
    command: `next ${command.args.join(" ")}`,
    durationMs: Date.now() - startedAt,
    status: error === null ? "passed" : "failed",
    error,
    assertions,
    transformedModuleCount,
    sourceHashes,
    logPath,
  });
}

async function executeProductionCase(): Promise<ProbeCaseResult> {
  const snapshot = getRequiredHostSnapshot();
  const caseId = "real-host-next16-production-turbopack";
  const workDirectory = path.join(experimentRoot, ".work", caseId);
  const assertions: ProbeAssertion[] = [];
  const startedAt = Date.now();
  let logs = "";
  let error: string | null = null;
  let sourceHashes: ProbeCaseResult["sourceHashes"] = Object.freeze({
    inputSha256: null,
    outputSha256: null,
  });

  try {
    sourceHashes = await prepareRealHostWorkDirectory(snapshot, workDirectory);
    const commandResult = await runNodeCommand({
      entry: getNextEntry(snapshot.root),
      args: ["build"],
      cwd: workDirectory,
      timeoutMs: NEXT_BUILD_TIMEOUT_MS,
    });
    logs = commandResult.logs;
    addAssertion(assertions, {
      name: "real-host production build",
      expected: "exit code 0",
      actual: `exit code ${String(commandResult.exitCode)}`,
      passed: commandResult.exitCode === 0,
    });

    const outputRoot = path.join(workDirectory, ".next");
    const containsActiveMarker = await fileTreeContains(
      outputRoot,
      Buffer.from(`${probeContract.attributeName}="${ACTIVE_MARKER_PREFIX}`, "utf8"),
    );
    addAssertion(assertions, {
      name: "real-host production marker isolation",
      expected: "no active Loader POC marker in .next output",
      actual: containsActiveMarker ? "active marker found" : "active marker absent",
      passed: !containsActiveMarker,
    });
    const containsEnvironmentKey = await fileTreeContains(
      outputRoot,
      Buffer.from("SPOTPATCH_POC_LOADER_PATH", "utf8"),
    );
    addAssertion(assertions, {
      name: "real-host production environment isolation",
      expected: "no Loader POC environment key in .next output",
      actual: containsEnvironmentKey
        ? "Loader POC environment key found"
        : "Loader POC environment key absent",
      passed: !containsEnvironmentKey,
    });
  } catch (caughtError: unknown) {
    error = toErrorMessage(caughtError);
  }

  let logPath: string;

  try {
    logPath = await writeCaseLog(caseId, logs, workDirectory, "real-host-poc");
  } finally {
    error = appendError(error, await cleanupWorkDirectory(workDirectory, assertions));
    try {
      await assertRealHostUnchanged(snapshot);
    } catch (caughtError: unknown) {
      error = appendError(error, toErrorMessage(caughtError));
    }
  }

  return Object.freeze({
    fixtureId: `real-host-next16-${snapshot.gitRevision.slice(0, 12)}`,
    kind: "production",
    bundler: "turbopack",
    nextVersion: snapshot.nextVersion,
    reactVersion: snapshot.reactVersion,
    command: "next build",
    durationMs: Date.now() - startedAt,
    status: error === null ? "passed" : "failed",
    error,
    assertions,
    transformedModuleCount: 0,
    sourceHashes,
    logPath,
  });
}

beforeAll(async () => {
  const configuredRoot = process.env[REAL_HOST_ROOT_ENVIRONMENT_KEY];

  if (configuredRoot === undefined || configuredRoot.trim() === "") {
    throw new Error(
      `Set ${REAL_HOST_ROOT_ENVIRONMENT_KEY} to a clean private Next.js project before running the real-host POC.`,
    );
  }

  hostSnapshot = await inspectRealHost(configuredRoot);
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();

  if (hostSnapshot !== undefined) {
    await assertRealHostUnchanged(hostSnapshot);
  }

  if (results.length > 0) {
    await writeEvidence(results, EXPECTED_CASE_COUNT, "real-host-poc");
  }
});

describe.sequential("Next Loader real-host POC", () => {
  for (const command of developmentCommands) {
    it(`${command.bundler} compiles the real App Router host under stress`, async () => {
      const result = await executeDevelopmentCase(command);
      results.push(result);
      vitestExpect(result.error, result.logPath).toBeNull();
    });
  }

  it("keeps the real-host production build isolated", async () => {
    const result = await executeProductionCase();
    results.push(result);
    vitestExpect(result.error, result.logPath).toBeNull();
  });
});
