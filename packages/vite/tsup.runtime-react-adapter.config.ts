import { defineConfig } from "tsup";

export default defineConfig({
  clean: false,
  dts: false,
  entry: ["src/runtime-react-adapter.ts"],
  esbuildOptions(options) {
    options.charset = "utf8";
  },
  format: ["esm"],
  minify: true,
  noExternal: ["@spotpatch/react-adapter", "@spotpatch/shared", "bippy"],
  outDir: "dist",
  sourcemap: false,
  splitting: false,
});
