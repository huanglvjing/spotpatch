import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import type { Dirent } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

import {
  chromium,
  expect as playwrightExpect,
  type Browser,
  type BrowserContext,
} from "@playwright/test";
import { afterAll, beforeAll, describe, expect as vitestExpect, it } from "vitest";

import probeContract from "../loader/probe-contract.json";
import type {
  FixtureDefinition,
  ProbeAssertion,
  ProbeCaseResult,
  ProbeCommand,
} from "./contracts.js";
import { writeCaseLog, writeEvidence } from "./evidence.js";
import { experimentRoot, fixtureMatrix, repositoryRoot } from "./fixture-matrix.js";
import {
  reserveLoopbackPort,
  runNodeCommand,
  startNodeCommand,
  stopNodeCommand,
  type RunningProcess,
} from "./process-control.js";

const ACTIVE_MARKER_PREFIX = probeContract.activePrefix;
const INITIAL_REFRESH_LABEL = "INITIAL_REFRESH_LABEL";
const UPDATED_REFRESH_LABEL = "UPDATED_REFRESH_LABEL";
const NEXT_START_TIMEOUT_MS = 90_000;
const NEXT_BUILD_TIMEOUT_MS = 180_000;
const BROWSER_ASSERTION_TIMEOUT_MS = 30_000;
const EXPECTED_CASE_COUNT = fixtureMatrix.reduce(
  (count, fixture) => count + fixture.development.length + 1,
  0,
);
const results: ProbeCaseResult[] = [];

let browser: Browser | undefined;

interface ProbeTransformResult {
  readonly code: string;
  readonly map: unknown;
  readonly markerCount: number;
}

interface ProbeTransformModule {
  readonly transformProbeSource: (
    source: string,
    probeId: string,
    sourceName: string,
  ) => ProbeTransformResult | null;
}

const nodeRequire = createRequire(import.meta.url);

function isProbeTransformModule(value: unknown): value is ProbeTransformModule {
  return isUnknownRecord(value) && typeof value.transformProbeSource === "function";
}

function getProbeTransformModule(): ProbeTransformModule {
  const modulePath = path.join(experimentRoot, "loader", "probe-transform.cjs");
  const moduleValue: unknown = nodeRequire(modulePath);

  if (!isProbeTransformModule(moduleValue)) {
    throw new Error("Unable to load the chain probe transform module.");
  }

  return moduleValue;
}

function hashSource(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createCaseId(
  fixture: FixtureDefinition,
  command: ProbeCommand,
  kind: "development" | "production",
): string {
  return `${fixture.id}-${kind}-${command.bundler}`;
}

function addAssertion(
  assertions: ProbeAssertion[],
  input: Omit<ProbeAssertion, "passed"> & { readonly passed: boolean },
): void {
  assertions.push(Object.freeze(input));

  if (!input.passed) {
    throw new Error(
      `${input.name}: expected ${input.expected}, received ${input.actual}.`,
    );
  }
}

async function prepareFixtureWorkDirectory(
  fixture: FixtureDefinition,
  caseId: string,
): Promise<string> {
  const workDirectory = path.join(experimentRoot, ".work", caseId);
  await rm(workDirectory, { recursive: true, force: true });
  await mkdir(path.dirname(workDirectory), { recursive: true });
  await cp(fixture.directory, workDirectory, {
    recursive: true,
    filter(source) {
      const basename = path.basename(source);
      return (
        basename !== ".next" &&
        basename !== "node_modules" &&
        basename !== "tsconfig.tsbuildinfo"
      );
    },
  });

  const fixtureNodeModules = path.join(fixture.directory, "node_modules");
  const nodeModulesStat = await lstat(fixtureNodeModules);

  if (!nodeModulesStat.isDirectory()) {
    throw new Error(`Fixture dependencies are missing for ${fixture.id}.`);
  }

  await symlink(fixtureNodeModules, path.join(workDirectory, "node_modules"), "dir");
  return workDirectory;
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await lstat(absolutePath);
    return true;
  } catch (error: unknown) {
    if (hasErrorCode(error, "ENOENT")) {
      return false;
    }

    throw error;
  }
}

