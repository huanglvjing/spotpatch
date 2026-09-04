import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const fromRoot = (relativePath: string): string =>
  fileURLToPath(new URL(`../../${relativePath}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@spotpatch/agent": fromRoot("packages/agent/src/index.ts"),
      "@spotpatch/bridge": fromRoot("packages/bridge/src/index.ts"),
      "@spotpatch/shared": fromRoot("packages/shared/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    restoreMocks: true,
    testTimeout: 180_000,
  },
});
