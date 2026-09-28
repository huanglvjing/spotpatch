---
"@spotpatch/runtime": patch
"@spotpatch/vite": patch
"@spotpatch/astro": patch
"@spotpatch/next": patch
---

Unify the workbench, floating island and extension panels on one set of design tokens, replacing scattered literal colors. Fix the instruction editor that rendered flush against its card, define the missing panel shadow token, and raise sub-10.5px labels. Hover highlights now glide between elements, new targets and selection outlines animate in, and the planner reveals its sections in sequence; all motion respects `prefers-reduced-motion`. The planner sections reveal through CSS rather than per-section computed-style reads, and the reset-position control is an SVG icon instead of a symbol-font glyph, keeping the click-to-planner latency at its previous level.
