---
"@spotpatch/vite": patch
---

Make one-command setup reliable with pnpm 11's default 24-hour release quarantine. The latest CLI now installs its own exact package version instead of resolving the `latest` tag a second time, preventing pnpm from silently selecting the newest day-old SpotPatch release.
