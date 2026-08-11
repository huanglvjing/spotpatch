import { describe, expect, it } from "vitest";

import { DEFAULT_AGENT_LIMITS, type SpotAnnotation } from "@spotpatch/shared";

import { createTestGitRepository } from "../test-utils/git-repository.js";
import { collectProjectConventions } from "./project-conventions.js";

const annotation = Object.freeze({
  schemaVersion: 3,
  id: "annotation",
  locale: "en-US",
  page: Object.freeze({
    url: "http://localhost:5173/",
    pathname: "/",
    title: "Fixture",
    viewportWidth: 1_440,
    viewportHeight: 900,
    devicePixelRatio: 2,
  }),
  targets: Object.freeze([
    Object.freeze({
      instruction: "Clarify the selected action.",
      source: Object.freeze({
        relativePath: "src/features/App.tsx",
        line: 1,
        column: 1,
        origin: "jsx-host" as const,
        confidence: "exact" as const,
      }),
      react: Object.freeze({ supported: true, componentStack: Object.freeze([]) }),
      element: Object.freeze({
        tagName: "button",
        selector: "button",
        sanitizedHtml: "<button>Save</button>",
        rect: Object.freeze({ x: 0, y: 0, width: 100, height: 40 }),
      }),
      styles: Object.freeze({
        classNames: Object.freeze([]),
        matchedRules: Object.freeze([]),
        computed: Object.freeze({}),
        warnings: Object.freeze([]),
      }),
      code: Object.freeze({
        relativePath: "src/features/App.tsx",
        language: "tsx" as const,
        startLine: 1,
        endLine: 1,
        excerpt: "export const App = () => <button>Save</button>;",
        boundary: "component" as const,
      }),
      warnings: Object.freeze([]),
    }),
  ]),
  createdAt: "2026-08-11T00:00:00.000Z",
}) satisfies SpotAnnotation;

describe("project conventions", () => {
  it("collects bounded nearest config, manifest metadata, and sibling examples", async () => {
    const repository = await createTestGitRepository({
      "package.json": JSON.stringify({
        name: "fixture",
        packageManager: "pnpm@10.0.0",
        scripts: { lint: "secret-command --token hidden", typecheck: "tsc" },
        dependencies: { react: "18.3.1" },
      }),
      ".editorconfig": "root = true\n[*]\nindent_size = 2\n",
      "eslint.config.mjs": "export default [{ rules: { eqeqeq: 'error' } }];\n",
      "src/features/tsconfig.json": '{"compilerOptions":{"strict":true}}\n',
      "src/features/App.tsx": "export const App = () => <button>Save</button>;\n",
      "src/features/Button.tsx":
        'export function Button() { return <button type="button" />; }\n',
      "src/features/App.test.tsx": "throw new Error('not a style example');\n",
      ".env.local": "PRIVATE_VALUE=hidden\n",
    });

    try {
      const context = await collectProjectConventions({
        root: repository.root,
        annotation,
        maximumFileBytes: DEFAULT_AGENT_LIMITS.maxReadBytesPerFile,
      });
      const paths = context.files.map((file) => file.path);
      const serialized = JSON.stringify(context);
      const manifest = context.files.find((file) => file.path === "package.json");

      expect(paths).toContain("src/features/tsconfig.json");
      expect(paths).toContain(".editorconfig");
      expect(paths).toContain("eslint.config.mjs");
      expect(paths).toContain("package.json");
      expect(paths).toContain("src/features/Button.tsx");
      expect(paths).not.toContain("src/features/App.test.tsx");
      expect(manifest?.content).toContain('"lint"');
      expect(manifest?.content).toContain('"react"');
      expect(serialized).not.toContain("secret-command");
      expect(serialized).not.toContain("PRIVATE_VALUE");
    } finally {
      await repository.cleanup();
    }
  });
});
