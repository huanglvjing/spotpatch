import { randomBytes } from "node:crypto";
import { cp, lstat, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  chromium,
  expect as playwrightExpect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import probeContract from "../loader/probe-contract.json";
import { fileTreeContains } from "./artifact-scan.js";
import { experimentRoot } from "./fixture-matrix.js";
import { getNextEntry, waitForNextServer } from "./next-process.js";
import {
  reserveLoopbackPort,
  startNodeCommand,
  stopNodeCommand,
  type RunningProcess,
} from "./process-control.js";
import {
  assertRealHostUnchanged,
  inspectRealHost,
  prepareRealHostWorkDirectory,
  type RealHostSnapshot,
} from "./real-host-fixture.js";
import {
  createRuntimePocSecret,
  RUNTIME_POC_SOURCE_MARKER_ATTRIBUTE,
  startRuntimePocSidecar,
  type RuntimePocSidecar,
} from "./runtime-poc-sidecar.js";
import { STRESS_MODULE_COUNT, STRESS_ROUTE_SEGMENT } from "./stress-fixture.js";

const REAL_HOST_ROOT_ENVIRONMENT_KEY = "SPOTPATCH_NEXT_REAL_HOST_ROOT";
const BROWSER_TIMEOUT_MS = 30_000;
const RUNTIME_BUNDLE_DIRECTORY = path.join(
  experimentRoot,
  ".work",
  "runtime-poc-bundle",
);
const RUNTIME_CLIENT_DIRECTORY = ".spotpatch-runtime-poc";
const RUNTIME_CLIENT_MODULE = `./${RUNTIME_CLIENT_DIRECTORY}/runtime-poc-hook.js`;
const SOURCE_MARKER_PATTERN = /^[A-Za-z0-9_-]{1,128}:[1-9]\d*:[1-9]\d*$/u;
const commands = Object.freeze([
  { bundler: "turbopack", args: ["dev"] },
  { bundler: "webpack", args: ["dev", "--webpack"] },
] as const);

let browser: Browser | undefined;
let hostSnapshot: RealHostSnapshot | undefined;

function requiredBrowser(): Browser {
  if (browser === undefined) {
    throw new Error("The Runtime real-host POC browser is not initialized.");
  }

  return browser;
}

function requiredHostSnapshot(): RealHostSnapshot {
  if (hostSnapshot === undefined) {
    throw new Error("The Runtime real-host POC host is not initialized.");
  }

  return hostSnapshot;
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = BROWSER_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Condition was not met within ${String(timeoutMs)}ms.`);
}

function getProcessEnvironment(input: {
  readonly internalSecret: string;
  readonly probeId: string;
  readonly registryEpoch: string;
  readonly sidecarOrigin: string;
}): Readonly<Record<string, string>> {
  return Object.freeze({
    SPOTPATCH_POC_INTERNAL_ORIGIN: input.sidecarOrigin,
    SPOTPATCH_POC_INTERNAL_SECRET: input.internalSecret,
    SPOTPATCH_POC_LOADER_PATH: path.join(
      experimentRoot,
      "loader",
      "registration-probe-loader.cjs",
    ),
    SPOTPATCH_POC_PROBE_ID: input.probeId,
    SPOTPATCH_POC_REGISTRY_EPOCH: input.registryEpoch,
    SPOTPATCH_POC_RUNTIME_CLIENT_MODULE: RUNTIME_CLIENT_MODULE,
    SPOTPATCH_POC_SIDECAR_ORIGIN: input.sidecarOrigin,
    SPOTPATCH_POC_SOURCE_MARKER_ATTRIBUTE: RUNTIME_POC_SOURCE_MARKER_ATTRIBUTE,
    SPOTPATCH_POC_TURBOPACK_SOURCE_MAP_MODE: probeContract.sourceMapModes.turbopack,
    SPOTPATCH_POC_WEBPACK_SOURCE_MAP_MODE: probeContract.sourceMapModes.webpack,
  });
}

async function assertInternalRegistrationSecurity(input: {
  readonly internalSecret: string;
  readonly registryEpoch: string;
  readonly sidecar: RuntimePocSidecar;
  readonly workDirectory: string;
}): Promise<void> {
  const endpoint = `${input.sidecar.internalOrigin}/__spotpatch-internal/register`;
  const validSource = path.join(
    input.workDirectory,
    "app",
    STRESS_ROUTE_SEGMENT,
    "modules",
    "stress-module-0000.tsx",
  );
  const body = JSON.stringify({
    epoch: input.registryEpoch,
    resourcePath: validSource,
  });
  const missingSecret = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  expect(missingSecret.status).toBe(403);
  await missingSecret.body?.cancel();

  const browserLike = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://127.0.0.1:3000",
      "X-SpotPatch-Internal": input.internalSecret,
    },
    body,
  });
  expect(browserLike.status).toBe(403);
  await browserLike.body?.cancel();

  const outsideRoot = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-SpotPatch-Internal": input.internalSecret,
    },
    body: JSON.stringify({
      epoch: input.registryEpoch,
      resourcePath: path.join(experimentRoot, "src", "contracts.ts"),
    }),
  });
  expect(outsideRoot.status).toBe(403);
  await outsideRoot.body?.cancel();

  const concurrent = await Promise.all(
    Array.from({ length: 8 }, () =>
      fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-SpotPatch-Internal": input.internalSecret,
        },
        body,
      }),
    ),
  );
  const registrations = await Promise.all(
    concurrent.map(async (response) => {
      expect(response.status).toBe(200);
      return (await response.json()) as unknown;
    }),
  );
  const fileIds = registrations.map((registration) => {
    if (
      typeof registration !== "object" ||
      registration === null ||
      !("fileId" in registration) ||
      typeof registration.fileId !== "string"
    ) {
      throw new TypeError("The registration POC returned an invalid file ID.");
    }

    return registration.fileId;
  });
  expect(new Set(fileIds).size).toBe(1);
}

async function assertRewriteTransport(
  origin: string,
  sidecar: RuntimePocSidecar,
): Promise<void> {
  const payload = Object.freeze({ message: "rewrite-body-preserved" });
  const startedAt = Date.now();
  const response = await fetch(`${origin}/__spotpatch/v1/poc-transport`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "X-SpotPatch-Poc-Transport": "1",
    },
    body: JSON.stringify(payload),
  });
  expect(response.status).toBe(207);
  expect(response.headers.get("x-spotpatch-poc-proxy")).toBe("preserved");
  expect(response.body).not.toBeNull();
  const reader = response.body?.getReader();

  if (reader === undefined) {
    throw new Error("The rewrite transport POC response has no body.");
  }

  const firstChunk = await reader.read();
  expect(firstChunk.done).toBe(false);
  expect(Date.now() - startedAt).toBeLessThan(400);
  const firstText = new TextDecoder().decode(firstChunk.value);
  expect(firstText).toContain('"sequence":1');
  expect(firstText).toContain("rewrite-body-preserved");
  const secondChunk = await reader.read();
  expect(new TextDecoder().decode(secondChunk.value)).toContain('"sequence":2');
  await reader.cancel();

  const cancellation = await fetch(`${origin}/__spotpatch/v1/poc-transport-cancel`, {
    method: "POST",
    headers: { Origin: origin },
  });
  const cancellationReader = cancellation.body?.getReader();

  if (cancellationReader === undefined) {
    throw new Error("The rewrite cancellation POC response has no body.");
  }

  await cancellationReader.read();
  await cancellationReader.cancel();
  await waitForCondition(() => sidecar.transportAbortCount() > 0);
}

async function assertRuntimeUi(
  page: Page,
  origin: string,
  expectedMarkerValue: string,
  nextVersion: string,
): Promise<string> {
  await page.goto(`${origin}/${STRESS_ROUTE_SEGMENT}`, {
    waitUntil: "domcontentloaded",
  });
  await playwrightExpect
    .poll(() => page.evaluate(() => globalThis.__spotpatchRuntimePoc__?.status), {
      timeout: BROWSER_TIMEOUT_MS,
    })
    .toMatch(/^(failed|ready)$/u);
  const lifecycle = await page.evaluate(() => globalThis.__spotpatchRuntimePoc__);

  if (lifecycle?.status === "failed") {
    throw new Error(
      `The Runtime POC bootstrap failed (${lifecycle.errorCode ?? "missing-error-code"}).`,
    );
  }

  expect(lifecycle).toMatchObject({ hookInstalled: true, status: "ready" });
  expect(lifecycle?.initializationDurationMs).toBeLessThan(16);
  await playwrightExpect(page.locator("spotpatch-root")).toHaveCount(1);
  const selectButton = page.getByRole("button", { name: "Select element" });
  await playwrightExpect(selectButton).toBeVisible();

  const stressModules = page.locator("[data-stress-module]");
  await playwrightExpect(stressModules).toHaveCount(STRESS_MODULE_COUNT);
  const markerValues = await stressModules.evaluateAll(
    (elements, attributeName) =>
      elements.map((element) => element.getAttribute(attributeName)),
    RUNTIME_POC_SOURCE_MARKER_ATTRIBUTE,
  );
  expect(
    markerValues.every((value) => value !== null && SOURCE_MARKER_PATTERN.test(value)),
  ).toBe(true);
  const probeValues = await stressModules.evaluateAll(
    (elements, attributeName) =>
      elements.map((element) => element.getAttribute(attributeName)),
    probeContract.attributeName,
  );
  expect(probeValues.every((value) => value === expectedMarkerValue)).toBe(true);

  const firstTarget = stressModules.first();
  await firstTarget.scrollIntoViewIfNeeded();
  const markerBeforeHmr = await firstTarget.getAttribute(
    RUNTIME_POC_SOURCE_MARKER_ATTRIBUTE,
  );
  await selectButton.click();
  await playwrightExpect(
    page.getByRole("button", { name: "Stop selecting" }),
  ).toBeVisible();
  await firstTarget.click();
  const dialog = page.getByRole("dialog", { name: "Plan the change" });
  await playwrightExpect(dialog).toBeVisible();
  await playwrightExpect(dialog.locator(".spotpatch-summary")).toContainText(
    `Next.js: ${nextVersion}`,
  );
  await playwrightExpect(dialog.locator(".spotpatch-summary")).toContainText(
    `app/${STRESS_ROUTE_SEGMENT}/modules/stress-module-0000.tsx`,
  );
  await playwrightExpect(dialog.locator(".spotpatch-summary")).toContainText(
    "API: connected",
  );

  await dialog.getByRole("button", { name: "Close SpotPatch" }).click();
  await page.getByRole("link", { name: "服务能力", exact: true }).click();
  await playwrightExpect(page).toHaveURL(`${origin}/services`);
  await playwrightExpect(page.locator("spotpatch-root")).toHaveCount(1);
  await playwrightExpect(
    page.getByRole("button", { name: "Select element" }),
  ).toBeVisible();
  await page.goBack({ waitUntil: "domcontentloaded" });
  await playwrightExpect(page).toHaveURL(`${origin}/${STRESS_ROUTE_SEGMENT}`);
  await playwrightExpect(page.locator("spotpatch-root")).toHaveCount(1);

  if (markerBeforeHmr === null || !SOURCE_MARKER_PATTERN.test(markerBeforeHmr)) {
    throw new Error("The Runtime POC target did not retain a valid source marker.");
  }

  return markerBeforeHmr;
}

async function executeRuntimeCase(command: (typeof commands)[number]): Promise<void> {
  const snapshot = requiredHostSnapshot();
  const caseId = `runtime-real-host-${command.bundler}`;
  const workDirectory = path.join(experimentRoot, ".work", caseId);
  const port = await reserveLoopbackPort();
  const origin = `http://127.0.0.1:${String(port)}`;
  const internalSecret = createRuntimePocSecret();
  const registryEpoch = randomBytes(18).toString("base64url");
  const probeId = caseId;
  const expectedMarkerValue = `${probeContract.activePrefix}${probeId}`;
  let context: BrowserContext | undefined;
  let running: RunningProcess | undefined;
  let sidecar: RuntimePocSidecar | undefined;

  try {
    await prepareRealHostWorkDirectory(snapshot, workDirectory);
    await cp(
      RUNTIME_BUNDLE_DIRECTORY,
      path.join(workDirectory, RUNTIME_CLIENT_DIRECTORY),
      { recursive: true },
    );
    await lstat(
      path.join(workDirectory, RUNTIME_CLIENT_DIRECTORY, "runtime-poc-hook.js"),
    );
    sidecar = await startRuntimePocSidecar({
      bundler: command.bundler,
      internalSecret,
      nextVersion: snapshot.nextVersion,
      publicOrigin: origin,
      registryEpoch,
      root: workDirectory,
      routerKind: "app",
    });
    await assertInternalRegistrationSecurity({
      internalSecret,
      registryEpoch,
      sidecar,
      workDirectory,
    });

    running = startNodeCommand({
      entry: getNextEntry(snapshot.root),
      args: [...command.args, "--hostname", "127.0.0.1", "--port", String(port)],
      cwd: workDirectory,
      additions: getProcessEnvironment({
        internalSecret,
        probeId,
        registryEpoch,
        sidecarOrigin: sidecar.internalOrigin,
      }),
    });
    await waitForNextServer(origin, running);
    await assertRewriteTransport(origin, sidecar);

    const directBootstrap = await fetch(
      `${sidecar.internalOrigin}/__spotpatch/v1/bootstrap`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
        },
        body: "{}",
      },
    );
    expect(directBootstrap.status).toBe(403);
    await directBootstrap.body?.cancel();

    context = await requiredBrowser().newContext();
    const page = await context.newPage();
    const markerBeforeHmr = await assertRuntimeUi(
      page,
      origin,
      expectedMarkerValue,
      snapshot.nextVersion,
    );

    const modulePath = path.join(
      workDirectory,
      "app",
      STRESS_ROUTE_SEGMENT,
      "modules",
      "stress-module-0000.tsx",
    );
    const source = await readFile(modulePath, "utf8");
    await writeFile(
      modulePath,
      source.replace("Stress module 0000", "Stress module 0000 updated"),
      "utf8",
    );
    await playwrightExpect(page.locator('[data-stress-module="0000"]')).toContainText(
      "updated",
      { timeout: BROWSER_TIMEOUT_MS },
    );
    expect(
      await page
        .locator('[data-stress-module="0000"]')
        .getAttribute(RUNTIME_POC_SOURCE_MARKER_ATTRIBUTE),
    ).toBe(markerBeforeHmr);

    await context.close();
    context = undefined;
    await stopNodeCommand(running);
    const logs = running.getLogs();
    running = undefined;
    expect(logs).not.toContain(internalSecret);
    expect(logs).not.toContain(sidecar.runtimeConfig.sessionToken);
    expect(
      await fileTreeContains(
        path.join(workDirectory, ".next"),
        Buffer.from(internalSecret, "utf8"),
      ),
    ).toBe(false);
    expect(
      await fileTreeContains(
        path.join(workDirectory, ".next"),
        Buffer.from(sidecar.runtimeConfig.sessionToken, "utf8"),
      ),
    ).toBe(false);
  } catch (error: unknown) {
    const logs = running?.getLogs() ?? "Next dev was not running.";
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\n\n--- Next logs ---\n${logs}`, { cause: error });
  } finally {
    await context?.close();
    if (running !== undefined) {
      await stopNodeCommand(running);
    }
    await sidecar?.close();
    await rm(workDirectory, { recursive: true, force: true });
    await assertRealHostUnchanged(snapshot);
  }
}

beforeAll(async () => {
  const configuredRoot = process.env[REAL_HOST_ROOT_ENVIRONMENT_KEY];

  if (configuredRoot === undefined || configuredRoot.trim() === "") {
    throw new Error(
      `Set ${REAL_HOST_ROOT_ENVIRONMENT_KEY} to a clean private Next.js project before running the Runtime real-host POC.`,
    );
  }

  await lstat(RUNTIME_BUNDLE_DIRECTORY);
  hostSnapshot = await inspectRealHost(configuredRoot);
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();

  if (hostSnapshot !== undefined) {
    await assertRealHostUnchanged(hostSnapshot);
  }
});

describe.sequential("Next Runtime real-host POC", () => {
  for (const command of commands) {
    it(`${command.bundler} mounts one Runtime and preserves exact registered source context`, async () => {
      await executeRuntimeCase(command);
    });
  }
});
