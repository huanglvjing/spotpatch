import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: false,
  entry: ["src/runtime-poc-hook.ts"],
  esbuildOptions(options) {
    options.charset = "utf8";
  },
  format: ["esm"],
  minify: true,
  noExternal: [
    "@spotpatch/react-adapter",
    "@spotpatch/runtime",
    "@spotpatch/shared",
    "bippy",
  ],
  outDir: ".work/runtime-poc-bundle",
  sourcemap: false,
  splitting: true,
});
