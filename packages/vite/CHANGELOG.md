# @spotpatch/vite

## 1.4.3

### Patch Changes

- 6cd7726: Recenter restored cross-page selections when their original DOM anchor is no
  longer available, and refresh the workbench with a compact, responsive layout.
- Updated dependencies [6cd7726]
  - @spotpatch/runtime@1.5.1

## 1.4.2

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
  - @spotpatch/dev-server@0.1.1
  - @spotpatch/runtime@1.5.0
  - @spotpatch/shared@1.6.0
  - @spotpatch/compiler@0.1.1
  - @spotpatch/react-adapter@1.0.1

## 1.4.1

### Patch Changes

- f3b04f9: Extract the framework-neutral source compiler and Node development service so
  the Vite and Next adapters consume one implementation of shared behavior.
- Updated dependencies [f3b04f9]
  - @spotpatch/compiler@0.1.0
  - @spotpatch/dev-server@0.1.0
  - @spotpatch/runtime@1.4.0
  - @spotpatch/shared@1.5.0

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

### Patch Changes

- Updated dependencies [f12538d]
  - @spotpatch/shared@1.4.0
  - @spotpatch/agent@1.2.1
  - @spotpatch/runtime@1.3.0

## 1.3.1

### Patch Changes

- f5174d9: Reduce the cross-platform Runtime bundle while retaining precise workspace diagnostics and the animated native provider/model picker, keeping Linux Node 22 builds below the documented gzip gate.
- Updated dependencies [f5174d9]
  - @spotpatch/runtime@1.2.1

## 1.3.0

### Minor Changes

- 41b5f3f: Add explicit local-workspace health checks and an opt-in isolated baseline for staged, unstaged, and untracked changes. Applying or reverting now preserves pre-existing edits and the Git index while rejecting conflicts on Agent-touched files with more precise diagnostics.

  Improve the provider and model controls with an accessible customizable native picker in supported Chromium versions, including a natural below-field transition and a native fallback.

### Patch Changes

- Updated dependencies [41b5f3f]
  - @spotpatch/shared@1.3.0
  - @spotpatch/agent@1.2.0
  - @spotpatch/runtime@1.2.0

## 1.2.2

### Patch Changes

- 93e13de: Route Cursor and VS Code source navigation through the matching project workspace with exact line and column coordinates, and keep the native AI provider/model controls visually consistent with the dark workbench.
- Updated dependencies [93e13de]
  - @spotpatch/runtime@1.1.2

## 1.2.1

### Patch Changes

- c5e7f61: Keep the source-navigation workbench below its cross-platform runtime bundle budget while preserving GitHub promotion, per-target quick-open controls, bilingual feedback, and VS Code/Cursor launch support.
- Updated dependencies [c5e7f61]
  - @spotpatch/runtime@1.1.1

## 1.2.0

### Minor Changes

- 5822446: Add safe, source-aware Cursor and VS Code navigation with automatic editor
  detection, per-target quick-open controls, visible bilingual launch feedback,
  and a non-tracking link to the official SpotPatch GitHub repository.

### Patch Changes

- Updated dependencies [5822446]
  - @spotpatch/shared@1.2.0
  - @spotpatch/runtime@1.1.0

## 1.1.0

### Minor Changes

- 3b15243: Add secure convention-based AI setup for `spotPatch()`, a concise single-provider
  configuration API, and restricted `x-api-key` authentication alongside Bearer
  credentials. Complete `SPOTPATCH_AI_*` environment values now enable AI without
  duplicating provider defaults, while partial configuration fails fast and secrets
  remain confined to the Vite Node process.

### Patch Changes

- Updated dependencies [3b15243]
  - @spotpatch/agent@1.1.0
  - @spotpatch/shared@1.1.0

## 1.0.0

### Major Changes

- 8b49469: Release the initial SpotPatch v1 implementation with development-only source
  markers, secure local source access, React 18 resolution, sanitized multi-target
  context collection, bilingual prompt composition, a contextual Shadow DOM
  workbench, and an optional review-gated AI code Agent.

### Patch Changes

- Updated dependencies [8b49469]
  - @spotpatch/react-adapter@1.0.0
  - @spotpatch/runtime@1.0.0
  - @spotpatch/shared@1.0.0
  - @spotpatch/agent@1.0.0
