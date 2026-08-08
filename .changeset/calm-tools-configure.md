---
"@spotpatch/agent": minor
"@spotpatch/shared": minor
"@spotpatch/vite": minor
---

Add secure convention-based AI setup for `spotPatch()`, a concise single-provider
configuration API, and restricted `x-api-key` authentication alongside Bearer
credentials. Complete `SPOTPATCH_AI_*` environment values now enable AI without
duplicating provider defaults, while partial configuration fails fast and secrets
remain confined to the Vite Node process.
