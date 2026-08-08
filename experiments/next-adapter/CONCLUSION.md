---
poc-id: "next-loader-compilation-chain"
status: "blocked"
last-updated: "2026-08-09"
scope: "Gate N1 Loader compilation-chain evidence only"
---

# Next.js Loader compilation-chain conclusion

## Current conclusion

The local macOS matrix passes, but this POC remains `blocked` as a Gate N1 decision because the
required Ubuntu run and explicit multi-worker stress evidence have not yet been collected. This
status does not authorize `@spotpatch/next`, public exports, npm publication, or a Next.js support
claim.

## Reproduced local evidence

- Date: 2026-08-09 (Asia/Shanghai).
- Host: macOS arm64, Node 26.0.0.
- Fixtures: Next 15.3.9 + React 18.3.1; Next 16.3.0 + React 19.2.8.
- Development bundlers: Next 15 webpack/default and `--turbopack`; Next 16
  Turbopack/default and `--webpack`.
- Production builds: Next 15 webpack/default; Next 16 Turbopack/default.
- Command: `pnpm test:next-poc`.
- Result: 6/6 cases passed. The generated result and sanitized logs are under
  `.artifacts/loader-poc/` and conform to `evidence/result.schema.json`.

## Proven facts

1. With no `as` override, a Loader that returns marker-modified TSX containing TypeScript syntax
   continues through the built-in Next compiler in the tested Next 15 and Next 16 Turbopack
   versions.
2. The same probe contract works as a webpack `enforce: "pre"` Loader in both fixtures without
   replacing Next's built-in rules.
3. Server, Client and Edge modules render deterministic marker values; encoding worker identity in
   marker output is invalid because separate server/client compilation can cause hydration drift.
4. Client hydration succeeds and Fast Refresh preserves component state after a deterministic
   source edit.
5. webpack and Turbopack both retain original TSX `sourcesContent`, but their Loader map source
   bases differ: webpack requires a project-root-relative source while Turbopack requires a
   resource-relative source before Next composes its indexed map.
6. Production config evaluation does not read Loader POC environment values, production builds
   succeed, and no active development probe marker appears in `.next` output.
7. Every case removes its disposable fixture work directory after logs are sanitized and records
   the cleanup as a machine-readable assertion.

## Remaining blockers

- Run the same locked command on Ubuntu with Node 22 and retain the CI artifact.
- Add a deterministic high-module-count fixture and establish concurrency/cache behavior without
  writing worker identity into DOM or using unsupported Loader side effects.
- Validate cache restart/epoch behavior in the separate source-registration POC.
- Complete the other Gate N1 POCs before changing ADR-025 from Proposed or creating public code.

## Security boundary

The minimum-compatibility fixture intentionally locks Next 15.3.9. The 2026-08-09
`pnpm audit --prod --audit-level high` result reports high-severity advisories that are fixed only
in later Next 15 releases, plus advisories in historical compatibility dependencies already used by
the repository. This vulnerable fixture must remain private, loopback-only, disposable and absent
from every package tarball; it must never be deployed or used with untrusted requests. The findings
are not suppressed in audit configuration. A patched maintained Next 15 line remains required in
the release compatibility matrix in addition to this isolated minimum-version regression fixture.

The Node 26 `ExperimentalWarning` about `localStorage` observed in Next 15 development logs is a
runtime warning from the local Node version; it did not affect compilation. Supported Node matrix
evidence must use the versions defined by the testing specification.
