import { defineConfig } from "tsup";

export default defineConfig({
  entry: { "ask-panel-poc": "src/ui/ask-panel-poc.ts" },
  clean: true,
  dts: false,
  format: ["iife"],
  globalName: "SpotPatchAskPoc",
  minify: true,
  outDir: ".artifacts/ui-bundle",
  platform: "browser",
  sourcemap: false,
  splitting: false,
  target: "es2022",
});
