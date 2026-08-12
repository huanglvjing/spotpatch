---
"@spotpatch/vite": major
---

Make `@spotpatch/vite` a configuration-only Vite integration. The package no longer publishes the unsupported `spotpatch-vite` executable or an initializer that edits application configuration. Import `spotPatch` in `vite.config.*`, place it before the React plugin, and start the application with its normal development script.
