# @spotpatch/react-adapter

## 1.2.0

### Minor Changes

- 2f961b2: Add the development-only Next.js component data-flow public preview while preserving the Vite evidence model. The shared compiler now exposes prepared instrumentation, the authenticated source registration path atomically installs component anchors, and the shared runtime owns recorder policy and panel registration. Next partitions source and data-flow transforms across browser/server webpack and Turbopack targets, installs the dispatch recorder before hydration, excludes internal RSC transports, and aliases both browser entries to a no-op outside development. React 19 component identity accepts compiler registrations only and discovers renderers across separately bundled bippy instances. Initialization enables the shared data-flow option, while production output remains free of executable markers, recorder, panel, routes, and credentials.

### Patch Changes

- Updated dependencies [2f961b2]
  - @spotpatch/shared@1.12.0

## 1.1.0

### Minor Changes

- 6c753d6: Add the Vite and React 18 component data-flow Beta. The new evidence-first pipeline maps selected composite-component DOM back to registered business components, analyzes supported fetch/Axios/React Query chains and consumed fields, records value-free fetch/XHR dispatch observations, and displays component and page API reports without guessing ambiguous ownership. It also includes an experimental tRPC adapter that reports logical procedures separately from physical batch transport.

  The public option remains disabled when omitted, while the Vite `setup/init` initializer writes `dataFlow: {}` so a freshly initialized project receives the complete integration. The feature is dispatch-only and development-only, and keeps unsupported traffic partial, unknown, or unassigned. It does not read response bodies or enable data-flow AI. The Next.js preview rejects this option until its Loader, prelude, panel, and compatibility gates are implemented.

  The analyzer regression suite is fully self-contained and uses neutral, temporary multi-module fixtures; published source and tests do not depend on or identify external application repositories. Entry-source lookup and root containment use native canonical paths with filesystem-identity fallbacks, so Windows drive casing, separators, and 8.3 temporary-directory aliases do not turn a valid report into an internal error.

### Patch Changes

- Updated dependencies [6c753d6]
  - @spotpatch/shared@1.9.0

## 1.0.1

### Patch Changes

- 2bbdafc: Replace oversized npm README logos with a compact icon-and-package-name heading
  that remains consistently sized when npm sanitizes image attributes.
- Updated dependencies [0218aa7]
- Updated dependencies [2bbdafc]
  - @spotpatch/shared@1.6.0

## 1.0.0

### Major Changes

- 8b49469: Release the initial SpotPatch v1 implementation with development-only source
  markers, secure local source access, React 18 resolution, sanitized multi-target
  context collection, bilingual prompt composition, a contextual Shadow DOM
  workbench, and an optional review-gated AI code Agent.

### Patch Changes

- Updated dependencies [8b49469]
  - @spotpatch/shared@1.0.0
