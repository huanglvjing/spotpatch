import { defineConfig } from "tsup";

export default defineConfig({
  clean: false,
  define: {
    __SPOTPATCH_INLINE_BRAND_MARK__: "false",
  },
  dts: true,
  entry: ["src/runtime-client.ts"],
  esbuildOptions(options) {
    options.charset = "utf8";
  },
  external: ["@spotpatch/react-adapter"],
  format: ["esm"],
  minify: true,
  noExternal: ["@spotpatch/runtime", "@spotpatch/shared"],
  outDir: "dist",
  sourcemap: false,
  splitting: false,
});
