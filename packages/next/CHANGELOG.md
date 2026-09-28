# @spotpatch/next

## 0.12.0

### Minor Changes

- b42c755: Add Claude Code as a Contextual Ask executor. A signed-in local Claude Code 2.1.283 or later answers each question in a disposable headless session with no tools, MCP servers, settings sources, slash commands or persisted session; the authorized source snapshot is embedded in the prompt with line numbers, and every stream event is audited so any tool other than structured output aborts the run. Availability is probed without a model call, the `sonnet`, `opus` and `haiku` aliases are offered, and consent is required before source leaves the machine. `contextualAsk.defaultExecutor` accepts `{ kind: "claude-code" }`.

### Patch Changes

- f0ab188: Show Ask answers where they can be read. An answered question now collapses the composer into a question recap, so the answer card opens at the top of the planner with its executor and model, cascades in block by block, and renders backtick spans as inert inline code. Ask actions stay pinned to the bottom of the planner, the Ask / Change switch slides a shared indicator, and the data summary no longer breaks mid-phrase.
- e5c889c: Keep the Ask executor list loading when the selection changes or a question is cancelled while local executors are still being probed. Capability requests are no longer aborted with question requests, one request serves every selection change, and its result is applied whenever it arrives, so the panel can no longer stay on "Checking available executors" indefinitely.
- ed8f1bf: Fix Contextual Ask rejecting every element of a component that is rendered from another file as "The selected source changed". Authorization compared the selected file with the React render site (for example `main.tsx`) instead of the path that belongs to the same location; the claimed path is now paired with its own file id, and a registry-resolved component anchor is trusted as the server's own evidence.
- b42c755: Keep Managed Codex usable with Codex 0.156 and later. The `account/read` response gained a `workspaceRouting` field, which the exact-key check rejected as a protocol incompatibility, disabling both Managed Codex Ask and managed changes. Account readiness is now parsed by one shared reader that validates only the fields SpotPatch depends on and ignores additions, matching the open-ended supported version range.
- f0ab188: Unify the workbench, floating island and extension panels on one set of design tokens, replacing scattered literal colors. Fix the instruction editor that rendered flush against its card, define the missing panel shadow token, and raise sub-10.5px labels. Hover highlights now glide between elements, new targets and selection outlines animate in, and the planner reveals its sections in sequence; all motion respects `prefers-reduced-motion`. The planner sections reveal through CSS rather than per-section computed-style reads, and the reset-position control is an SVG icon instead of a symbol-font glyph, keeping the click-to-planner latency at its previous level.
- Updated dependencies [f0ab188]
- Updated dependencies [e5c889c]
- Updated dependencies [ed8f1bf]
- Updated dependencies [b42c755]
- Updated dependencies [b42c755]
- Updated dependencies [f0ab188]
  - @spotpatch/runtime@1.15.5
  - @spotpatch/dev-server@0.11.0
  - @spotpatch/shared@1.15.0
  - @spotpatch/bridge@0.5.0

## 0.11.5

### Patch Changes

- 04d3b5b: Accept Astro handoff summaries in the browser runtime so a successfully started managed Agent revision is rendered as running instead of being misreported as an unpublished retryable request.
- Updated dependencies [04d3b5b]
  - @spotpatch/runtime@1.15.4

## 0.11.4

### Patch Changes

- af1bb1b: Allow Codex schema generation and Windows ACL verification enough time to complete on slower hosts while preserving the existing compatibility and access-control checks.
- Updated dependencies [af1bb1b]
  - @spotpatch/bridge@0.4.4
  - @spotpatch/shared@1.14.3

## 0.11.3

### Patch Changes

- 95e513c: Publish the restored shared Agent controls and stable managed-model picker through every framework adapter. Astro and Vite now ship the same shared custom picker as local development, while Next continues to load that exact Runtime entry. Include Astro in the packed npm consumer gate and reject release artifacts that retain the retired native Agent/model controls.

  Coordinate the post-release Bridge descriptor discovery fixes in the same adapter release plan. Existing consumers must still refresh their lockfile when updating an adapter.

- Updated dependencies [95e513c]
  - @spotpatch/runtime@1.15.3
  - @spotpatch/bridge@0.4.3

## 0.11.2

### Patch Changes

- 9c8adbc: Coordinate the external Agent model-catalog protocol across the development server and every framework adapter. This prevents an updated Bridge from returning a catalog that an older strict development-server schema rejects, including projects updating through an existing lockfile.
- Updated dependencies [9c8adbc]
- Updated dependencies [1107f62]
  - @spotpatch/dev-server@0.10.1
  - @spotpatch/shared@1.14.2
  - @spotpatch/bridge@0.4.2

