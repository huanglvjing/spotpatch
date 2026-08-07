import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  ERROR_CODES,
  SpotPatchError,
  agentJobCreateRequestSchema,
  type ErrorCode,
} from "@spotpatch/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveOptions } from "../options.js";
import {
  createSourceRegistry,
  type SourceRegistry,
} from "../registry/source-registry.js";
import { authorizeAgentJobRequest } from "./agent-request.js";

let root = "";
let fileId = "";
let registry: SourceRegistry;

function request(overrides: Readonly<Record<string, unknown>> = {}) {
  return agentJobCreateRequestSchema.parse({
    annotation: {
      schemaVersion: 1,
      id: "annotation-id",
      note: "Update this component.",
      page: {
        url: "http://localhost:5173/",
        pathname: "/",
        title: "Fixture",
        viewportWidth: 1_440,
        viewportHeight: 900,
        devicePixelRatio: 2,
      },
      source: {
        fileId,
        relativePath: "src/App.tsx",
        line: 3,
        column: 5,
        origin: "jsx-host",
        confidence: "exact",
      },
      react: {
        supported: true,
        componentName: "App",
        componentStack: ["App"],
      },
      element: {
        tagName: "button",
        selector: "button",
        sanitizedHtml: "<button>Save</button>",
        rect: { x: 10, y: 20, width: 100, height: 40 },
      },
      styles: {
        classNames: [],
        matchedRules: [],
        computed: { display: "block" },
        warnings: [],
      },
      code: {
        relativePath: "src/App.tsx",
        language: "tsx",
        startLine: 1,
        endLine: 1,
        excerpt: "forged browser excerpt",
        boundary: "nearby-lines",
      },
      warnings: [],
      createdAt: "2026-08-07T00:00:00.000Z",
      ...overrides,
    },
    providerProfileId: "relay",
    modelProfileId: "coder",
    providerDataConsent: true,
  });
}

async function expectErrorCode(
  promise: Promise<unknown>,
  code: ErrorCode,
): Promise<void> {
  try {
    await promise;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(SpotPatchError);
    expect((error as SpotPatchError).code).toBe(code);
    return;
  }

  throw new Error("Expected request authorization to fail.");
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "spotpatch-agent-request-"));
  await mkdir(path.join(root, "src"));
  const sourcePath = path.join(root, "src", "App.tsx");
  await writeFile(
    sourcePath,
    [
      "export function App(): JSX.Element {",
      "  return (",
      "    <button>Save</button>",
      "  );",
      "}",
    ].join("\n"),
    "utf8",
  );
  registry = createSourceRegistry();
  fileId = registry.register(sourcePath);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("Agent job request authorization", () => {
  it("re-resolves the opaque source ID and replaces browser code with current source", async () => {
    const authorized = await authorizeAgentJobRequest({
      request: request(),
      options: resolveOptions(),
      registry,
      root,
    });

    expect(authorized.annotation.source.relativePath).toBe("src/App.tsx");
    expect(authorized.annotation.code?.excerpt).toContain("<button>Save</button>");
    expect(authorized.annotation.code?.excerpt).not.toContain("forged browser excerpt");
    expect(Object.isFrozen(authorized)).toBe(true);
    expect(Object.isFrozen(authorized.annotation.styles.computed)).toBe(true);
  });

  it("rejects a forged display path for a valid opaque source ID", async () => {
    await expectErrorCode(
      authorizeAgentJobRequest({
        request: request({
          source: {
            fileId,
            relativePath: "src/Other.tsx",
            line: 3,
            column: 5,
            origin: "jsx-host",
            confidence: "exact",
          },
        }),
        options: resolveOptions(),
        registry,
        root,
      }),
      ERROR_CODES.INVALID_REQUEST,
    );
  });

  it("rejects unknown source IDs and marker origins without coordinates", async () => {
    await expectErrorCode(
      authorizeAgentJobRequest({
        request: request({
          source: {
            fileId: "unknown-source",
            line: 3,
            column: 5,
            origin: "jsx-host",
            confidence: "exact",
          },
        }),
        options: resolveOptions(),
        registry,
        root,
      }),
      ERROR_CODES.SOURCE_NOT_FOUND,
    );
    await expectErrorCode(
      authorizeAgentJobRequest({
        request: request({
          source: {
            fileId,
            origin: "jsx-host",
            confidence: "exact",
          },
          code: undefined,
        }),
        options: resolveOptions(),
        registry,
        root,
      }),
      ERROR_CODES.INVALID_REQUEST,
    );
  });

  it("rejects code context that is not backed by an authorized marker", async () => {
    await expectErrorCode(
      authorizeAgentJobRequest({
        request: request({
          source: { origin: "none", confidence: "unknown" },
        }),
        options: resolveOptions(),
        registry,
        root,
      }),
      ERROR_CODES.INVALID_REQUEST,
    );
  });
});
