# @spotpatch/agent

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
