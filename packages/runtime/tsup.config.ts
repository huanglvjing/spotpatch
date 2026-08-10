import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  define: {
    __SPOTPATCH_INLINE_BRAND_MARK__: "true",
  },
  dts: true,
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  sourcemap: true,
});
