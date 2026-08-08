# @spotpatch/agent

The Node-only SpotPatch Agent engine for provider protocols, bounded tools,
isolated Git worktrees, validation checks, review, Apply, and conflict-safe
Revert.

Applications should enable this capability through trusted provider profiles in
[`@spotpatch/vite`](https://www.npmjs.com/package/@spotpatch/vite). This package
does not expose model-controlled shell execution and must never receive browser
environment API keys.
