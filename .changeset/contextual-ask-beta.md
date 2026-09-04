---
"@spotpatch/shared": minor
"@spotpatch/agent": minor
"@spotpatch/dev-server": minor
"@spotpatch/bridge": minor
"@spotpatch/runtime": minor
"@spotpatch/vite": minor
"@spotpatch/next": minor
---

Add the capability-gated Contextual Ask beta across the shared protocol, immutable source snapshots, Configured Key and Managed Codex read-only executors, Vite and Next transports, and the lazy Runtime planner UI. Ask requires an explicit element selection, returns a single cited answer, never exposes write tools or persistent chat history, and can convert the current answer into an editable local Change draft without creating a write job.

The release gate now packs every public package and installs the tarballs together in a clean npm consumer before exercising real Vite and Next development and production hosts. CI covers Node 20 and 22 on Ubuntu, Windows, and macOS, the audited Vite 5/6/7 and Next 15/16 host matrix, Windows native npm Codex resolution, production leakage, package exports, and the existing compatibility suites.
