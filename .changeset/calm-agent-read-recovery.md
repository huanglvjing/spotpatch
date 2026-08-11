---
"@spotpatch/agent": patch
---

Keep denied or unavailable `read_file` calls inside the bounded Agent loop so
the model can recover through allowed discovery results without weakening path
or write protections.
