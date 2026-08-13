import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  define: {
    __SPOTPATCH_INLINE_BRAND_MARK__: "true",
  },
  dts: true,
  entry: {
    index: "src/index.ts",
    "data-flow": "src/data-flow-entry.ts",
    "data-flow-panel": "src/data-flow-panel-entry.ts",
  },
  format: ["esm", "cjs"],
  sourcemap: true,
});
