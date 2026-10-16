import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { describe, it } from "vitest";

import {
  reserveLoopbackPort,
  startNodeCommand,
  stopNodeCommand,
  type RunningProcess,
} from "../../experiments/next-adapter/src/process-control.js";
import { verifyRepeatedInstanceSelection } from "../helpers/repeated-instance-browser.js";

const root = fileURLToPath(new URL("../../", import.meta.url));

async function prepareFixture(directory: string): Promise<void> {
  await mkdir(path.join(directory, "app"));
  await mkdir(path.join(directory, "node_modules/@spotpatch"), { recursive: true });
  await mkdir(path.join(directory, "node_modules/@types"), { recursive: true });
  const packages = [
    ["next", "packages/next/node_modules/next"],
    ["react", "packages/next/node_modules/react"],
    ["react-dom", "packages/next/node_modules/react-dom"],
    ["typescript", "node_modules/typescript"],
    ["@types/react", "node_modules/@types/react"],
    ["@types/node", "node_modules/@types/node"],
    ["@spotpatch/next", "packages/next"],
  ] as const;
  for (const [name, source] of packages) {
    await symlink(
      await realpath(path.join(root, source)),
      path.join(directory, "node_modules", name),
      process.platform === "win32" ? "junction" : "dir",
    );
  }
  const cardSource = await readFile(
    path.join(root, "playgrounds/minimal-react-18/src/repeated-cards.tsx"),
    "utf8",
  );
  await Promise.all([
    writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({
        name: "spotpatch-next-instance-fixture",
        private: true,
        type: "module",
        scripts: { dev: "spotpatch-next dev" },
        devDependencies: { "@spotpatch/next": "workspace:*" },
      }),
    ),
    writeFile(
      path.join(directory, "next.config.mjs"),
      `import { withSpotPatch } from '@spotpatch/next';\nexport default withSpotPatch({ ai: false, locale: 'en-US', dataFlow: {}, externalAgent: true })({ turbopack: { root: ${JSON.stringify(root)} } });\n`,
    ),
    writeFile(
      path.join(directory, "instrumentation-client.ts"),
      'import "@spotpatch/next/client";\n',
    ),
    writeFile(
      path.join(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          jsx: "preserve",
          module: "esnext",
          moduleResolution: "bundler",
          strict: true,
          skipLibCheck: true,
          esModuleInterop: true,
          noEmit: true,
        },
      }),
    ),
    writeFile(
      path.join(directory, "app/layout.tsx"),
      'import type { ReactNode } from "react";\nexport default function Layout({ children }: { children: ReactNode }) { return <html lang="en-US"><body>{children}</body></html>; }\n',
    ),
    writeFile(
      path.join(directory, "app/page.tsx"),
      'import { RepeatedCardsFixture } from "./repeated-cards";\nexport default function Page() { return <RepeatedCardsFixture />; }\n',
    ),
    writeFile(
      path.join(directory, "app/repeated-cards.tsx"),
      `"use client";\n${cardSource}`,
    ),
  ]);
}

async function waitForReady(process: RunningProcess): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (!process.getLogs().includes("[spotpatch:next] ready")) {
    if (process.child.exitCode !== null || Date.now() >= deadline) {
      throw new Error(`Next public entry did not become ready:\n${process.getLogs()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe("Next public entry repeated instances", () => {
  it.each(["webpack", "turbopack"])(
    "preserves instance evidence through %s and the public Runtime",
    async (bundler) => {
      const directory = await mkdtemp(path.join(root, "playgrounds/instance-next-"));
      const browser = await chromium.launch();
      let server: RunningProcess | undefined;
      try {
        await prepareFixture(directory);
        const port = await reserveLoopbackPort();
        server = startNodeCommand({
          cwd: directory,
          entry: path.join(root, "packages/next/dist/cli.js"),
          args: [
            "dev",
            `--${bundler}`,
            "--hostname",
            "127.0.0.1",
            "--port",
            String(port),
          ],
        });
        await waitForReady(server);
        const page = await browser.newPage();
        await page.goto(`http://127.0.0.1:${String(port)}`, { timeout: 90_000 });
        await verifyRepeatedInstanceSelection(page);
      } catch (error: unknown) {
        throw new Error(
          `Repeated instance browser verification failed:\n${server?.getLogs() ?? "No server started."}`,
          { cause: error },
        );
      } finally {
        await browser.close();
        if (server !== undefined) await stopNodeCommand(server);
        await rm(directory, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
