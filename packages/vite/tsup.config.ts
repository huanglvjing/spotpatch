import { defineConfig, type Options } from "tsup";

const browserBundle = {
  clean: false,
  dts: false,
  esbuildOptions(options: Parameters<NonNullable<Options["esbuildOptions"]>>[0]) {
    options.charset = "utf8";
  },
  format: ["esm"],
  outDir: "dist",
  sourcemap: false,
  splitting: false,
} satisfies Options;

export default defineConfig([
  {
    name: "package",
    clean: false,
    dts: true,
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    sourcemap: true,
  },
  {
    name: "cli",
    banner: { js: "#!/usr/bin/env node" },
    clean: false,
    dts: false,
    entry: ["src/cli.ts"],
    format: ["esm"],
    outDir: "dist",
    platform: "node",
    sourcemap: true,
    target: "node20",
  },
  {
    ...browserBundle,
    name: "runtime-client",
    define: {
      __SPOTPATCH_INLINE_BRAND_MARK__: "false",
    },
    dts: true,
    entry: ["src/runtime-client.ts"],
    external: ["@spotpatch/react-adapter"],
    minify: true,
    noExternal: ["@spotpatch/runtime", "@spotpatch/shared"],
  },
  {
    ...browserBundle,
    name: "runtime-react-adapter",
    entry: ["src/runtime-react-adapter.ts"],
    minify: true,
    noExternal: ["@spotpatch/react-adapter", "@spotpatch/shared", "bippy"],
  },
  {
    ...browserBundle,
    name: "runtime-data-flow-prelude",
    entry: ["src/runtime-data-flow-prelude.ts"],
    minify: true,
    noExternal: ["@spotpatch/runtime", "@spotpatch/shared"],
  },
  {
    ...browserBundle,
    name: "runtime-data-flow-panel",
    entry: ["src/runtime-data-flow-panel.ts"],
    minify: true,
    noExternal: ["@spotpatch/runtime", "@spotpatch/shared"],
  },
  {
    ...browserBundle,
    name: "runtime-external-handoff-panel",
    entry: ["src/runtime-external-handoff-panel.ts"],
    minify: true,
    noExternal: ["@spotpatch/runtime", "@spotpatch/shared"],
  },
]);