async function cleanupFixtureWorkDirectory(
  workDirectory: string,
  assertions: ProbeAssertion[],
): Promise<string | null> {
  let cleanupError: string | null = null;

  try {
    await rm(workDirectory, { recursive: true, force: true });

    if (await pathExists(workDirectory)) {
      cleanupError = "The disposable fixture work directory still exists.";
    }
  } catch (error: unknown) {
    cleanupError = toErrorMessage(error);
  }

  assertions.push(
    Object.freeze({
      name: "fixture work directory cleanup",
      expected: "disposable fixture work directory removed",
      actual: cleanupError ?? "work directory removed",
      passed: cleanupError === null,
    }),
  );

  return cleanupError;
}

function appendCleanupError(
  error: string | null,
  cleanupError: string | null,
): string | null {
  if (cleanupError === null) {
    return error;
  }

  if (error === null) {
    return cleanupError;
  }

  return `${error} Cleanup failed: ${cleanupError}`;
}

function getNextEntry(fixture: FixtureDefinition): string {
  return path.join(fixture.directory, "node_modules", "next", "dist", "bin", "next");
}

async function waitForNextServer(url: string, running: RunningProcess): Promise<void> {
  const deadline = Date.now() + NEXT_START_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (running.child.exitCode !== null) {
      throw new Error(
        `Next dev exited before becoming ready with code ${String(running.child.exitCode)}.`,
      );
    }

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(2_000),
      });
      await response.body?.cancel();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error(
    `Next dev did not become ready within ${String(NEXT_START_TIMEOUT_MS)}ms.`,
  );
}

function getRequiredBrowser(): Browser {
  if (browser === undefined) {
    throw new Error("The Chromium POC browser is not initialized.");
  }

  return browser;
}

