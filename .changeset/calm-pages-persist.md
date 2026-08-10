---
"@spotpatch/agent": patch
"@spotpatch/dev-server": patch
"@spotpatch/next": patch
"@spotpatch/runtime": minor
"@spotpatch/shared": minor
"@spotpatch/vite": patch
---

Preserve completed element selections and their individual page context across
same-project navigation, reloads, and workbench close/reopen cycles. Detached DOM
nodes are released while sanitized target context remains available, and a
non-secret development session identity prevents stale drafts from crossing
server restarts.
