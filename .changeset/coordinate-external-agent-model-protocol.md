---
"@spotpatch/dev-server": patch
"@spotpatch/astro": patch
"@spotpatch/vite": patch
"@spotpatch/next": patch
---

Coordinate the external Agent model-catalog protocol across the development server and every framework adapter. This prevents an updated Bridge from returning a catalog that an older strict development-server schema rejects, including projects updating through an existing lockfile.
