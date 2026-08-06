# SpotPatch

SpotPatch is a local-development React page feedback tool that connects selected DOM
elements to source locations and produces sanitized, structured context for coding
assistants.

The normative v1 specification starts at
[`docs/技术方案/00-索引与导航.md`](./docs/技术方案/00-索引与导航.md).

## Development

```bash
pnpm install
pnpm build
pnpm lint
pnpm typecheck
pnpm test:unit
```

Only `@spotpatch/vite` is a user-facing entry package. The shared, runtime, and React
adapter packages are installed transitively.
