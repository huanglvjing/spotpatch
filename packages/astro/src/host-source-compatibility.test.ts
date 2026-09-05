import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { transform } from "@astrojs/compiler-rs";
import { expect, it } from "vitest";

import { injectAstroSourceMarkers } from "./astro-source-markers.js";

async function astroFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(directory, entry.name);
      if (
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        entry.name !== "node_modules"
      )
        return astroFiles(file);
      return entry.isFile() && entry.name.endsWith(".astro") ? [file] : [];
    }),
  );
  return files.flat();
}

// Optional, read-only acceptance against real host source. No config, .env,
// dependency installation, source edits or dev-server startup is involved.
const sourceDirectory = process.env.SPOTPATCH_ASTRO_SOURCE_DIR;
it.skipIf(sourceDirectory === undefined)(
  "preserves and compiles real host Astro templates",
  async () => {
    if (sourceDirectory === undefined)
      throw new Error("Provide an Astro source directory.");
    const root = path.resolve(sourceDirectory);
    const files = await astroFiles(root);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const code = await readFile(file, "utf8");
      const result = injectAstroSourceMarkers({
        code,
        absolutePath: file,
        root,
        fileId: "acceptance-probe",
      });
      if (result === undefined) continue;
      expect(
        result.code.replace(
          / data-spotpatch-source="acceptance-probe:[0-9]+:[0-9]+:astro"/gu,
          "",
        ),
        path.relative(root, file),
      ).toBe(code);
      expect(
        transform(result.code, { filename: file }).code.length,
        path.relative(root, file),
      ).toBeGreaterThan(0);
      const instrumented = injectAstroSourceMarkers({
        code,
        absolutePath: file,
        root,
        fileId: "acceptance-probe",
        dataFlow: { helperModule: "virtual:spotpatch-data-flow" },
      });
      expect(
        transform(instrumented?.code ?? code, { filename: file }).code.length,
        `Data-flow instrumentation: ${path.relative(root, file)}`,
      ).toBeGreaterThan(0);
    }
    console.info(
      `Read-only Astro source acceptance: ${String(files.length)} templates.`,
    );
  },
  30_000,
);
