import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createContextualAskManager,
  createSourceRegistry,
  createWorkspaceActivityCoordinator,
} from "@spotpatch/dev-server";
import { spotAskTaskEnvelopeSchema } from "@spotpatch/shared";
import { expect, it } from "vitest";

import { astroSourceImports } from "./source-projections.js";

it("answers native Astro with authorized import snapshots, citations and no writes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "spotpatch-astro-ask-"));
  const code =
    '---\nimport { label } from "./helper";\n---\n<button>{label}</button><script src="./browser.ts"></script>';
  const file = path.join(root, "Page.astro");
  await writeFile(file, code);
  await writeFile(path.join(root, "helper.ts"), 'export const label = "Save";');
  await writeFile(path.join(root, "browser.ts"), 'console.log("fixture");');
  const registry = createSourceRegistry();
  const fileId = registry.register(file);
  const envelope = spotAskTaskEnvelopeSchema.parse({
    schemaVersion: 1,
    taskId: "astro-task",
    createdAt: "2026-09-05T00:00:00.000Z",
    task: { kind: "ask", question: "What sets this label?" },
    selection: {
      schemaVersion: 1,
      selectionId: "astro-selection",
      locale: "en-US",
      createdAt: "2026-09-05T00:00:00.000Z",
      targets: [
        {
          targetId: "button",
          page: {
            url: "http://localhost/",
            pathname: "/",
            title: "Fixture",
            viewportWidth: 1280,
            viewportHeight: 720,
            devicePixelRatio: 1,
          },
          source: {
            fileId,
            relativePath: "Page.astro",
            origin: "astro-host",
            confidence: "exact",
          },
          react: { supported: false, componentStack: [] },
          element: {
            tagName: "button",
            selector: "button",
            sanitizedHtml: "<button>Save</button>",
            rect: { x: 0, y: 0, width: 100, height: 40 },
          },
          styles: { classNames: [], matchedRules: [], computed: {}, warnings: [] },
          warnings: [],
        },
      ],
    },
  });
  const manager = createContextualAskManager({
    root,
    registry,
    coordinator: createWorkspaceActivityCoordinator(),
    enabled: true,
    resolveSourceImports: astroSourceImports,
    executors: [
      {
        executorId: "fixture",
        capability: () =>
          Promise.resolve({
            executorId: "fixture",
            kind: "configured-key",
            label: "Synthetic executor",
            requestedModelLabel: "fixture",
            effectiveModelLabel: "fixture",
            state: "ready",
            providerDataConsentRequired: true,
            readOnlyProven: true,
          }),
        execute(input) {
          expect(
            input.grant.sources.map((source) => source.relativePath).sort(),
          ).toEqual(["Page.astro", "browser.ts", "helper.ts"]);
          const source = input.grant.sources.find(
            (entry) => entry.relativePath === "helper.ts",
          );
          if (source === undefined) throw new Error("Missing authorized import");
          expect(input.snapshot.read(source.handleId).content).toContain(
            'label = "Save"',
          );
          expect(() => input.snapshot.read("not-granted")).toThrow();
          return Promise.resolve({
            blocks: [
              {
                kind: "paragraph",
                text: "The imported label supplies the text.",
                citations: [{ handleId: source.handleId, startLine: 1, endLine: 1 }],
              },
            ],
            warnings: [],
          });
        },
      },
    ],
  });
  try {
    const job = await manager.create({
      schemaVersion: 1,
      requestId: "astro-request",
      envelope,
      executorId: "fixture",
      providerDataConsent: true,
    });
    const result = await manager.result(job.jobId);
    expect(result.snapshot.status).toBe("answered");
    expect(result.result?.sources).toMatchObject([
      { relativePath: "helper.ts", startLine: 1, endLine: 1 },
    ]);
    expect(JSON.stringify(result)).not.toContain(root);
    expect(await readFile(file, "utf8")).toBe(code);
  } finally {
    await manager.close();
    await rm(root, { recursive: true, force: true });
  }
});
