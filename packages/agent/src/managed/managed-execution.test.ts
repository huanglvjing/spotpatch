import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { DEFAULT_AGENT_LIMITS, ERROR_CODES } from "@spotpatch/shared";
import { describe, expect, it, vi } from "vitest";

import { createTestGitRepository } from "../test-utils/git-repository.js";
import { GIT_PROCESS_INTEGRATION_TIMEOUT_MS } from "../test-utils/test-timeouts.js";
import { runGitCommand } from "../worktree/git-command.js";
import {
  createManagedExecutionRunner,
  type AuthorizedManagedTask,
} from "./managed-execution.js";

vi.setConfig({ testTimeout: GIT_PROCESS_INTEGRATION_TIMEOUT_MS });

const annotation = {
  schemaVersion: 3,
  id: "managed-annotation",
  locale: "en-US",
  page: {
    url: "http://localhost:3000/",
    pathname: "/",
    title: "Fixture",
    viewportWidth: 1_440,
    viewportHeight: 900,
    devicePixelRatio: 2,
  },
  targets: [
    {
      instruction: "Change the selected label to After.",
      source: {
        relativePath: "src/App.tsx",
        line: 1,
        column: 1,
        origin: "jsx-host",
        confidence: "exact",
      },
      react: { supported: true, componentStack: [] },
      element: {
        tagName: "button",
        selector: "button",
        sanitizedHtml: "<button>Before</button>",
        rect: { x: 0, y: 0, width: 100, height: 40 },
      },
      styles: {
        classNames: [],
        matchedRules: [],
        computed: {},
        warnings: [],
      },
      code: {
        relativePath: "src/App.tsx",
        language: "tsx",
        startLine: 1,
        endLine: 1,
        excerpt: "export const App = () => <button>Before</button>;",
        boundary: "component",
      },
      warnings: [],
    },
  ],
  createdAt: "2026-08-25T00:00:00.000Z",
} satisfies AuthorizedManagedTask["annotation"];

async function writeManagedResult(workspaceRoot: string): Promise<void> {
  await writeFile(
    path.join(workspaceRoot, "src/App.tsx"),
    "export const App = () => <button>After</button>;\n",
    "utf8",
  );
}