async function executeDevelopmentCase(
  fixture: FixtureDefinition,
  command: ProbeCommand,
): Promise<ProbeCaseResult> {
  const caseId = createCaseId(fixture, command, "development");
  const startedAt = Date.now();
  const assertions: ProbeAssertion[] = [];
  const probeId = caseId;
  const loaderPath = path.join(experimentRoot, "loader", "chain-probe-loader.cjs");
  const port = await reserveLoopbackPort();
  const url = `http://127.0.0.1:${String(port)}`;
  const workDirectory = await prepareFixtureWorkDirectory(fixture, caseId);
  const clientProbePath = path.join(
    workDirectory,
    "app",
    "components",
    "client-probe.tsx",
  );
  const originalClientSource = await readFile(clientProbePath, "utf8");
  const devArgs = [...command.args, "--hostname", "127.0.0.1", "--port", String(port)];
  let context: BrowserContext | undefined;
  let running: RunningProcess | undefined;
  let error: string | null = null;
  let transformedModuleCount = 0;
  let sourceHashes: ProbeCaseResult["sourceHashes"] = {
    inputSha256: null,
    outputSha256: null,
  };

  try {
    const transformResult = getProbeTransformModule().transformProbeSource(
      originalClientSource,
      probeId,
      "client-probe.tsx",
    );
    addAssertion(assertions, {
      name: "probe transform output",
      expected: "marker-modified output that retains TypeScript syntax",
      actual:
        transformResult === null
          ? "no transform output"
          : `${String(transformResult.markerCount)} marker and retained TSX`,
      passed:
        transformResult !== null &&
        transformResult.code.includes(`useState<number>`) &&
        transformResult.code.includes(`${ACTIVE_MARKER_PREFIX}${probeId}`),
    });
    if (transformResult === null) {
      throw new Error("The probe transform returned no output for the client fixture.");
    }
    sourceHashes = Object.freeze({
      inputSha256: hashSource(originalClientSource),
      outputSha256: hashSource(transformResult.code),
    });

    running = startNodeCommand({
      entry: getNextEntry(fixture),
      args: devArgs,
      cwd: workDirectory,
      additions: {
        SPOTPATCH_POC_LOADER_PATH: loaderPath,
        SPOTPATCH_POC_PROBE_ID: probeId,
        SPOTPATCH_POC_TURBOPACK_ROOT: repositoryRoot,
        SPOTPATCH_POC_TURBOPACK_SOURCE_MAP_MODE: probeContract.sourceMapModes.turbopack,
        SPOTPATCH_POC_WEBPACK_SOURCE_MAP_MODE: probeContract.sourceMapModes.webpack,
      },
    });
    await waitForNextServer(url, running);

    context = await getRequiredBrowser().newContext();
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });

    const expectedMarkerValue = `${ACTIVE_MARKER_PREFIX}${probeId}`;
    const markerSelector = `[${probeContract.attributeName}="${expectedMarkerValue}"]`;
    const markerLocator = page.locator(markerSelector);
    await markerLocator.first().waitFor({
      state: "attached",
      timeout: BROWSER_ASSERTION_TIMEOUT_MS,
    });
    const markerValues = await markerLocator.evaluateAll(
      (elements, attributeName) =>
        elements
          .map((element) => element.getAttribute(attributeName))
          .filter((value): value is string => value !== null),
      probeContract.attributeName,
    );
    transformedModuleCount = markerValues.length;
    addAssertion(assertions, {
      name: "development marker injection",
      expected: "at least three transformed host elements",
      actual: `${String(markerValues.length)} transformed host elements`,
      passed: markerValues.length >= 3,
    });
    addAssertion(assertions, {
      name: "parallel module marker determinism",
      expected: `all transformed modules use ${expectedMarkerValue}`,
      actual: [...new Set(markerValues)].join(", "),
      passed: markerValues.every((value) => value === expectedMarkerValue),
    });

    await playwrightExpect(page.locator("[data-hydrated]")).toHaveAttribute(
      "data-hydrated",
      "true",
      {
        timeout: BROWSER_ASSERTION_TIMEOUT_MS,
      },
    );
    await page.locator("[data-counter]").click();
    await playwrightExpect(page.locator("[data-counter]")).toHaveText("1");
    const updatedClientSource = originalClientSource.replace(
      INITIAL_REFRESH_LABEL,
      UPDATED_REFRESH_LABEL,
    );
    addAssertion(assertions, {
      name: "fixture HMR mutation",
      expected: "one deterministic label replacement",
      actual:
        updatedClientSource === originalClientSource
          ? "no label replacement"
          : "label replaced",
      passed: updatedClientSource !== originalClientSource,
    });
    await writeFile(clientProbePath, updatedClientSource, "utf8");
    await playwrightExpect(page.locator("[data-refresh-label]")).toHaveText(
      UPDATED_REFRESH_LABEL,
      { timeout: BROWSER_ASSERTION_TIMEOUT_MS },
    );
    addAssertion(assertions, {
      name: "Fast Refresh state preservation",
      expected: "counter state remains 1 after source update",
      actual: (await page.locator("[data-counter]").textContent()) ?? "null",
      passed: (await page.locator("[data-counter]").textContent()) === "1",
    });
    const hasChainedSourceMap = await fileTreeContainsSourceMap(
      path.join(workDirectory, ".next"),
      "app/components/client-probe.tsx",
      updatedClientSource,
    );
    addAssertion(assertions, {
      name: "Next source-map chain",
      expected: "project-relative source and unmodified TSX sourcesContent",
      actual: hasChainedSourceMap
        ? "matching source map found"
        : "matching source map not found",
      passed: hasChainedSourceMap,
    });

    const edgePage = await context.newPage();
    await edgePage.goto(`${url}/edge`, { waitUntil: "domcontentloaded" });
    await playwrightExpect(edgePage.locator("[data-runtime]")).toHaveText(
      "Edge marker",
      {
        timeout: BROWSER_ASSERTION_TIMEOUT_MS,
      },
    );
    const edgeMarkerCount = await edgePage.locator(markerSelector).count();
    addAssertion(assertions, {
      name: "Edge compilation remains healthy",
      expected: "one transformed edge host element",
      actual: `${String(edgeMarkerCount)} transformed edge host elements`,
      passed: edgeMarkerCount === 1,
    });
    await edgePage.close();
  } catch (caughtError: unknown) {
    error = toErrorMessage(caughtError);
  } finally {
    await context?.close();
    if (running !== undefined) {
      await stopNodeCommand(running);
    }
  }

  const logs = running?.getLogs() ?? "Next dev was not started.";
  let logPath: string;

  try {
    logPath = await writeCaseLog(caseId, logs, workDirectory);
  } finally {
    error = appendCleanupError(
      error,
      await cleanupFixtureWorkDirectory(workDirectory, assertions),
    );
  }

  return Object.freeze({
    fixtureId: fixture.id,
    kind: "development",
    bundler: command.bundler,
    nextVersion: fixture.nextVersion,
    reactVersion: fixture.reactVersion,
    command: `next ${devArgs.join(" ")}`,
    durationMs: Date.now() - startedAt,
    status: error === null ? "passed" : "failed",
    error,
    assertions,
    transformedModuleCount,
    sourceHashes,
    logPath,
  });
}

