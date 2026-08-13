import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const fromRoot = (path: string): string =>
  fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@spotpatch/agent": fromRoot("./packages/agent/src/index.ts"),
      "@spotpatch/analyzer": fromRoot("./packages/analyzer/src/index.ts"),
      "@spotpatch/compiler": fromRoot("./packages/compiler/src/index.ts"),
      "@spotpatch/dev-server": fromRoot("./packages/dev-server/src/index.ts"),
      "@spotpatch/next": fromRoot("./packages/next/src/index.ts"),
      "@spotpatch/runtime/data-flow": fromRoot(
        "./packages/runtime/src/data-flow-entry.ts",
      ),
      "@spotpatch/runtime/data-flow-panel": fromRoot(
        "./packages/runtime/src/data-flow-panel-entry.ts",
      ),
      "@spotpatch/shared/data-flow-runtime": fromRoot(
        "./packages/shared/src/data-flow-runtime.ts",
      ),
      "@spotpatch/shared": fromRoot("./packages/shared/src/index.ts"),
      "@spotpatch/react-adapter": fromRoot("./packages/react-adapter/src/index.ts"),
      "@spotpatch/runtime": fromRoot("./packages/runtime/src/index.ts"),
      "@spotpatch/vite": fromRoot("./packages/vite/src/index.ts"),
    },
  },
  define: {
    __SPOTPATCH_INLINE_BRAND_MARK__: true,
  },
  test: {
    coverage: {
      reporter: ["text", "json", "html"],
    },
    environment: "node",
    restoreMocks: true,
  },
});
