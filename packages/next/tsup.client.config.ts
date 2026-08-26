import { defineConfig } from "tsup";

export default defineConfig({
  clean: false,
  dts: true,
  entry: ["src/client.ts", "src/data-flow-runtime.ts", "src/noop.ts"],
  external: ["@spotpatch/next/data-flow-runtime"],
  format: ["esm", "cjs"],
  noExternal: ["bippy"],
  outDir: "dist",
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
  platform: "browser",
  sourcemap: true,
  splitting: false,
  target: "es2022",
});