function hasErrorCode(error: unknown, code: string): boolean {
  return isUnknownRecord(error) && error.code === code;
}

async function readDirectoryIfPresent(directory: string): Promise<readonly Dirent[]> {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error: unknown) {
    if (hasErrorCode(error, "ENOENT")) {
      return [];
    }

    throw error;
  }
}

async function readFileIfPresent(absolutePath: string): Promise<Buffer | null> {
  try {
    return await readFile(absolutePath);
  } catch (error: unknown) {
    if (hasErrorCode(error, "ENOENT")) {
      return null;
    }

    throw error;
  }
}

async function fileTreeContains(directory: string, needle: Buffer): Promise<boolean> {
  const entries = await readDirectoryIfPresent(directory);

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (await fileTreeContains(absolutePath, needle)) {
        return true;
      }
    } else if (entry.isFile()) {
      const content = await readFileIfPresent(absolutePath);

      if (content?.includes(needle) === true) {
        return true;
      }
    }
  }

  return false;
}

function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function sourceMapMatches(
  value: unknown,
  expectedSource: string,
  expectedContent: string,
): boolean {
  if (!isUnknownRecord(value)) {
    return false;
  }

  const { sources, sourcesContent } = value;

  if (Array.isArray(sources) && Array.isArray(sourcesContent)) {
    const hasMatchingSource = sources.some(
      (source, index) =>
        typeof source === "string" &&
        source.endsWith(expectedSource) &&
        sourcesContent[index] === expectedContent,
    );

    if (hasMatchingSource) {
      return true;
    }
  }

  const { sections } = value;

  return (
    Array.isArray(sections) &&
    sections.some(
      (section) =>
        isUnknownRecord(section) &&
        sourceMapMatches(section.map, expectedSource, expectedContent),
    )
  );
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function contentContainsSourceMap(
  content: Buffer,
  expectedSource: string,
  expectedContent: string,
): boolean {
  const text = content.toString("utf8");
  const directMap = parseJson(text);

  if (sourceMapMatches(directMap, expectedSource, expectedContent)) {
    return true;
  }

  const inlineMapPattern =
    /sourceMappingURL=data:application\/json(?:;charset=utf-8)?;base64,([A-Za-z0-9+/=]+)/gu;

  for (const match of text.matchAll(inlineMapPattern)) {
    const encodedMap = match[1];

    if (encodedMap === undefined) {
      continue;
    }

    const decodedMap = Buffer.from(encodedMap, "base64").toString("utf8");

    if (sourceMapMatches(parseJson(decodedMap), expectedSource, expectedContent)) {
      return true;
    }
  }

  return false;
}

async function fileTreeContainsSourceMap(
  directory: string,
  expectedSource: string,
  expectedContent: string,
): Promise<boolean> {
  const entries = await readDirectoryIfPresent(directory);

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (
        await fileTreeContainsSourceMap(absolutePath, expectedSource, expectedContent)
      ) {
        return true;
      }
    } else if (entry.isFile()) {
      const content = await readFileIfPresent(absolutePath);

      if (
        content !== null &&
        contentContainsSourceMap(content, expectedSource, expectedContent)
      ) {
        return true;
      }
    }
  }

  return false;
}

