import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

const RUNTIME_GZIP_BUDGET_BYTES = 38 * 1024;
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
  });
});
