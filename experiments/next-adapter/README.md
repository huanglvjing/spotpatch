# Next.js Adapter Experiments

This directory contains Gate N1 experiments defined by `doc-id:next-08-testing-delivery`.
It is intentionally outside `packages/**`, has no public exports, and is excluded from npm
publication. No production package may import these files.

## Loader compilation-chain POC

Run the locked Next 15/React 18 and Next 16/React 19 matrix from the repository root:

```bash
pnpm test:next-poc
```

The command recreates every fixture under `.work/`, generates 500 disposable TSX stress modules,
runs webpack and Turbopack on loopback, and checks concurrent cold requests, marker determinism,
hydration, Fast Refresh, source maps, Edge compilation, warm cache restart isolation and production
isolation. It writes machine-readable evidence to `.artifacts/loader-poc/result.json`. Each fixture
work directory is removed and asserted after its case; evidence artifacts are retained for
diagnostics. Both roots are ignored by Git.

## Private real-host POC

An additional local-only command validates a clean private Next.js 16 App Router project without
changing its source repository:

```bash
SPOTPATCH_NEXT_REAL_HOST_ROOT="/absolute/path/to/private-next-project" \
  pnpm test:next-real-host
```

The runner requires `next.config.ts`, an `app/` directory, installed dependencies, exact `next`
and `react` versions, and a clean Git worktree. It excludes `.git`, `.next`, `.env*`, `.npmrc`,
coverage and deployment output while copying the host to `.work/`. It composes a temporary config,
adds the generated stress route only to that copy, tests Turbopack, webpack, Client Component
hydration, warm restart isolation and a production build, then verifies that the original revision
and Git status did not change. Results are written to `.artifacts/real-host-poc/`.

The probe Loader only changes the fixture-specific `data-spotpatch-loader-probe` attribute. It
does not implement the SpotPatch compiler and must not be copied into a published package.
Current conclusions and remaining blockers are recorded in [CONCLUSION.md](./CONCLUSION.md).
