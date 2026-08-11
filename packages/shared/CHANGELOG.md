# @spotpatch/shared

## 1.8.0

### Minor Changes

- 6a1fd47: Add a page-level Review/Trusted Fast selector that defaults to review, a safe low-configuration trusted mode with automatic local TypeScript validation, and matching Vite and Next initialization workflows. Vite now provides `spotpatch-vite init` and `spotpatch-vite check`, while both initializers use atomic file plans and enable the trusted option only when a project validation command can be discovered safely.

## 1.7.0

### Minor Changes

- 14c3a48: Add the explicitly configured `trusted-auto` Agent mode. One session-scoped
  consent covers provider transmission, bounded local changes, and direct apply
  after required checks, while project boundaries, protected paths, conflict
  checks, isolated execution, and Revert remain enforced.

## 1.6.0

### Minor Changes

- 0218aa7: Preserve completed element selections and their individual page context across
  same-project navigation, reloads, and workbench close/reopen cycles. Detached DOM
  nodes are released while sanitized target context remains available, and a
  non-secret development session identity prevents stale drafts from crossing
  server restarts.

### Patch Changes

- 2bbdafc: Replace oversized npm README logos with a compact icon-and-package-name heading
  that remains consistently sized when npm sanitizes image attributes.

## 1.5.0

### Minor Changes

- f3b04f9: Add the Next.js adapter, strict Runtime bootstrap protocol, framework
  diagnostics, and development CLI lifecycle.

## 1.4.0

### Minor Changes

- f12538d: Allow OpenAI-compatible relays to reuse a provider tool call ID in a later model
  turn without replaying an earlier result. Idempotency and activity tracking are
  now scoped by SpotPatch turn, while conflicting IDs within one turn still fail
  closed before source mutation.

  Report malformed tool arguments and same-turn call ID conflicts as distinct,
  actionable errors. Parsed argument objects that miss the strict contract now
  return a bounded zero-mutation retry result so the model can correct them with a
  new call ID.

## 1.3.0

### Minor Changes

- 41b5f3f: Add explicit local-workspace health checks and an opt-in isolated baseline for staged, unstaged, and untracked changes. Applying or reverting now preserves pre-existing edits and the Git index while rejecting conflicts on Agent-touched files with more precise diagnostics.

  Improve the provider and model controls with an accessible customizable native picker in supported Chromium versions, including a natural below-field transition and a native fallback.

## 1.2.0

### Minor Changes

- 5822446: Add safe, source-aware Cursor and VS Code navigation with automatic editor
  detection, per-target quick-open controls, visible bilingual launch feedback,
  and a non-tracking link to the official SpotPatch GitHub repository.

## 1.1.0

### Minor Changes

- 3b15243: Add secure convention-based AI setup for `spotPatch()`, a concise single-provider
  configuration API, and restricted `x-api-key` authentication alongside Bearer
  credentials. Complete `SPOTPATCH_AI_*` environment values now enable AI without
  duplicating provider defaults, while partial configuration fails fast and secrets
  remain confined to the Vite Node process.

## 1.0.0

### Major Changes

- 8b49469: Release the initial SpotPatch v1 implementation with development-only source
  markers, secure local source access, React 18 resolution, sanitized multi-target
  context collection, bilingual prompt composition, a contextual Shadow DOM
  workbench, and an optional review-gated AI code Agent.
