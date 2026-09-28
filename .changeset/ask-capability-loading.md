---
"@spotpatch/runtime": patch
"@spotpatch/vite": patch
"@spotpatch/astro": patch
"@spotpatch/next": patch
---

Keep the Ask executor list loading when the selection changes or a question is cancelled while local executors are still being probed. Capability requests are no longer aborted with question requests, one request serves every selection change, and its result is applied whenever it arrives, so the panel can no longer stay on "Checking available executors" indefinitely.
