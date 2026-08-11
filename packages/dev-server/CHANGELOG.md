# @spotpatch/dev-server

## 0.2.0

### Minor Changes

- 14c3a48: Add the explicitly configured `trusted-auto` Agent mode. One session-scoped
  consent covers provider transmission, bounded local changes, and direct apply
  after required checks, while project boundaries, protected paths, conflict
  checks, isolated execution, and Revert remain enforced.

### Patch Changes

- Updated dependencies [8bd8e88]
- Updated dependencies [14c3a48]
  - @spotpatch/agent@1.2.4
  - @spotpatch/shared@1.7.0

## 0.1.2

### Patch Changes

- 1a7628b: Start real Agent jobs without a redundant two-request capability preflight,
  parallelize independent reads, cache worktree discovery and file content with
  write-aware invalidation, and reuse current host-run validation results. Supply
  bounded nearby project configuration and sibling-code evidence so generated
  changes follow the target repository's existing style and file organization.
- Updated dependencies [1a7628b]
  - @spotpatch/agent@1.2.3

## 0.1.1

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
  - @spotpatch/agent@1.2.2
  - @spotpatch/shared@1.6.0
  - @spotpatch/compiler@0.1.1

## 0.1.0

### Minor Changes

- f3b04f9: Extract the framework-neutral source compiler and Node development service so
  the Vite and Next adapters consume one implementation of shared behavior.

### Patch Changes

- Updated dependencies [f3b04f9]
  - @spotpatch/compiler@0.1.0
  - @spotpatch/shared@1.5.0
