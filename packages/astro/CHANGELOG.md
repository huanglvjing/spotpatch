# @spotpatch/astro

## 0.2.0

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

## 0.1.9

### Patch Changes

- 04d3b5b: Accept Astro handoff summaries in the browser runtime so a successfully started managed Agent revision is rendered as running instead of being misreported as an unpublished retryable request.
- Updated dependencies [04d3b5b]
  - @spotpatch/runtime@1.15.4

## 0.1.8

### Patch Changes

- af1bb1b: Allow Codex schema generation and Windows ACL verification enough time to complete on slower hosts while preserving the existing compatibility and access-control checks.
- Updated dependencies [af1bb1b]
  - @spotpatch/bridge@0.4.4
  - @spotpatch/shared@1.14.3

## 0.1.7

### Patch Changes

- 95e513c: Publish the restored shared Agent controls and stable managed-model picker through every framework adapter. Astro and Vite now ship the same shared custom picker as local development, while Next continues to load that exact Runtime entry. Include Astro in the packed npm consumer gate and reject release artifacts that retain the retired native Agent/model controls.

  Coordinate the post-release Bridge descriptor discovery fixes in the same adapter release plan. Existing consumers must still refresh their lockfile when updating an adapter.

- Updated dependencies [95e513c]
  - @spotpatch/runtime@1.15.3
  - @spotpatch/bridge@0.4.3

## 0.1.6

### Patch Changes

- 9c8adbc: Coordinate the external Agent model-catalog protocol across the development server and every framework adapter. This prevents an updated Bridge from returning a catalog that an older strict development-server schema rejects, including projects updating through an existing lockfile.
- Updated dependencies [9c8adbc]
- Updated dependencies [1107f62]
  - @spotpatch/dev-server@0.10.1
  - @spotpatch/shared@1.14.2
  - @spotpatch/bridge@0.4.2

## 0.1.5

### Patch Changes

- Ship the managed Codex model picker through framework integrations, including the Astro and Vite bundled browser panels, with updated shared control protocol and Bridge dependencies.

## 0.1.4

### Patch Changes

- Keep body-local invocation tokens out of default parameter initializers and computed method names. Preserve optional-chain short-circuiting by leaving call chains unwrapped, avoiding runtime ReferenceError and TypeError failures in instrumented applications.
- Updated dependencies
  - @spotpatch/compiler@0.4.2

## 0.1.3

### Patch Changes

- Preserve calls containing await or yield in their receiver, callee, or computed property during data-flow instrumentation. Skip synchronous wrapping of these calls instead of moving suspension into an invalid callback, while continuing to instrument safe child calls.
- Updated dependencies
  - @spotpatch/compiler@0.4.1

## 0.1.2

### Patch Changes

- d2c97dc: Make `spotpatch-astro init` safely update supported static Astro configurations before initializing Managed Codex authorization. Enable data flow, Contextual Ask, external-Agent controls and discoverable Astro Trusted direct validation without replacing existing integrations or explicit options; add `spotpatch-astro check` for read-only verification and fail without writes for ambiguous configurations.

## 0.1.1

### Patch Changes

- 2fc5a8f: Publish the Astro integration documentation for registry installation, the verified Astro 5/6/7 compatibility matrix, development-only production isolation, and Managed Codex initialization. Document the official npm registry fallback for mirrors that have not synchronized newly published SpotPatch dependencies.

## 0.1.0

### Minor Changes

- 2d98a66: Add an Astro development integration with native template and React-island source markers, bounded source context, shared AI review/apply/revert, read-only Contextual Ask, external-Agent Inbox/managed controls and Astro-aware trusted validation. Share service ownership across Vite, Next and Astro without changing their transport boundaries. Add original-coordinate native source projections, browser-script instrumentation and scoped navigation exclusions; never infer server execution from browser observations. Preserve JSX markers, production isolation and existing security policies. Compatibility and external-Agent maturity remain limited to the documented evidence; this change does not publish the new package.
- 2d98a66: Initialize revocable managed Codex project grants as part of plain CLI initialization across all adapters; remove implicit development-terminal prompts and show framework-specific setup guidance.

### Patch Changes

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
