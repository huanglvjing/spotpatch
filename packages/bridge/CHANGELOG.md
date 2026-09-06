# @spotpatch/bridge

## 0.4.1

### Patch Changes

- Add a managed Codex model selector backed by the local App Server catalog. Validate model choices, pass the selected model to thread and turn requests, and prevent switching during active execution without modifying configured-key provider settings. Share bounded catalog discovery with Contextual Ask and add protocol, lifecycle, UI, and credential-isolation regressions.
- Updated dependencies
  - @spotpatch/shared@1.14.1

## 0.4.0

### Minor Changes

- 2d98a66: Add an Astro development integration with native template and React-island source markers, bounded source context, shared AI review/apply/revert, read-only Contextual Ask, external-Agent Inbox/managed controls and Astro-aware trusted validation. Share service ownership across Vite, Next and Astro without changing their transport boundaries. Add original-coordinate native source projections, browser-script instrumentation and scoped navigation exclusions; never infer server execution from browser observations. Preserve JSX markers, production isolation and existing security policies. Compatibility and external-Agent maturity remain limited to the documented evidence; this change does not publish the new package.
- 2d98a66: Add a shared, accessible Managed Codex Ask model picker backed by the local model catalog, with bounded discovery, execution-time validation and explicit model dispatch.
- 2d98a66: Initialize revocable managed Codex project grants as part of plain CLI initialization across all adapters; remove implicit development-terminal prompts and show framework-specific setup guidance.

### Patch Changes

- 16d19c0: Enable external-Agent discovery on native Windows with a per-user LocalAppData runtime directory and fail-closed owner/ACL validation. Keep POSIX UID and mode checks unchanged, and run the existing descriptor, browser API, service, and bridge integration suites on Windows.
- Updated dependencies [2d98a66]
- Updated dependencies [2d98a66]
- Updated dependencies [16d19c0]
  - @spotpatch/shared@1.14.0
  - @spotpatch/agent@1.6.0

## 0.3.0

### Minor Changes

- 0d3a94b: Add the capability-gated Contextual Ask beta across the shared protocol, immutable source snapshots, Configured Key and Managed Codex read-only executors, Vite and Next transports, and the lazy Runtime planner UI. Ask requires an explicit element selection, returns a single cited answer, never exposes write tools or persistent chat history, and can convert the current answer into an editable local Change draft without creating a write job.

  The release gate now packs every public package and installs the tarballs together in a clean npm consumer before exercising real Vite and Next development and production hosts. CI covers Node 20 and 22 on Ubuntu, Windows, and macOS, the audited Vite 5/6/7 and Next 15/16 host matrix, Windows native npm Codex resolution, production leakage, package exports, and the existing compatibility suites.

### Patch Changes

- Updated dependencies [0d3a94b]
  - @spotpatch/shared@1.13.0
  - @spotpatch/agent@1.5.0

## 0.2.1

### Patch Changes

- 02e4f5d: Publish the capability-gated Codex compatibility path and the unified Dynamic Island runtime. Stable Codex releases at or above the supported baseline are validated against the exact executable's generated App Server schema and the existing live safety preflight instead of a hard-coded minor-version ceiling; incompatible capabilities continue to fail closed to Inbox, and managed execution recovers missing threads without weakening isolation.

  Runtime now owns the single motion implementation and public motion registration entry consumed by both Vite and Next, so both adapters ship the same production Dynamic Island UI, shared morph behavior, reduced-motion handling, and lifecycle cleanup without duplicated CSS or adapter-specific animation code.

- Updated dependencies [02e4f5d]
  - @spotpatch/agent@1.4.1

## 0.2.0

### Minor Changes

- 1f1e170: Add the opt-in, development-only external Agent handoff and managed-dispatch foundation: a memory-only authenticated loopback Broker, project-scoped discovery, request-idempotent handoffs, a per-development-session writer lease, four project-content-read-only MCP tools, a persistent Bridge event pump, experimental Claude Channel support, safe Inbox setup generators, and shared Vite/Next lifecycle integration. Codex managed mode is owned by `pnpm dev` and uses a page control surface backed by terminal consent, a user-private project grant, independent Git metadata/workspace snapshots, restricted read roots, per-revision App Server threads, fixed no-network/no-approval policy, allowed-path and cache-pollution audits, explicit required checks, hash-safe apply, structured progress, and honest Inbox fallback. A project-keyed private Codex runtime home prevents inherited user MCP/hooks/plugins from bypassing the sandbox; strict hook/MCP preflight, a restricted model-shell environment, bounded opaque file-auth linking, and exact revoke cleanup fail closed without writing runtime state into the business repository. Managed snapshots require only the authorized target paths to be tracked and clean; unrelated local changes remain outside the snapshot and are preserved. Cursor and generic MCP hosts remain Inbox-only. This is local-validation functionality and does not declare stable Claude Code, Codex, Cursor, managed real-host, or cross-platform release support.

### Patch Changes

- Updated dependencies [1f1e170]
  - @spotpatch/agent@1.4.0
  - @spotpatch/shared@1.11.0

## 0.1.0

### Minor Changes

- f8cd6b7: Add the opt-in, development-only external Agent handoff and active-dispatch foundation: a memory-only authenticated loopback Broker, project-scoped discovery, request-idempotent handoffs, a per-development-session managed-writer lease/dispatch state machine, four project-content-read-only MCP tools, a persistent Bridge event pump, experimental Claude Channel and Codex App Server adapters, safe Inbox setup generators, truthful Runtime status, and shared Vite/Next lifecycle integration. Codex active mode is a single explicit command that injects SpotPatch MCP into its owned App Server thread without writing project Codex configuration. Cursor and generic MCP hosts remain Inbox-only, and the managed lease does not claim an operating-system-wide writer lock. This is local-validation functionality and does not declare stable Claude Code, Codex, Cursor, or cross-platform release support.

### Patch Changes

- Updated dependencies [f8cd6b7]
  - @spotpatch/shared@1.10.0
