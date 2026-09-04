import { link, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  spotSelectionContextSchema,
  type SpotSelectionContext,
} from "@spotpatch/shared";
import { afterEach, describe, expect, it } from "vitest";

import { createSourceRegistry } from "../registry/source-registry.js";
import { ContextualAskError } from "./error.js";
import { captureAskReadSnapshot } from "./read-snapshot.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => rm(root, { recursive: true })));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "spotpatch-ask-"));
  roots.push(root);
  await mkdir(path.join(root, "src"));
  return root;
}

function selection(
  fileId: string,
  overrides: Readonly<{
    componentSourceId?: string;
    matchedStyleSource?: string;
    sourceVersion?: string;
  }> = {},
): SpotSelectionContext {
  return spotSelectionContextSchema.parse({
    schemaVersion: 1,
    selectionId: "selection-1",
    locale: "zh-CN",
    createdAt: "2026-09-01T00:00:00.000Z",
    targets: [
      {
        targetId: "target-1",
        page: {
          url: "http://localhost:3000/",
          pathname: "/",
          title: "Fixture",
          viewportWidth: 1280,
          viewportHeight: 720,
          devicePixelRatio: 1,
        },
        source: {
          fileId,
          relativePath: "src/App.tsx",
          line: 1,
          column: 1,
          origin: "jsx-host",
          confidence: "exact",
        },
        react: {
          supported: true,
          componentStack: ["App"],
          ...(overrides.componentSourceId === undefined
            ? {}
            : { componentSourceId: overrides.componentSourceId }),
          ...(overrides.sourceVersion === undefined
            ? {}
            : { sourceVersion: overrides.sourceVersion }),
        },
        element: {
          tagName: "button",
          selector: "button",
          sanitizedHtml: "<button>Save</button>",
          rect: { x: 0, y: 0, width: 100, height: 40 },
        },
        styles: {
          classNames: [],
          matchedRules:
            overrides.matchedStyleSource === undefined
              ? []
              : [
                  {
                    selector: "button",
                    declarations: "color: red",
                    source: overrides.matchedStyleSource,
                  },
                ],
          computed: {},
          warnings: [],
        },
        code: {
          relativePath: "src/App.tsx",
          language: "tsx",
          startLine: 1,
          endLine: 2,
          excerpt:
            "import { label } from './label';\nexport const App = () => <button>{label}</button>;",
          boundary: "nearby-lines",
        },
        warnings: [],
      },
    ],
  });
}

describe("captureAskReadSnapshot", () => {
  it("captures target-first relative imports and keeps reads immutable", async () => {
    const root = await fixture();
    const appPath = path.join(root, "src/App.tsx");
    const labelPath = path.join(root, "src/label.ts");
    const stylePath = path.join(root, "src/App.css");
    await writeFile(
      appPath,
      "import { label } from './label';\nexport const App = () => <button>{label}</button>;\n",
    );
    await writeFile(labelPath, "export const label = 'Save';\n");
    await writeFile(stylePath, "button { color: red; }\n");
    const registry = createSourceRegistry();
    const fileId = registry.register(appPath);
    registry.register(stylePath);
    let handle = 0;
    const captured = await captureAskReadSnapshot({
      root,
      registry,
      selection: selection(fileId, { matchedStyleSource: "src/App.css" }),
      createHandleId: () => `handle-${String(++handle)}`,
    });

    expect(captured.grant.sources.map((source) => source.relativePath)).toEqual([
      "src/App.tsx",
      "src/App.css",
      "src/label.ts",
    ]);
    expect(JSON.stringify(captured.grant)).not.toContain(root);
    const targetHandle = captured.grant.sources[0]?.handleId;
    expect(targetHandle).toBeDefined();
    await writeFile(appPath, "export const App = () => null;\n");
    expect(captured.snapshot.read(targetHandle ?? "").content).toContain("<button>");
    await expect(captured.isStale()).resolves.toBe(true);
    expect(() => captured.snapshot.read("forged-handle")).toThrowError(
      ContextualAskError,
    );
  });

  it("rejects a stale component sourceVersion", async () => {
    const root = await fixture();
    const appPath = path.join(root, "src/App.tsx");
    await writeFile(appPath, "export const App = () => null;\n");
    const registry = createSourceRegistry();
    registry.registerDataFlowComponents(appPath, "version-current", [
      { componentSourceId: "component-1", line: 1, column: 1 },
    ]);
    const fileId = registry.findRegisteredId(appPath);

    await expect(
      captureAskReadSnapshot({
        root,
        registry,
        selection: selection(fileId ?? "", {
          componentSourceId: "component-1",
          sourceVersion: "version-stale",
        }),
      }),
    ).rejects.toMatchObject({ code: "ASK_SELECTION_STALE" });
  });

  it("rejects stale code evidence even without a component sourceVersion", async () => {
    const root = await fixture();
    const appPath = path.join(root, "src/App.tsx");
    await writeFile(appPath, "export const App = () => <button>Changed</button>;\n");
    const registry = createSourceRegistry();
    const fileId = registry.register(appPath);

    await expect(
      captureAskReadSnapshot({ root, registry, selection: selection(fileId) }),
    ).rejects.toMatchObject({ code: "ASK_SELECTION_STALE" });
  });

  it("fails closed for hard-linked selected files", async () => {
    const root = await fixture();
    const appPath = path.join(root, "src/App.tsx");
    await writeFile(appPath, "export const App = () => null;\n");
    await link(appPath, path.join(root, "src/App-copy.tsx"));
    const registry = createSourceRegistry();
    const fileId = registry.register(appPath);

    await expect(
      captureAskReadSnapshot({ root, registry, selection: selection(fileId) }),
    ).rejects.toMatchObject({ code: "ASK_SOURCE_SCOPE_DENIED" });
  });
});
