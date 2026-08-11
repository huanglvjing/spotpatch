---
"@spotpatch/shared": minor
"@spotpatch/dev-server": minor
"@spotpatch/runtime": minor
"@spotpatch/vite": minor
"@spotpatch/next": minor
---

Add a page-level Review/Trusted Fast selector that defaults to review, a safe low-configuration trusted mode with automatic local TypeScript validation, and matching Vite and Next initialization workflows. Vite now provides `spotpatch-vite init` and `spotpatch-vite check`, while both initializers use atomic file plans and enable the trusted option only when a project validation command can be discovered safely.
