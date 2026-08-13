import { defineConfig } from "tsup";

export default defineConfig({
  clean: false,
  dts: false,
  entry: ["src/runtime-data-flow-prelude.ts"],
  esbuildOptions(options) {
    options.charset = "utf8";
  },
  format: ["esm"],
  minify: true,
  noExternal: ["@spotpatch/runtime", "@spotpatch/shared"],
  outDir: "dist",
  sourcemap: false,
  splitting: false,
});
