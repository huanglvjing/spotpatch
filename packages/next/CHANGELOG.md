# @spotpatch/next

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
