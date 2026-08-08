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
  plugins: [spotPatch(), react()],
});
```

SpotPatch injects no runtime, source markers, or local API endpoints into a
production build. AI stays disabled when no AI environment exists. To enable the
single-provider setup without changing `vite.config.ts`, add the three required
values to a Git-ignored `.env.local`:

```dotenv
SPOTPATCH_AI_BASE_URL=https://relay.example.com/v1
SPOTPATCH_AI_MODEL=provider-model-name
SPOTPATCH_AI_API_KEY=<your-key>
```

`SPOTPATCH_AI_PROTOCOL` optionally selects `chat-completions` (the default) or
`responses`. `SPOTPATCH_AI_AUTHENTICATION` optionally selects `bearer` (the
default) or `x-api-key`. Partial environment configuration fails fast without
printing credential values. API keys must never use a `VITE_` prefix.

Source actions auto-detect Cursor or VS Code and open the selected file at its
exact line and column. Set `editor: "cursor"` or `editor: "vscode"` only when an
explicit preference is required. The workbench also links to the
[SpotPatch GitHub repository](https://github.com/huanglvjing/spotpatch) for docs,
issues, and project updates.

Non-secret URL and model values can instead use the concise API:

```ts
spotPatch({
  ai: {
    baseURL: "https://relay.example.com/v1",
    model: "provider-model-name",
  },
});
```

The full provider map remains available for multiple providers, multiple models,
custom labels, checks, and limits.

AI runs directly when the Git workspace is clean. If staged, unstaged, or
bounded regular untracked files exist, the workbench reports their counts and
requires explicit consent before copying them into an isolated Agent baseline.
SpotPatch never stashes, resets, commits, or changes the source index, and Apply
or Revert touches only the Agent delta. Conflicts and unsupported workspace
states remain blocked with an actionable reason.

See the [repository README](https://github.com/huanglvjing/spotpatch#readme) for
the complete setup and security model.
