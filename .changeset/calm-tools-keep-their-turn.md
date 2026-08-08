---
"@spotpatch/shared": minor
"@spotpatch/agent": patch
"@spotpatch/runtime": minor
"@spotpatch/vite": minor
---

Allow OpenAI-compatible relays to reuse a provider tool call ID in a later model
turn without replaying an earlier result. Idempotency and activity tracking are
now scoped by SpotPatch turn, while conflicting IDs within one turn still fail
closed before source mutation.

Report malformed tool arguments and same-turn call ID conflicts as distinct,
actionable errors. Parsed argument objects that miss the strict contract now
return a bounded zero-mutation retry result so the model can correct them with a
new call ID.