## 0.11.1

### Patch Changes

- Ship the managed Codex model picker through framework integrations, including the Astro and Vite bundled browser panels, with updated shared control protocol and Bridge dependencies.

## 0.11.0

### Minor Changes

- 2d98a66: Initialize revocable managed Codex project grants as part of plain CLI initialization across all adapters; remove implicit development-terminal prompts and show framework-specific setup guidance.

### Patch Changes

- 2d98a66: Add an Astro development integration with native template and React-island source markers, bounded source context, shared AI review/apply/revert, read-only Contextual Ask, external-Agent Inbox/managed controls and Astro-aware trusted validation. Share service ownership across Vite, Next and Astro without changing their transport boundaries. Add original-coordinate native source projections, browser-script instrumentation and scoped navigation exclusions; never infer server execution from browser observations. Preserve JSX markers, production isolation and existing security policies. Compatibility and external-Agent maturity remain limited to the documented evidence; this change does not publish the new package.
- 2d98a66: Add a shared, accessible Managed Codex Ask model picker backed by the local model catalog, with bounded discovery, execution-time validation and explicit model dispatch.
- Updated dependencies [2d98a66]
- Updated dependencies [2d98a66]
- Updated dependencies [2d98a66]
- Updated dependencies [16d19c0]
  - @spotpatch/shared@1.14.0
  - @spotpatch/runtime@1.15.0
  - @spotpatch/dev-server@0.10.0
  - @spotpatch/bridge@0.4.0
  - @spotpatch/compiler@0.4.0

## 0.10.0

### Minor Changes

- 0d3a94b: Add the capability-gated Contextual Ask beta across the shared protocol, immutable source snapshots, Configured Key and Managed Codex read-only executors, Vite and Next transports, and the lazy Runtime planner UI. Ask requires an explicit element selection, returns a single cited answer, never exposes write tools or persistent chat history, and can convert the current answer into an editable local Change draft without creating a write job.

  The release gate now packs every public package and installs the tarballs together in a clean npm consumer before exercising real Vite and Next development and production hosts. CI covers Node 20 and 22 on Ubuntu, Windows, and macOS, the audited Vite 5/6/7 and Next 15/16 host matrix, Windows native npm Codex resolution, production leakage, package exports, and the existing compatibility suites.

### Patch Changes

- Updated dependencies [0d3a94b]
  - @spotpatch/shared@1.13.0
  - @spotpatch/dev-server@0.9.0
  - @spotpatch/bridge@0.3.0
  - @spotpatch/runtime@1.14.0

## 0.9.0

### Minor Changes

- 02e4f5d: Publish the capability-gated Codex compatibility path and the unified Dynamic Island runtime. Stable Codex releases at or above the supported baseline are validated against the exact executable's generated App Server schema and the existing live safety preflight instead of a hard-coded minor-version ceiling; incompatible capabilities continue to fail closed to Inbox, and managed execution recovers missing threads without weakening isolation.

  Runtime now owns the single motion implementation and public motion registration entry consumed by both Vite and Next, so both adapters ship the same production Dynamic Island UI, shared morph behavior, reduced-motion handling, and lifecycle cleanup without duplicated CSS or adapter-specific animation code.

### Patch Changes

- Updated dependencies [02e4f5d]
  - @spotpatch/bridge@0.2.1
  - @spotpatch/runtime@1.13.0

## 0.8.0

### Minor Changes

- 2f961b2: Add the development-only Next.js component data-flow public preview while preserving the Vite evidence model. The shared compiler now exposes prepared instrumentation, the authenticated source registration path atomically installs component anchors, and the shared runtime owns recorder policy and panel registration. Next partitions source and data-flow transforms across browser/server webpack and Turbopack targets, installs the dispatch recorder before hydration, excludes internal RSC transports, and aliases both browser entries to a no-op outside development. React 19 component identity accepts compiler registrations only and discovers renderers across separately bundled bippy instances. Initialization enables the shared data-flow option, while production output remains free of executable markers, recorder, panel, routes, and credentials.

### Patch Changes

- Updated dependencies [2f961b2]
  - @spotpatch/compiler@0.3.0
  - @spotpatch/dev-server@0.8.0
  - @spotpatch/runtime@1.12.0
  - @spotpatch/shared@1.12.0

## 0.7.0

### Minor Changes

