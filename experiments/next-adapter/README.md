# Next.js Adapter Experiments

This directory contains Gate N1 experiments defined by `doc-id:next-08-testing-delivery`.
It is intentionally outside `packages/**`, has no public exports, and is excluded from npm
publication. No production package may import these files.

## Loader compilation-chain POC

Run the locked Next 15/React 18 and Next 16/React 19 matrix from the repository root:

```bash
pnpm test:next-poc
```

The command recreates every fixture under `.work/`, runs webpack and Turbopack on loopback,
checks marker injection, hydration, Fast Refresh, source maps, Edge compilation and production
isolation, then writes machine-readable evidence to `.artifacts/loader-poc/result.json`. Each
fixture work directory is removed and asserted after its case; evidence artifacts are retained for
diagnostics. Both roots are ignored by Git.

The probe Loader only changes the fixture-specific `data-spotpatch-loader-probe` attribute. It
does not implement the SpotPatch compiler and must not be copied into a published package.
Current conclusions and remaining blockers are recorded in [CONCLUSION.md](./CONCLUSION.md).
