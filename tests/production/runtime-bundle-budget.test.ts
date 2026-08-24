import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

// Linux and macOS Node/zlib builds differ slightly for the same bundle. This
// ceiling includes the measured cross-platform variance while remaining tight.
const RUNTIME_GZIP_BUDGET_BYTES = 42 * 1024;
const DATA_FLOW_PRELUDE_GZIP_BUDGET_BYTES = 8 * 1024;
const DATA_FLOW_PANEL_GZIP_BUDGET_BYTES = 10 * 1024;
const EXTERNAL_HANDOFF_PANEL_GZIP_BUDGET_BYTES = 10 * 1024;
const serverOnlySignatures = [
  "launch-editor",
  "magic-string",
  "node:fs",
  "node:path",
  "oxc-parser",
  "zod",
] as const;

describe("runtime browser bundle budget", () => {
  it("stays below the gzip limit and excludes Node-only dependencies", async () => {
    const bundle = await readFile("packages/vite/dist/runtime-client.js");
    const source = bundle.toString("utf8");
    const gzipBytes = gzipSync(bundle, { level: 9 }).byteLength;

    expect(
      gzipBytes,
      `runtime-client.js gzip size was ${String(gzipBytes)} bytes`,
    ).toBeLessThan(RUNTIME_GZIP_BUDGET_BYTES);

    for (const signature of serverOnlySignatures) {
      expect(source).not.toContain(signature);
    }
    expect(source).not.toContain("spotpatch-data-flow-card");
    expect(source).not.toContain("spotpatch-external-handoff");
    expect(source).not.toContain("Send to Agent");
  });

  it("keeps the opt-in data-flow prelude isolated and small", async () => {
    const bundle = await readFile("packages/vite/dist/runtime-data-flow-prelude.js");
    const source = bundle.toString("utf8");
    const gzipBytes = gzipSync(bundle, { level: 9 }).byteLength;

    expect(
      gzipBytes,
      `runtime-data-flow-prelude.js gzip size was ${String(gzipBytes)} bytes`,
    ).toBeLessThan(DATA_FLOW_PRELUDE_GZIP_BUDGET_BYTES);
    for (const signature of serverOnlySignatures) {
      expect(source).not.toContain(signature);
    }
    expect(source).not.toContain("spotpatch-dialog");
  });

  it("loads the opt-in data-flow panel as a separate bounded bundle", async () => {
    const bundle = await readFile("packages/vite/dist/runtime-data-flow-panel.js");
    const source = bundle.toString("utf8");
    const gzipBytes = gzipSync(bundle, { level: 9 }).byteLength;

    expect(
      gzipBytes,
      `runtime-data-flow-panel.js gzip size was ${String(gzipBytes)} bytes`,
    ).toBeLessThan(DATA_FLOW_PANEL_GZIP_BUDGET_BYTES);
    expect(source).toContain("spotpatch-data-flow-card");
    for (const signature of serverOnlySignatures) {
      expect(source).not.toContain(signature);
    }
  });

  it("loads the opt-in external handoff panel as a separate bounded bundle", async () => {
    const bundle = await readFile(
      "packages/vite/dist/runtime-external-handoff-panel.js",
    );
    const source = bundle.toString("utf8");
    const gzipBytes = gzipSync(bundle, { level: 9 }).byteLength;

    expect(
      gzipBytes,
      `runtime-external-handoff-panel.js gzip size was ${String(gzipBytes)} bytes`,
    ).toBeLessThan(EXTERNAL_HANDOFF_PANEL_GZIP_BUDGET_BYTES);
    expect(source).toContain("spotpatch-external-handoff");
    expect(source).toContain("Send to Agent");
    for (const signature of serverOnlySignatures) {
      expect(source).not.toContain(signature);
    }
  });
});
