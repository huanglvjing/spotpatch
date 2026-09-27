---
"@spotpatch/dev-server": patch
"@spotpatch/vite": patch
"@spotpatch/astro": patch
"@spotpatch/next": patch
---

Fix Contextual Ask rejecting every element of a component that is rendered from another file as "The selected source changed". Authorization compared the selected file with the React render site (for example `main.tsx`) instead of the path that belongs to the same location; the claimed path is now paired with its own file id, and a registry-resolved component anchor is trusted as the server's own evidence.
