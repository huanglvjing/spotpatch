import { defineConfig } from "tsup";

export default defineConfig([
  {
    name: "package",
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
  },
  {
    name: "cli",
    entry: ["src/cli.ts"],
    format: ["esm"],
    platform: "node",
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    name: "client",
    entry: [
      "src/client.ts",
      "src/runtime-motion.ts",
      "src/runtime-contextual-ask.ts",
      "src/runtime-external-handoff.ts",
      "src/runtime-data-flow-panel.ts",
      "src/runtime-data-flow.ts",
    ],
    format: ["esm"],
    platform: "browser",
    minify: true,
    splitting: false,
    sourcemap: false,
    define: { __SPOTPATCH_INLINE_BRAND_MARK__: "true" },
    noExternal: [/^@spotpatch\//, "bippy", "gsap", "zod"],
  },
]);
