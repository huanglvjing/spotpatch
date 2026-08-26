import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  collectDataFlowInstrumentation,
  createDataFlowSourceVersion,
} from "@spotpatch/compiler";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveOptions } from "../options.js";
import {
  createSourceRegistry,
  type SourceRegistry,
} from "../registry/source-registry.js";
import { createSourceRegistrationService } from "./source-registration.js";

const internalSecret = "source_registration_test_secret_01";
const registryEpoch = "source_registration_test_epoch_01";

let root = "";
let registry: SourceRegistry;
let server: Server | undefined;
let origin = "";

async function closeServer(): Promise<void> {
  if (server === undefined) return;
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
  server = undefined;
}

async function post(body: unknown): Promise<Response> {
  return fetch(`${origin}/__spotpatch-internal/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-SpotPatch-Internal": internalSecret,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "spotpatch-registration-"));
  registry = createSourceRegistry();
  const service = await createSourceRegistrationService({
    internalSecret,
    options: resolveOptions({ dataFlow: {} }),
    registry,
    registryEpoch,
    root,
  });
  server = createServer(service.handler);
  await new Promise<void>((resolve) => {
    server?.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP source registration server.");
  }
  origin = `http://127.0.0.1:${String(address.port)}`;
});

afterEach(async () => {
  await closeServer();
  await rm(root, { recursive: true, force: true });
});

describe("source registration", () => {
  it("atomically registers current prepared component anchors", async () => {
    const sourcePath = path.join(root, "src", "AccountPanel.tsx");
    await mkdir(path.dirname(sourcePath), { recursive: true });
    const source = `export function AccountPanel() { return <main />; }`;
    await writeFile(sourcePath, source, "utf8");
    const instrumentation = collectDataFlowInstrumentation({
      absolutePath: sourcePath,
      code: source,
      helperModule: "@spotpatch/next/data-flow-runtime",
      root,
    });
    const component = instrumentation.anchors.find(
      (anchor) => anchor.kind === "component",
    );
    if (component === undefined) throw new Error("Expected a component anchor.");

    const response = await post({
      epoch: registryEpoch,
      resourcePath: sourcePath,
      dataFlow: {
        sourceVersion: instrumentation.sourceVersion,
        components: [
          {
            componentSourceId: component.id,
            line: component.line,
            column: component.column,
          },
        ],
      },
    });

    expect(response.status).toBe(200);
    expect(registry.resolveDataFlowComponent(component.id)).toMatchObject({
      componentSourceId: component.id,
      sourceVersion: instrumentation.sourceVersion,
    });
  });

  it("rejects a stale source version without changing current anchors", async () => {
    const sourcePath = path.join(root, "src", "Current.tsx");
    await mkdir(path.dirname(sourcePath), { recursive: true });
    const currentSource = `export function Current() { return <div />; }`;
    await writeFile(sourcePath, currentSource, "utf8");
    const currentId = "component_current_registration";
    registry.registerDataFlowComponents(
      sourcePath,
      createDataFlowSourceVersion(currentSource),
      [{ componentSourceId: currentId, line: 1, column: 1 }],
    );

    const response = await post({
      epoch: registryEpoch,
      resourcePath: sourcePath,
      dataFlow: {
        sourceVersion: createDataFlowSourceVersion("stale source"),
        components: [{ componentSourceId: "component_stale", line: 1, column: 1 }],
      },
    });

    expect(response.status).toBe(409);
    expect(registry.resolveDataFlowComponent(currentId)).toBeDefined();
    expect(registry.resolveDataFlowComponent("component_stale")).toBeUndefined();
  });
});
