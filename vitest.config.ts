import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const fromRoot = (path: string): string =>
  fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@spotpatch/agent": fromRoot("./packages/agent/src/index.ts"),
      "@spotpatch/shared": fromRoot("./packages/shared/src/index.ts"),
      "@spotpatch/react-adapter": fromRoot("./packages/react-adapter/src/index.ts"),
      "@spotpatch/runtime": fromRoot("./packages/runtime/src/index.ts"),
      "@spotpatch/vite": fromRoot("./packages/vite/src/index.ts"),
    },
  },
  test: {
    coverage: {
      reporter: ["text", "json", "html"],
    },
    environment: "node",
    restoreMocks: true,
  },
});
