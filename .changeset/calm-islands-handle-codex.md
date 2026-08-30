---
"@spotpatch/agent": patch
"@spotpatch/bridge": patch
"@spotpatch/runtime": minor
"@spotpatch/vite": minor
"@spotpatch/next": minor
---

Publish the capability-gated Codex compatibility path and the unified Dynamic Island runtime. Stable Codex releases at or above the supported baseline are validated against the exact executable's generated App Server schema and the existing live safety preflight instead of a hard-coded minor-version ceiling; incompatible capabilities continue to fail closed to Inbox, and managed execution recovers missing threads without weakening isolation.

Runtime now owns the single motion implementation and public motion registration entry consumed by both Vite and Next, so both adapters ship the same production Dynamic Island UI, shared morph behavior, reduced-motion handling, and lifecycle cleanup without duplicated CSS or adapter-specific animation code.