describe("managed execution runner", () => {
  it("keeps the business repository unchanged without explicit required checks", async () => {
    const repository = await createTestGitRepository();
    const runner = createManagedExecutionRunner({ root: repository.root });

    try {
      const task = await runner.prepare(
        { annotation, revision: 1 },
        new AbortController().signal,
      );
      expect(task.prompt).toContain("Allowed paths:\n- src/App.tsx");
      expect(task.prompt).not.toContain(repository.root);
      await writeManagedResult(task.workspaceRoot);
      const result = await runner.auditAndApply(task, new AbortController().signal);

      expect(result.validationOutcome).toBe("not-configured");
      expect(result.applied).toBe(false);
      expect(await repository.read("src/App.tsx")).toContain("Before");
    } finally {
      await runner.dispose();
      await repository.cleanup();
    }
  });

  it("reports an empty or non-modifying candidate as a validation failure", async () => {
    const repository = await createTestGitRepository();
    const runner = createManagedExecutionRunner({ root: repository.root });

    try {
      const task = await runner.prepare(
        { annotation, revision: 0 },
        new AbortController().signal,
      );

      await expect(
        runner.auditAndApply(task, new AbortController().signal),
      ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
      expect(await repository.read("src/App.tsx")).toContain("Before");
    } finally {
      await runner.dispose();
      await repository.cleanup();
    }
  });

  it("applies an audited modification only after a required check passes", async () => {
    const repository = await createTestGitRepository();
    const runner = createManagedExecutionRunner({
      root: repository.root,
      checks: Object.freeze({
        fixture: Object.freeze({
          id: "fixture",
          label: "Fixture validation",
          command: process.execPath,
          args: Object.freeze(["-e", "process.exit(0)"]),
          required: true,
          timeoutMs: 10_000,
        }),
      }),
      limits: DEFAULT_AGENT_LIMITS,
    });

    try {
      const task = await runner.prepare(
        { annotation, revision: 2 },
        new AbortController().signal,
      );
      await writeManagedResult(task.workspaceRoot);
      const phases: string[] = [];
      const result = await runner.auditAndApply(
        task,
        new AbortController().signal,
        (phase) => phases.push(phase),
      );

      expect(result.validationOutcome).toBe("passed");
      expect(result.applied).toBe(true);
      expect(phases).toEqual(["validating", "applying"]);
      expect(Object.values(result.timings).every(Number.isFinite)).toBe(true);
      expect(result.timings).toHaveProperty("applying");
      expect(result.checks).toEqual([
        expect.objectContaining({ id: "fixture", outcome: "passed", exitCode: 0 }),
      ]);
      expect(await repository.read("src/App.tsx")).toContain("After");
    } finally {
      await runner.dispose();
      await repository.cleanup();
    }
  });

  it.each([
    { framework: "typescript", relativeRoot: "." },
    { framework: "astro", relativeRoot: "." },
    { framework: "astro", relativeRoot: "apps/site" },
  ] as const)(
    "exposes dependencies to a fixed $framework check in $relativeRoot only after the Agent turn",
    async ({ framework, relativeRoot }) => {
      const sourcePath = path.posix.join(relativeRoot, "src/App.tsx");
      const repository = await createTestGitRepository({
        [sourcePath]: "export const App = () => <button>Before</button>;\n",
        [path.posix.join(relativeRoot, "tsconfig.json")]: "{}\n",
      });
      const typeScriptCli = path.join(
        repository.root,
        "node_modules",
        ...(framework === "typescript" ? ["typescript"] : ["@astrojs", "check"]),
        "bin",
        framework === "typescript" ? "tsc" : "astro-check.js",
      );
      await mkdir(path.dirname(typeScriptCli), { recursive: true });
      if (framework === "astro") {
        const packageRoot = path.dirname(path.dirname(typeScriptCli));
        await mkdir(path.join(packageRoot, "dist"));
        await writeFile(
          path.join(packageRoot, "package.json"),
          JSON.stringify({ main: "dist/index.js" }),
        );
        await writeFile(path.join(packageRoot, "dist/index.js"), "");
      }
      await mkdir(path.join(repository.root, "node_modules", "fixture-dependency"), {
        recursive: true,
      });
      await writeFile(
        path.join(repository.root, "node_modules", "fixture-dependency", "marker"),
        "installed\n",
      );
      await writeFile(
        typeScriptCli,
        [
          'const { existsSync } = require("node:fs");',
          'const path = require("node:path");',
          'const marker = path.join(process.cwd(), "node_modules", "fixture-dependency", "marker");',
          "process.exit(existsSync(marker) ? 0 : 1);",
        ].join("\n"),
      );
      const runner = createManagedExecutionRunner({
        root: path.join(repository.root, relativeRoot),
        checks: Object.freeze({
          "spotpatch-typecheck": Object.freeze({
            id: "spotpatch-typecheck",
            label: "TypeScript",
            command: process.execPath,
            args: Object.freeze([
              typeScriptCli,
              ...(framework === "astro"
                ? [
                    "--minimumFailingSeverity",
                    "error",
                    "--root",
                    relativeRoot,
                    "--tsconfig",
                    "tsconfig.json",
                  ]
                : [
                    "--noEmit",
                    "--pretty",
                    "false",
                    "--incremental",
                    "false",
                    "--project",
                    "tsconfig.json",
                  ]),
            ]),
            required: true,
            timeoutMs: 10_000,
          }),
        }),
      });

      try {
        const task = await runner.prepare(
          { annotation, revision: 20 },
          new AbortController().signal,
        );
        await expect(
          access(path.join(task.workspaceRoot, "node_modules")),
        ).rejects.toMatchObject({ code: "ENOENT" });
        await writeManagedResult(task.workspaceRoot);
        const result = await runner.auditAndApply(task, new AbortController().signal);

        expect(result.validationOutcome).toBe("passed");
        expect(result.applied).toBe(true);
        expect(await repository.read(sourcePath)).toContain("After");
        await expect(
          access(path.join(task.workspaceRoot, "node_modules")),
        ).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await runner.dispose();
        await repository.cleanup();
      }
    },
  );

  it("applies a clean target without exposing or changing unrelated staged work", async () => {
    const repository = await createTestGitRepository({
      "notes.txt": "Committed notes.\n",
      "src/App.tsx": "export const App = () => <button>Before</button>;\n",
    });
    await repository.write("notes.txt", "User staged notes.\n");
    await runGitCommand({ cwd: repository.root, args: ["add", "notes.txt"] });
    const stagedBefore = await runGitCommand({
      cwd: repository.root,
      args: ["diff", "--cached", "--binary", "--full-index", "--", "notes.txt"],
    });
    const runner = createManagedExecutionRunner({
      root: repository.root,
      checks: Object.freeze({
        fixture: Object.freeze({
          id: "fixture",
          label: "Fixture validation",
          command: process.execPath,
          args: Object.freeze(["-e", "process.exit(0)"]),
          required: true,
          timeoutMs: 10_000,
        }),
      }),
    });

    try {
      const task = await runner.prepare(
        { annotation, revision: 5 },
        new AbortController().signal,
      );
      expect(await repository.read("notes.txt")).toBe("User staged notes.\n");
      expect(await readFile(path.join(task.workspaceRoot, "notes.txt"), "utf8")).toBe(
        "Committed notes.\n",
      );
      await writeManagedResult(task.workspaceRoot);
      const result = await runner.auditAndApply(task, new AbortController().signal);

      expect(result.applied).toBe(true);
      expect(await repository.read("src/App.tsx")).toContain("After");
      expect(await repository.read("notes.txt")).toBe("User staged notes.\n");
      expect(
        await runGitCommand({
          cwd: repository.root,
          args: ["diff", "--cached", "--binary", "--full-index", "--", "notes.txt"],
        }),
      ).toBe(stagedBefore);
    } finally {
      await runner.dispose();
      await repository.cleanup();
    }
  });

  it("keeps project-relative scope correct when the project is a Git subdirectory", async () => {
    const repository = await createTestGitRepository({
      "packages/app/src/App.tsx": "export const App = () => <button>Before</button>;\n",
    });
    const projectRoot = path.join(repository.root, "packages", "app");
    const runner = createManagedExecutionRunner({
      root: projectRoot,
      checks: Object.freeze({
        fixture: Object.freeze({
          id: "fixture",
          label: "Fixture validation",
          command: process.execPath,
          args: Object.freeze(["-e", "process.exit(0)"]),
          required: true,
          timeoutMs: 10_000,
        }),
      }),
    });

    try {
      const task = await runner.prepare(
        { annotation, revision: 4 },
        new AbortController().signal,
      );
      expect(task.workspaceRoot.endsWith(path.join("packages", "app"))).toBe(true);
      expect(task.prompt).toContain("Allowed paths:\n- src/App.tsx");
      await writeManagedResult(task.workspaceRoot);
      const result = await runner.auditAndApply(task, new AbortController().signal);

      expect(result.applied).toBe(true);
      expect(result.files).toEqual([expect.objectContaining({ path: "src/App.tsx" })]);
      expect(result.diff).toContain("packages/app/src/App.tsx");
      expect(await repository.read("packages/app/src/App.tsx")).toContain("After");
    } finally {
      await runner.dispose();
      await repository.cleanup();
    }
  });

  it.each(["outside", "ignored"] as const)(
    "rejects %s artifacts without changing the business repository",
    async (kind) => {
      const repository = await createTestGitRepository({
        ".gitignore": ".pnpm-store/\n",
        "src/App.tsx": "export const App = () => <button>Before</button>;\n",
      });
      const runner = createManagedExecutionRunner({ root: repository.root });

      try {
        const task = await runner.prepare(
          { annotation, revision: 3 },
          new AbortController().signal,
        );
        await writeManagedResult(task.workspaceRoot);
        if (kind === "outside") {
          await writeFile(
            path.join(task.workspaceRoot, "unrelated.ts"),
            "export {};\n",
          );
        } else {
          const store = path.join(task.workspaceRoot, ".pnpm-store");
          await mkdir(store);
          await writeFile(path.join(store, "cache"), "pollution");
        }

        await expect(
          runner.auditAndApply(task, new AbortController().signal),
        ).rejects.toMatchObject({ code: ERROR_CODES.PATCH_REJECTED });
        expect(await repository.read("src/App.tsx")).toContain("Before");
      } finally {
        await runner.dispose();
        await repository.cleanup();
      }
    },
  );
});
