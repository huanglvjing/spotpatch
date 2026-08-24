import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyNextIntegrationPlan,
  checkNextIntegration,
  planNextIntegration,
} from "./initializer.js";

const roots: string[] = [];
const execFileAsync = promisify(execFile);

async function fixture(input?: {
  readonly config?: string;
  readonly instrumentation?: string;
  readonly script?: string;
  readonly trustedFastMode?: boolean;
}): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "spotpatch-next-init-"));
  roots.push(root);
  await execFileAsync("git", ["init", "--quiet"], { cwd: root });
  await mkdir(path.join(root, "src", "app"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify(
      {
        name: "fixture",
        private: true,
        scripts: { dev: input?.script ?? "next dev" },
        devDependencies: {
          "@spotpatch/next": "0.0.0",
          ...(input?.trustedFastMode ? { typescript: "0.0.0" } : {}),
        },
      },
      undefined,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(root, "next.config.ts"),
    input?.config ??
      'import type { NextConfig } from "next";\n\nconst config: NextConfig = {};\n\nexport default config;\n',
  );

  if (input?.instrumentation !== undefined) {
    await writeFile(
      path.join(root, "src", "instrumentation-client.ts"),
      input.instrumentation,
    );
  }

  if (input?.trustedFastMode) {
    const packageRoot = path.join(root, "node_modules", "typescript");
    await mkdir(path.join(packageRoot, "bin"), { recursive: true });
    await writeFile(path.join(root, "tsconfig.json"), "{}\n");
    await writeFile(
      path.join(packageRoot, "package.json"),
      '{"name":"typescript","version":"0.0.0"}\n',
    );
    await writeFile(path.join(packageRoot, "bin", "tsc"), "process.exit(0);\n");
  }

  return root;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Next integration initializer", () => {
  it("creates a formatted instrumentation entry when none exists", async () => {
    const root = await fixture();
    const plan = await planNextIntegration(root);
    const instrumentation = plan.changes.find(
      (change) => change.relativePath === "src/instrumentation-client.ts",
    )?.nextContent;

    expect(instrumentation).toBe('import "@spotpatch/next/client";\n');
  });

  it("plans, applies, and idempotently checks a typed src project", async () => {
    const root = await fixture({
      instrumentation: 'console.info("host instrumentation");\n',
    });
    const plan = await planNextIntegration(root);

    expect(plan.changes.map((change) => change.relativePath).sort()).toEqual([
      "next.config.ts",
      "package.json",
      "src/instrumentation-client.ts",
    ]);
    await applyNextIntegrationPlan(plan);

    expect(await readFile(path.join(root, "next.config.ts"), "utf8")).toContain(
      'import { withSpotPatch } from "@spotpatch/next";',
    );
    expect(await readFile(path.join(root, "next.config.ts"), "utf8")).toContain(
      "export default withSpotPatch()(config);",
    );
    expect(
      await readFile(path.join(root, "src", "instrumentation-client.ts"), "utf8"),
    ).toBe(
      'import "@spotpatch/next/client";\n\nconsole.info("host instrumentation");\n',
    );
    expect(
      JSON.parse(await readFile(path.join(root, "package.json"), "utf8")),
    ).toMatchObject({ scripts: { dev: "spotpatch-next dev" } });
    await expect(checkNextIntegration(root)).resolves.toMatchObject({ ok: true });
    await expect(planNextIntegration(root)).resolves.toMatchObject({ changes: [] });
  });

  it("uses a collision-free wrapper import and preserves dev arguments", async () => {
    const root = await fixture({
      config:
        'const withSpotPatch = "host";\nconst config = {};\nexport default config;\n',
      script: "next dev --webpack --port=3100",
    });
    const plan = await planNextIntegration(root);
    const config = plan.changes.find(
      (change) => change.relativePath === "next.config.ts",
    )?.nextContent;
    const manifest = plan.changes.find(
      (change) => change.relativePath === "package.json",
    )?.nextContent;

    expect(config).toContain(
      'import { withSpotPatch as withSpotPatch1 } from "@spotpatch/next";',
    );
    expect(config).toContain("export default withSpotPatch1()(config);");
    expect(JSON.parse(manifest ?? "{}")).toMatchObject({
      scripts: { dev: "spotpatch-next dev --webpack --port=3100" },
    });
  });

  it("does not treat a type-only client import as runtime initialization", async () => {
    const root = await fixture({
      instrumentation:
        'import type { ClientMarker } from "@spotpatch/next/client";\n\nexport type Marker = ClientMarker;\n',
    });
    const plan = await planNextIntegration(root);
    const instrumentation = plan.changes.find(
      (change) => change.relativePath === "src/instrumentation-client.ts",
    )?.nextContent;

    expect(instrumentation).toBe(
      'import type { ClientMarker } from "@spotpatch/next/client";\nimport "@spotpatch/next/client";\n\nexport type Marker = ClientMarker;\n',
    );
  });

  it("upgrades a zero-config wrapper to expose the page quick-mode selector", async () => {
    const root = await fixture({
      config:
        'import { withSpotPatch } from "@spotpatch/next";\nconst config = {};\nexport default withSpotPatch()(config);\n',
      trustedFastMode: true,
    });
    const plan = await planNextIntegration(root);
    const config = plan.changes.find(
      (change) => change.relativePath === "next.config.ts",
    )?.nextContent;

    expect(plan.trustedFastModeAvailable).toBe(true);
    expect(config).toContain("withSpotPatch({ trustedFastMode: true })(config)");
  });

  it("rejects a static component data-flow option that Next cannot execute", async () => {
    const root = await fixture({
      config:
        'import { withSpotPatch } from "@spotpatch/next";\nconst config = {};\nexport default withSpotPatch({ dataFlow: {} })(config);\n',
    });

    await expect(planNextIntegration(root)).rejects.toThrow(
      /does not support component dataFlow/u,
    );
  });

  it("fails closed before writes for unsupported config and shell scripts", async () => {
    const functionRoot = await fixture({
      config: "export default function config() { return {}; }\n",
    });
    const shellRoot = await fixture({ script: "next dev && echo unsafe" });
    const originalConfig = await readFile(
      path.join(functionRoot, "next.config.ts"),
      "utf8",
    );

    await expect(planNextIntegration(functionRoot)).rejects.toThrow(
      /cannot safely wrap/u,
    );
    await expect(planNextIntegration(shellRoot)).rejects.toThrow(/only rewrites/u);
    await expect(
      readFile(path.join(functionRoot, "next.config.ts"), "utf8"),
    ).resolves.toBe(originalConfig);
  });
});
