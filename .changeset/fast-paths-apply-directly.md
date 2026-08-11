---
"@spotpatch/agent": minor
"@spotpatch/dev-server": minor
"@spotpatch/runtime": minor
"@spotpatch/vite": minor
"@spotpatch/next": minor
---

Make the explicitly consented trusted mode a direct, low-latency path. It now
starts from SpotPatch's exact source location, omits the `run_check` tool,
skips host project checks, and applies the isolated Diff immediately while
retaining project boundaries, atomic patching, conflict detection, and Revert.
Review and gated auto modes continue to run configured checks.
