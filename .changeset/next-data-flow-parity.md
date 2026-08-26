---
"@spotpatch/compiler": minor
"@spotpatch/dev-server": minor
"@spotpatch/next": minor
"@spotpatch/react-adapter": minor
"@spotpatch/runtime": minor
"@spotpatch/shared": minor
"@spotpatch/vite": minor
---

Add the development-only Next.js component data-flow public preview while preserving the Vite evidence model. The shared compiler now exposes prepared instrumentation, the authenticated source registration path atomically installs component anchors, and the shared runtime owns recorder policy and panel registration. Next partitions source and data-flow transforms across browser/server webpack and Turbopack targets, installs the dispatch recorder before hydration, excludes internal RSC transports, and aliases both browser entries to a no-op outside development. React 19 component identity accepts compiler registrations only and discovers renderers across separately bundled bippy instances. Initialization enables the shared data-flow option, while production output remains free of executable markers, recorder, panel, routes, and credentials.
