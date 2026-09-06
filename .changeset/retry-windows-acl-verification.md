---
"@spotpatch/shared": patch
"@spotpatch/bridge": patch
---

Retry transient Windows ACL reads only while the exact same descriptor path and filesystem identity still exist. Validation remains fail-closed for changed, missing, insecure, or repeatedly unreadable paths, while avoiding sporadic Windows error-code-3 failures during connector discovery.
