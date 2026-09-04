# Contextual Ask Q1 experiments

This private workspace package contains the blocking POCs defined by
`doc-id:context-qa-09-testing-delivery`. It has no public exports, is excluded from npm
publication, and must not be imported by a production package.

## Reproducible gates

From the repository root:

```bash
pnpm test:contextual-ask-q1
pnpm test:contextual-ask-q1:browser
pnpm test:contextual-ask-q1:live
```

The deterministic command proves the four-tool Configured Key loop through the real
SpotPatch Responses and Chat Completions session implementations, regenerates the schema
for the selected Codex executable, builds the existing Runtime and the isolated Ask UI
POC, and measures the 40-block/64-source case.

The browser command uses real headless Chromium at a 320 CSS-pixel viewport and repeats
the layout check with a 200% root font size. Screenshots are diagnostic evidence, not
golden snapshots.

The live command uses the current authenticated Codex account. It creates only synthetic
files under an OS temporary directory, links the existing private Codex authentication
file into an isolated runtime home using the production managed-runtime helper, and never
prints or stores credential content. Its `spotpatch-ask-readonly` permission profile is
root-deny, minimal-read, projection-read, and network-disabled. The test removes the
projection and isolated runtime in `finally`.

Generated evidence is written under `.artifacts/` and intentionally ignored by Git.
Stable conclusions and exact commands are recorded in [CONCLUSION.md](./CONCLUSION.md).

## Boundary

These files establish feasibility only. They are not the public Contextual Ask protocol,
Manager, executor, Runtime integration, or supported product capability. Production code
may reuse proven contracts after Gate Q2 but cannot import this experiment.
