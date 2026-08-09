import { defineConfig } from "tsup";

export default defineConfig({
  clean: false,
  dts: true,
  entry: ["src/client.ts", "src/noop.ts"],
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