- 1f1e170: Add the opt-in, development-only external Agent handoff and managed-dispatch foundation: a memory-only authenticated loopback Broker, project-scoped discovery, request-idempotent handoffs, a per-development-session writer lease, four project-content-read-only MCP tools, a persistent Bridge event pump, experimental Claude Channel support, safe Inbox setup generators, and shared Vite/Next lifecycle integration. Codex managed mode is owned by `pnpm dev` and uses a page control surface backed by terminal consent, a user-private project grant, independent Git metadata/workspace snapshots, restricted read roots, per-revision App Server threads, fixed no-network/no-approval policy, allowed-path and cache-pollution audits, explicit required checks, hash-safe apply, structured progress, and honest Inbox fallback. A project-keyed private Codex runtime home prevents inherited user MCP/hooks/plugins from bypassing the sandbox; strict hook/MCP preflight, a restricted model-shell environment, bounded opaque file-auth linking, and exact revoke cleanup fail closed without writing runtime state into the business repository. Managed snapshots require only the authorized target paths to be tracked and clean; unrelated local changes remain outside the snapshot and are preserved. Cursor and generic MCP hosts remain Inbox-only. This is local-validation functionality and does not declare stable Claude Code, Codex, Cursor, managed real-host, or cross-platform release support.

### Patch Changes

- Updated dependencies [1f1e170]
  - @spotpatch/bridge@0.2.0
  - @spotpatch/shared@1.11.0
  - @spotpatch/dev-server@0.7.0
  - @spotpatch/runtime@1.11.0

## 0.6.0

### Minor Changes

- f8cd6b7: Add the opt-in, development-only external Agent handoff and active-dispatch foundation: a memory-only authenticated loopback Broker, project-scoped discovery, request-idempotent handoffs, a per-development-session managed-writer lease/dispatch state machine, four project-content-read-only MCP tools, a persistent Bridge event pump, experimental Claude Channel and Codex App Server adapters, safe Inbox setup generators, truthful Runtime status, and shared Vite/Next lifecycle integration. Codex active mode is a single explicit command that injects SpotPatch MCP into its owned App Server thread without writing project Codex configuration. Cursor and generic MCP hosts remain Inbox-only, and the managed lease does not claim an operating-system-wide writer lock. This is local-validation functionality and does not declare stable Claude Code, Codex, Cursor, or cross-platform release support.

### Patch Changes

- Updated dependencies [f8cd6b7]
  - @spotpatch/bridge@0.1.0
  - @spotpatch/shared@1.10.0
  - @spotpatch/dev-server@0.6.0
  - @spotpatch/runtime@1.10.0

## 0.5.0

### Minor Changes

- 6c753d6: Add the Vite and React 18 component data-flow Beta. The new evidence-first pipeline maps selected composite-component DOM back to registered business components, analyzes supported fetch/Axios/React Query chains and consumed fields, records value-free fetch/XHR dispatch observations, and displays component and page API reports without guessing ambiguous ownership. It also includes an experimental tRPC adapter that reports logical procedures separately from physical batch transport.

  The public option remains disabled when omitted, while the Vite `setup/init` initializer writes `dataFlow: {}` so a freshly initialized project receives the complete integration. The feature is dispatch-only and development-only, and keeps unsupported traffic partial, unknown, or unassigned. It does not read response bodies or enable data-flow AI. The Next.js preview rejects this option until its Loader, prelude, panel, and compatibility gates are implemented.

  The analyzer regression suite is fully self-contained and uses neutral, temporary multi-module fixtures; published source and tests do not depend on or identify external application repositories. Entry-source lookup and root containment use native canonical paths with filesystem-identity fallbacks, so Windows drive casing, separators, and 8.3 temporary-directory aliases do not turn a valid report into an internal error.

### Patch Changes

- Updated dependencies [6c753d6]
  - @spotpatch/shared@1.9.0
  - @spotpatch/compiler@0.2.0
  - @spotpatch/dev-server@0.5.0
  - @spotpatch/runtime@1.9.0

## 0.4.0

### Minor Changes

- df52b66: Make the explicitly consented trusted mode a direct, low-latency path. It now
  starts from SpotPatch's exact source location, omits the `run_check` tool,
  skips host project checks, and applies the isolated Diff immediately while
  retaining project boundaries, atomic patching, conflict detection, and Revert.
  Review and gated auto modes continue to run configured checks.

### Patch Changes

- Updated dependencies [df52b66]
  - @spotpatch/dev-server@0.4.0
  - @spotpatch/runtime@1.8.0

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
