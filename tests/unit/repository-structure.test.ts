import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const packagePaths = [
  "packages/shared/package.json",
  "packages/react-adapter/package.json",
  "packages/runtime/package.json",
  "packages/vite/package.json",
] as const;

describe("repository structure", () => {
  it("declares the four packages required by the architecture", async () => {
    const manifests = await Promise.all(
      packagePaths.map(
        async (path) => JSON.parse(await readFile(path, "utf8")) as unknown,
      ),
    );

    expect(manifests).toHaveLength(4);
  });
});
