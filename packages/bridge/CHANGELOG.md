# @spotpatch/bridge

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
