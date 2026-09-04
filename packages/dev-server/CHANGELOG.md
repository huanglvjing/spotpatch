# @spotpatch/dev-server

## 0.9.0

### Minor Changes

- 0d3a94b: Add the capability-gated Contextual Ask beta across the shared protocol, immutable source snapshots, Configured Key and Managed Codex read-only executors, Vite and Next transports, and the lazy Runtime planner UI. Ask requires an explicit element selection, returns a single cited answer, never exposes write tools or persistent chat history, and can convert the current answer into an editable local Change draft without creating a write job.

  The release gate now packs every public package and installs the tarballs together in a clean npm consumer before exercising real Vite and Next development and production hosts. CI covers Node 20 and 22 on Ubuntu, Windows, and macOS, the audited Vite 5/6/7 and Next 15/16 host matrix, Windows native npm Codex resolution, production leakage, package exports, and the existing compatibility suites.

### Patch Changes

- Updated dependencies [0d3a94b]
  - @spotpatch/shared@1.13.0
  - @spotpatch/agent@1.5.0

## 0.8.0

### Minor Changes

- 2f961b2: Add the development-only Next.js component data-flow public preview while preserving the Vite evidence model. The shared compiler now exposes prepared instrumentation, the authenticated source registration path atomically installs component anchors, and the shared runtime owns recorder policy and panel registration. Next partitions source and data-flow transforms across browser/server webpack and Turbopack targets, installs the dispatch recorder before hydration, excludes internal RSC transports, and aliases both browser entries to a no-op outside development. React 19 component identity accepts compiler registrations only and discovers renderers across separately bundled bippy instances. Initialization enables the shared data-flow option, while production output remains free of executable markers, recorder, panel, routes, and credentials.

### Patch Changes

- Updated dependencies [2f961b2]
  - @spotpatch/compiler@0.3.0
  - @spotpatch/shared@1.12.0
  - @spotpatch/analyzer@0.1.1

## 0.7.0

### Minor Changes

- 1f1e170: Add the opt-in, development-only external Agent handoff and managed-dispatch foundation: a memory-only authenticated loopback Broker, project-scoped discovery, request-idempotent handoffs, a per-development-session writer lease, four project-content-read-only MCP tools, a persistent Bridge event pump, experimental Claude Channel support, safe Inbox setup generators, and shared Vite/Next lifecycle integration. Codex managed mode is owned by `pnpm dev` and uses a page control surface backed by terminal consent, a user-private project grant, independent Git metadata/workspace snapshots, restricted read roots, per-revision App Server threads, fixed no-network/no-approval policy, allowed-path and cache-pollution audits, explicit required checks, hash-safe apply, structured progress, and honest Inbox fallback. A project-keyed private Codex runtime home prevents inherited user MCP/hooks/plugins from bypassing the sandbox; strict hook/MCP preflight, a restricted model-shell environment, bounded opaque file-auth linking, and exact revoke cleanup fail closed without writing runtime state into the business repository. Managed snapshots require only the authorized target paths to be tracked and clean; unrelated local changes remain outside the snapshot and are preserved. Cursor and generic MCP hosts remain Inbox-only. This is local-validation functionality and does not declare stable Claude Code, Codex, Cursor, managed real-host, or cross-platform release support.

### Patch Changes

- Updated dependencies [1f1e170]
  - @spotpatch/agent@1.4.0
  - @spotpatch/shared@1.11.0

## 0.6.0

### Minor Changes

- f8cd6b7: Add the opt-in, development-only external Agent handoff and active-dispatch foundation: a memory-only authenticated loopback Broker, project-scoped discovery, request-idempotent handoffs, a per-development-session managed-writer lease/dispatch state machine, four project-content-read-only MCP tools, a persistent Bridge event pump, experimental Claude Channel and Codex App Server adapters, safe Inbox setup generators, truthful Runtime status, and shared Vite/Next lifecycle integration. Codex active mode is a single explicit command that injects SpotPatch MCP into its owned App Server thread without writing project Codex configuration. Cursor and generic MCP hosts remain Inbox-only, and the managed lease does not claim an operating-system-wide writer lock. This is local-validation functionality and does not declare stable Claude Code, Codex, Cursor, or cross-platform release support.

### Patch Changes

- Updated dependencies [f8cd6b7]
  - @spotpatch/shared@1.10.0

## 0.5.0

### Minor Changes

- 6c753d6: Add the Vite and React 18 component data-flow Beta. The new evidence-first pipeline maps selected composite-component DOM back to registered business components, analyzes supported fetch/Axios/React Query chains and consumed fields, records value-free fetch/XHR dispatch observations, and displays component and page API reports without guessing ambiguous ownership. It also includes an experimental tRPC adapter that reports logical procedures separately from physical batch transport.

  The public option remains disabled when omitted, while the Vite `setup/init` initializer writes `dataFlow: {}` so a freshly initialized project receives the complete integration. The feature is dispatch-only and development-only, and keeps unsupported traffic partial, unknown, or unassigned. It does not read response bodies or enable data-flow AI. The Next.js preview rejects this option until its Loader, prelude, panel, and compatibility gates are implemented.

  The analyzer regression suite is fully self-contained and uses neutral, temporary multi-module fixtures; published source and tests do not depend on or identify external application repositories. Entry-source lookup and root containment use native canonical paths with filesystem-identity fallbacks, so Windows drive casing, separators, and 8.3 temporary-directory aliases do not turn a valid report into an internal error.

### Patch Changes

- Updated dependencies [6c753d6]
  - @spotpatch/shared@1.9.0
  - @spotpatch/compiler@0.2.0
  - @spotpatch/analyzer@0.1.0

## 0.4.0

### Minor Changes

- df52b66: Make the explicitly consented trusted mode a direct, low-latency path. It now
  starts from SpotPatch's exact source location, omits the `run_check` tool,
  skips host project checks, and applies the isolated Diff immediately while
  retaining project boundaries, atomic patching, conflict detection, and Revert.
  Review and gated auto modes continue to run configured checks.

### Patch Changes

- Updated dependencies [df52b66]
  - @spotpatch/agent@1.3.0

## 0.3.0

### Minor Changes

- 6a1fd47: Add a page-level Review/Trusted Fast selector that defaults to review, a safe low-configuration trusted mode with automatic local TypeScript validation, and matching Vite and Next initialization workflows. Vite now provides `spotpatch-vite init` and `spotpatch-vite check`, while both initializers use atomic file plans and enable the trusted option only when a project validation command can be discovered safely.

### Patch Changes

- Updated dependencies [6a1fd47]
  - @spotpatch/shared@1.8.0

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
