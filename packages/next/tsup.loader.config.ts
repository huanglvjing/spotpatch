import { defineConfig } from "tsup";

export default defineConfig({
  clean: false,
  dts: false,
  entry: ["src/loader.ts"],
  format: ["cjs"],
  outDir: "dist",
  outExtension: () => ({ js: ".cjs" }),
  platform: "node",
  sourcemap: true,
  target: "node20",
});