async function executeProductionCase(
  fixture: FixtureDefinition,
): Promise<ProbeCaseResult> {
  const command = fixture.production;
  const caseId = createCaseId(fixture, command, "production");
  const startedAt = Date.now();
  const assertions: ProbeAssertion[] = [];
  const workDirectory = await prepareFixtureWorkDirectory(fixture, caseId);
  let logs = "";
  let error: string | null = null;

  try {
    const commandResult = await runNodeCommand({
      entry: getNextEntry(fixture),
      args: command.args,
      cwd: workDirectory,
      timeoutMs: NEXT_BUILD_TIMEOUT_MS,
    });
    logs = commandResult.logs;
    addAssertion(assertions, {
      name: "production build",
      expected: "exit code 0",
      actual: `exit code ${String(commandResult.exitCode)}`,
      passed: commandResult.exitCode === 0,
    });

    const activeMarkerNeedle = Buffer.from(
      `${probeContract.attributeName}="${ACTIVE_MARKER_PREFIX}`,
      "utf8",
    );
    const containsActiveMarker = await fileTreeContains(
      path.join(workDirectory, ".next"),
      activeMarkerNeedle,
    );
    addAssertion(assertions, {
      name: "production development-marker absence",
      expected: "no active Loader POC marker in .next output",
      actual: containsActiveMarker ? "active marker found" : "active marker absent",
      passed: !containsActiveMarker,
    });
    addAssertion(assertions, {
      name: "production environment isolation",
      expected: "build does not require Loader POC environment",
      actual: logs.includes("Missing required Loader POC environment")
        ? "development environment was read"
        : "development environment was not read",
      passed: !logs.includes("Missing required Loader POC environment"),
    });
  } catch (caughtError: unknown) {
    error = toErrorMessage(caughtError);
  }

  let logPath: string;

  try {
    logPath = await writeCaseLog(caseId, logs, workDirectory);
  } finally {
    error = appendCleanupError(
      error,
      await cleanupFixtureWorkDirectory(workDirectory, assertions),
    );
  }

  return Object.freeze({
    fixtureId: fixture.id,
    kind: "production",
    bundler: command.bundler,
    nextVersion: fixture.nextVersion,
    reactVersion: fixture.reactVersion,
    command: `next ${command.args.join(" ")}`,
    durationMs: Date.now() - startedAt,
    status: error === null ? "passed" : "failed",
    error,
    assertions,
    transformedModuleCount: 0,
    sourceHashes: Object.freeze({ inputSha256: null, outputSha256: null }),
    logPath,
  });
}

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  await writeEvidence(results, EXPECTED_CASE_COUNT);
});

describe.sequential("Next Loader compilation chain POC", () => {
  for (const fixture of fixtureMatrix) {
    for (const command of fixture.development) {
      it(`${fixture.id} ${command.bundler} preserves TSX, maps, and Fast Refresh`, async () => {
        const result = await executeDevelopmentCase(fixture, command);
        results.push(result);
        vitestExpect(result.error, result.logPath).toBeNull();
      });
    }

    it(`${fixture.id} production build does not activate the development loader`, async () => {
      const result = await executeProductionCase(fixture);
      results.push(result);
      vitestExpect(result.error, result.logPath).toBeNull();
    });
  }
});
