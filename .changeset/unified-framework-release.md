---
"@spotpatch/runtime": patch
"@spotpatch/bridge": patch
"@spotpatch/astro": patch
"@spotpatch/vite": patch
"@spotpatch/next": patch
---

Publish the restored shared Agent controls and stable managed-model picker through every framework adapter. Astro and Vite now ship the same shared custom picker as local development, while Next continues to load that exact Runtime entry. Include Astro in the packed npm consumer gate and reject release artifacts that retain the retired native Agent/model controls.

Coordinate the post-release Bridge descriptor discovery fixes in the same adapter release plan. Existing consumers must still refresh their lockfile when updating an adapter.
