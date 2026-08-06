import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  SOURCE_MARKER_ATTRIBUTE,
  SPOTPATCH_API_BASE,
  SPOTPATCH_TOKEN_HEADER,
} from "@spotpatch/shared";
import react from "@vitejs/plugin-react-swc";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";

import { spotPatch } from "../../packages/vite/src/index.js";

const forbiddenPatterns = [
  SOURCE_MARKER_ATTRIBUTE,
  SPOTPATCH_API_BASE,
  "spotpatch.runtime",
  SPOTPATCH_TOKEN_HEADER,
] as const;

let outputDirectory = "";
let productionOutput = "";

async function readTree(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? readTree(entryPath) : readFile(entryPath, "utf8");
    }),
  );

  return contents.join("\n");
}

beforeAll(async () => {
  outputDirectory = await mkdtemp(path.join(tmpdir(), "spotpatch-production-"));
  const playgroundRoot = path.resolve("playgrounds/minimal-react-18");

  await build({
    configFile: false,
    root: playgroundRoot,
    logLevel: "silent",
    plugins: [spotPatch(), react()],
    build: {
      emptyOutDir: true,
      outDir: outputDirectory,
    },
  });

  productionOutput = await readTree(outputDirectory);
}, 60_000);

afterAll(async () => {
  if (outputDirectory.length > 0) {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

describe("production build isolation", () => {
  it.each(forbiddenPatterns)("contains zero occurrences of %s", (pattern) => {
    expect(productionOutput).not.toContain(pattern);
  });
});
