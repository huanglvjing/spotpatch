import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

// Linux and macOS Node/zlib builds differ slightly for the same bundle. The
// Base Runtime now includes the opt-in external-panel loader, floating-surface
// controller, status projection, and a no-motion execution fallback; the full
// execution island remains in the isolated Motion bundle. macOS Node 26
// measured 47,392 bytes, so 48 KiB preserves a bounded cross-platform margin.
const RUNTIME_GZIP_BUDGET_BYTES = 48 * 1024;
const DATA_FLOW_PRELUDE_GZIP_BUDGET_BYTES = 8 * 1024;
const DATA_FLOW_PANEL_GZIP_BUDGET_BYTES = 10 * 1024;
// ADR-038 keeps the managed-control UI in its existing dev-only lazy bundle.
// macOS Node 26 measured 14,366 bytes after strict protocol/result parsing;
// 16 KiB preserves a narrow cross-platform zlib margin without affecting core Runtime.
const EXTERNAL_HANDOFF_PANEL_GZIP_BUDGET_BYTES = 16 * 1024;
// GSAP Core, complete Shell/Scene implementation, and the execution-island
// renderer remain in a dev-only browser bundle. macOS Node 26 measured 34,057
// bytes after minification, so 35 KiB leaves a bounded margin.
const MOTION_GZIP_BUDGET_BYTES = 35 * 1024;
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
    expect(source).not.toContain("spotpatch-motion-signal");
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

  it("keeps GSAP and Shell scene effects in an isolated bounded bundle", async () => {
    const bundle = await readFile("packages/vite/dist/runtime-motion.js");
    const source = bundle.toString("utf8");
    const gzipBytes = gzipSync(bundle, { level: 9 }).byteLength;

    expect(
      gzipBytes,
      `runtime-motion.js gzip size was ${String(gzipBytes)} bytes`,
    ).toBeLessThan(MOTION_GZIP_BUDGET_BYTES);
    expect(source).toContain("spotpatch-motion-signal");
    expect(source).toContain("spotpatch-execution-island");
    for (const signature of serverOnlySignatures) {
      expect(source).not.toContain(signature);
    }
  });
});
