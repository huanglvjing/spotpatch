# @spotpatch/vite

The public Vite entry point for SpotPatch: a development-only React element
picker with source-aware context, bilingual multi-target change requests, and
an optional review-gated AI code Agent.

## Install

```bash
npm install --save-dev @spotpatch/vite
# or: pnpm add -D @spotpatch/vite
```

## Configure

Place SpotPatch before the React plugin so source markers are available to the
development runtime:

```ts
import { spotPatch } from "@spotpatch/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    spotPatch({
      editor: "vscode",
      redact: true,
      allowLan: false,
      locale: "auto",
      maxTargets: 8,
    }),
    react(),
  ],
});
```

SpotPatch injects no runtime, source markers, or local API endpoints into a
production build. AI execution is disabled unless a trusted Node-side provider
profile is explicitly configured; API keys must never use a `VITE_` prefix.

See the [repository README](https://github.com/huanglvjing/spotpatch#readme) for
the complete setup and security model.
