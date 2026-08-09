import { defineConfig } from "tsup";

export default defineConfig({
  banner: { js: "#!/usr/bin/env node" },
  clean: false,
  dts: false,
  entry: ["src/cli.ts"],
  format: ["esm"],
  outDir: "dist",
  platform: "node",
  sourcemap: true,
  target: "node20",
});
