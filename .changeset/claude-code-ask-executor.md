---
"@spotpatch/shared": minor
"@spotpatch/dev-server": minor
"@spotpatch/bridge": minor
"@spotpatch/vite": minor
"@spotpatch/astro": minor
"@spotpatch/next": minor
---

Add Claude Code as a Contextual Ask executor. A signed-in local Claude Code 2.1.283 or later answers each question in a disposable headless session with no tools, MCP servers, settings sources, slash commands or persisted session; the authorized source snapshot is embedded in the prompt with line numbers, and every stream event is audited so any tool other than structured output aborts the run. Availability is probed without a model call, the `sonnet`, `opus` and `haiku` aliases are offered, and consent is required before source leaves the machine. `contextualAsk.defaultExecutor` accepts `{ kind: "claude-code" }`.
