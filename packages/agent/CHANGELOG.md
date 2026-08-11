# @spotpatch/agent

## 1.3.0

### Minor Changes

- df52b66: Make the explicitly consented trusted mode a direct, low-latency path. It now
  starts from SpotPatch's exact source location, omits the `run_check` tool,
  skips host project checks, and applies the isolated Diff immediately while
  retaining project boundaries, atomic patching, conflict detection, and Revert.
  Review and gated auto modes continue to run configured checks.

## 1.2.4

### Patch Changes

- 8bd8e88: Keep denied or unavailable `read_file` calls inside the bounded Agent loop so
  the model can recover through allowed discovery results without weakening path
  or write protections.
- Updated dependencies [14c3a48]
  - @spotpatch/shared@1.7.0

## 1.2.3

### Patch Changes

- 1a7628b: Start real Agent jobs without a redundant two-request capability preflight,
  parallelize independent reads, cache worktree discovery and file content with
  write-aware invalidation, and reuse current host-run validation results. Supply
  bounded nearby project configuration and sibling-code evidence so generated
  changes follow the target repository's existing style and file organization.

## 1.2.2

### Patch Changes

- 0218aa7: Preserve completed element selections and their individual page context across
  same-project navigation, reloads, and workbench close/reopen cycles. Detached DOM
  nodes are released while sanitized target context remains available, and a
  non-secret development session identity prevents stale drafts from crossing
  server restarts.
- 2bbdafc: Replace oversized npm README logos with a compact icon-and-package-name heading
  that remains consistently sized when npm sanitizes image attributes.
- Updated dependencies [0218aa7]
- Updated dependencies [2bbdafc]
  - @spotpatch/shared@1.6.0

## 1.2.1

### Patch Changes

- f12538d: Allow OpenAI-compatible relays to reuse a provider tool call ID in a later model
  turn without replaying an earlier result. Idempotency and activity tracking are
  now scoped by SpotPatch turn, while conflicting IDs within one turn still fail
  closed before source mutation.

  Report malformed tool arguments and same-turn call ID conflicts as distinct,
  actionable errors. Parsed argument objects that miss the strict contract now
  return a bounded zero-mutation retry result so the model can correct them with a
  new call ID.

- Updated dependencies [f12538d]
  - @spotpatch/shared@1.4.0

## 1.2.0

### Minor Changes

- 41b5f3f: Add explicit local-workspace health checks and an opt-in isolated baseline for staged, unstaged, and untracked changes. Applying or reverting now preserves pre-existing edits and the Git index while rejecting conflicts on Agent-touched files with more precise diagnostics.

  Improve the provider and model controls with an accessible customizable native picker in supported Chromium versions, including a natural below-field transition and a native fallback.

### Patch Changes

- Updated dependencies [41b5f3f]
  - @spotpatch/shared@1.3.0

## 1.1.0

### Minor Changes

- 3b15243: Add secure convention-based AI setup for `spotPatch()`, a concise single-provider
  configuration API, and restricted `x-api-key` authentication alongside Bearer
  credentials. Complete `SPOTPATCH_AI_*` environment values now enable AI without
  duplicating provider defaults, while partial configuration fails fast and secrets
  remain confined to the Vite Node process.

### Patch Changes

- Updated dependencies [3b15243]
  - @spotpatch/shared@1.1.0

## 1.0.0

### Major Changes

- 8b49469: Release the initial SpotPatch v1 implementation with development-only source
  markers, secure local source access, React 18 resolution, sanitized multi-target
  context collection, bilingual prompt composition, a contextual Shadow DOM
  workbench, and an optional review-gated AI code Agent.

### Patch Changes

- Updated dependencies [8b49469]
  - @spotpatch/shared@1.0.0
