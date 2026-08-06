import { defineConfig } from "tsup";

export default defineConfig({
  clean: false,
  dts: true,
  entry: ["src/runtime-client.ts"],
  format: ["esm"],
  noExternal: [/^@spotpatch\//, "bippy"],
  outDir: "dist",
  sourcemap: false,
  splitting: false,
});
