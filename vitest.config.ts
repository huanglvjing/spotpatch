import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const fromRoot = (path: string): string =>
  fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@spotpatch/astro": fromRoot("./packages/astro/src/index.ts"),
      "@spotpatch/agent": fromRoot("./packages/agent/src/index.ts"),
      "@spotpatch/analyzer": fromRoot("./packages/analyzer/src/index.ts"),
      "@spotpatch/bridge": fromRoot("./packages/bridge/src/index.ts"),
      "@spotpatch/compiler": fromRoot("./packages/compiler/src/index.ts"),
      "@spotpatch/dev-server": fromRoot("./packages/dev-server/src/index.ts"),
      "@spotpatch/next": fromRoot("./packages/next/src/index.ts"),
      "@spotpatch/runtime/data-flow": fromRoot(
        "./packages/runtime/src/data-flow-entry.ts",
      ),
      "@spotpatch/runtime/data-flow-panel": fromRoot(
        "./packages/runtime/src/data-flow-panel-entry.ts",
      ),
      "@spotpatch/runtime/external-handoff-panel": fromRoot(
        "./packages/runtime/src/external-handoff-panel-entry.ts",
      ),
      "@spotpatch/runtime/motion": fromRoot("./packages/runtime/src/motion-entry.ts"),
      "@spotpatch/shared/data-flow-runtime": fromRoot(
        "./packages/shared/src/data-flow-runtime.ts",
      ),
      "@spotpatch/shared/external-agent-node": fromRoot(
        "./packages/shared/src/external-agent-node.ts",
      ),
      "@spotpatch/shared/external-handoff-browser": fromRoot(
        "./packages/shared/src/external-handoff-browser.ts",
      ),
      "@spotpatch/shared/contextual-ask-browser": fromRoot(
        "./packages/shared/src/contextual-ask-browser.ts",
      ),
      "@spotpatch/shared/contextual-ask-node": fromRoot(
        "./packages/shared/src/contextual-ask-node.ts",
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
    // The suite launches Git and Agent-protocol subprocesses. Bound concurrency
    // so process-startup deadlines and analysis budgets remain reproducible.
    maxWorkers: 2,
    coverage: {
      reporter: ["text", "json", "html"],
    },
    environment: "node",
    restoreMocks: true,
  },
});
