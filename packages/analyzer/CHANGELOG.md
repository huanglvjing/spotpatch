# @spotpatch/analyzer

## 0.2.0

### Minor Changes

- 2d98a66: Add an Astro development integration with native template and React-island source markers, bounded source context, shared AI review/apply/revert, read-only Contextual Ask, external-Agent Inbox/managed controls and Astro-aware trusted validation. Share service ownership across Vite, Next and Astro without changing their transport boundaries. Add original-coordinate native source projections, browser-script instrumentation and scoped navigation exclusions; never infer server execution from browser observations. Preserve JSX markers, production isolation and existing security policies. Compatibility and external-Agent maturity remain limited to the documented evidence; this change does not publish the new package.

### Patch Changes

- Updated dependencies [2d98a66]
- Updated dependencies [2d98a66]
- Updated dependencies [16d19c0]
  - @spotpatch/shared@1.14.0
  - @spotpatch/compiler@0.4.0

## 0.1.1

### Patch Changes

- Updated dependencies [2f961b2]
  - @spotpatch/compiler@0.3.0
  - @spotpatch/shared@1.12.0

## 0.1.0

### Minor Changes

- 6c753d6: Add the Vite and React 18 component data-flow Beta. The new evidence-first pipeline maps selected composite-component DOM back to registered business components, analyzes supported fetch/Axios/React Query chains and consumed fields, records value-free fetch/XHR dispatch observations, and displays component and page API reports without guessing ambiguous ownership. It also includes an experimental tRPC adapter that reports logical procedures separately from physical batch transport.

  The public option remains disabled when omitted, while the Vite `setup/init` initializer writes `dataFlow: {}` so a freshly initialized project receives the complete integration. The feature is dispatch-only and development-only, and keeps unsupported traffic partial, unknown, or unassigned. It does not read response bodies or enable data-flow AI. The Next.js preview rejects this option until its Loader, prelude, panel, and compatibility gates are implemented.

  The analyzer regression suite is fully self-contained and uses neutral, temporary multi-module fixtures; published source and tests do not depend on or identify external application repositories. Entry-source lookup and root containment use native canonical paths with filesystem-identity fallbacks, so Windows drive casing, separators, and 8.3 temporary-directory aliases do not turn a valid report into an internal error.

### Patch Changes

- Updated dependencies [6c753d6]
  - @spotpatch/shared@1.9.0
  - @spotpatch/compiler@0.2.0
