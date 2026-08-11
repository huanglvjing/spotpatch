# @spotpatch/next

## 0.3.1

### Patch Changes

- f13bd87: Keep customizable Agent select popovers visible when opened. The picker now
  uses a visible computed state as its resilient default, retains a progressive
  opening transition, and scrolls when the option list exceeds its height.
- Updated dependencies [f13bd87]
  - @spotpatch/runtime@1.7.1

## 0.3.0

### Minor Changes

- 6a1fd47: Add a page-level Review/Trusted Fast selector that defaults to review, a safe low-configuration trusted mode with automatic local TypeScript validation, and matching Vite and Next initialization workflows. Vite now provides `spotpatch-vite init` and `spotpatch-vite check`, while both initializers use atomic file plans and enable the trusted option only when a project validation command can be discovered safely.

### Patch Changes

- Updated dependencies [6a1fd47]
  - @spotpatch/shared@1.8.0
  - @spotpatch/dev-server@0.3.0
  - @spotpatch/runtime@1.7.0

## 0.2.0

### Minor Changes

- 14c3a48: Add the explicitly configured `trusted-auto` Agent mode. One session-scoped
  consent covers provider transmission, bounded local changes, and direct apply
  after required checks, while project boundaries, protected paths, conflict
  checks, isolated execution, and Revert remain enforced.

### Patch Changes

- Updated dependencies [14c3a48]
  - @spotpatch/shared@1.7.0
  - @spotpatch/dev-server@0.2.0
  - @spotpatch/runtime@1.6.0

## 0.1.3

### Patch Changes

- 1a7628b: Start real Agent jobs without a redundant two-request capability preflight,
  parallelize independent reads, cache worktree discovery and file content with
  write-aware invalidation, and reuse current host-run validation results. Supply
  bounded nearby project configuration and sibling-code evidence so generated
  changes follow the target repository's existing style and file organization.
- Updated dependencies [1a7628b]
  - @spotpatch/dev-server@0.1.2
  - @spotpatch/runtime@1.5.2

## 0.1.2

### Patch Changes

- 6cd7726: Recenter restored cross-page selections when their original DOM anchor is no
  longer available, and refresh the workbench with a compact, responsive layout.
- Updated dependencies [6cd7726]
  - @spotpatch/runtime@1.5.1

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
  - @spotpatch/dev-server@0.1.1
  - @spotpatch/runtime@1.5.0
  - @spotpatch/shared@1.6.0
  - @spotpatch/compiler@0.1.1

## 0.1.0

### Minor Changes

- f3b04f9: Add the Next.js adapter, strict Runtime bootstrap protocol, framework
  diagnostics, and development CLI lifecycle.

### Patch Changes

- Updated dependencies [f3b04f9]
  - @spotpatch/compiler@0.1.0
  - @spotpatch/dev-server@0.1.0
  - @spotpatch/runtime@1.4.0
  - @spotpatch/shared@1.5.0
