---
"@spotpatch/shared": minor
"@spotpatch/compiler": minor
"@spotpatch/analyzer": minor
"@spotpatch/dev-server": minor
"@spotpatch/react-adapter": minor
"@spotpatch/runtime": minor
"@spotpatch/next": minor
"@spotpatch/vite": minor
---

Add the Vite and React 18 component data-flow Beta. The new evidence-first pipeline maps selected composite-component DOM back to registered business components, analyzes supported fetch/Axios/React Query chains and consumed fields, records value-free fetch/XHR dispatch observations, and displays component and page API reports without guessing ambiguous ownership. It also includes an experimental tRPC adapter that reports logical procedures separately from physical batch transport.

The public option remains disabled when omitted, while the Vite `setup/init` initializer writes `dataFlow: {}` so a freshly initialized project receives the complete integration. The feature is dispatch-only and development-only, and keeps unsupported traffic partial, unknown, or unassigned. It does not read response bodies or enable data-flow AI. The Next.js preview rejects this option until its Loader, prelude, panel, and compatibility gates are implemented.

The analyzer regression suite is fully self-contained and uses neutral, temporary multi-module fixtures; published source and tests do not depend on or identify external application repositories. Entry-source lookup also accepts filesystem-equivalent canonical paths so Windows drive casing and separator normalization do not turn a valid report into an internal error.
