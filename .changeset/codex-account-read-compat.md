---
"@spotpatch/bridge": patch
"@spotpatch/vite": patch
"@spotpatch/astro": patch
"@spotpatch/next": patch
---

Keep Managed Codex usable with Codex 0.156 and later. The `account/read` response gained a `workspaceRouting` field, which the exact-key check rejected as a protocol incompatibility, disabling both Managed Codex Ask and managed changes. Account readiness is now parsed by one shared reader that validates only the fields SpotPatch depends on and ignores additions, matching the open-ended supported version range.
