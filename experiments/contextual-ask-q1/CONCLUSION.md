# Contextual Ask Q1 conclusion

Status: `passed-local-poc`
Date: 2026-09-01
Host: macOS, Node 20-compatible repository toolchain, authenticated `codex-cli 0.151.0`

## Q1-A · Configured Key

Passed with the existing `@spotpatch/agent` Provider session implementation for both
Responses and Chat Completions:

- the model receives exactly `list_sources`, `search_sources`, `read_source`, and
  `submit_answer`;
- source access uses issued IDs and bounded lines, not model-provided filesystem paths;
- the result requires an observed citation handle;
- direct final text, fabricated citations, mixed/unknown/write tools, and lost
  cancellation fail closed;
- Responses uses `store: false`; tool results remain in the in-memory request chain; and
- serialized Provider bodies contain neither the credential nor any write tool name.

This is deterministic fake-transport evidence around the real SpotPatch Provider protocol
implementation. It is not a claim that every third-party OpenAI-compatible relay behaves
correctly; that remains a capability probe and release-matrix responsibility.

## Q1-B · Managed Codex

The locked executable generated a schema bundle with the required turn/item notifications,
`turn/start.outputSchema`, final `agentMessage`, named permission selection, ephemeral
thread support, classic `readOnly`, and `thread/delete`.

One authenticated App Server turn then proved:

- active permission profile: `spotpatch-ask-readonly`;
- filesystem policy: `:root = deny`, `:minimal = read`, exact workspace root = read;
- network, apps, hooks, plugins, remote plugins, web search, agents, and MCP disabled;
- `instructionSources = 0`, hooks = 0, MCP servers = 0;
- selected `src/Card.tsx` was readable;
- an attempted read of a synthetic file outside the projection was denied;
- an attempted projection write was denied and no file appeared;
- no `fileChange` item was emitted;
- the authoritative final `item/completed.agentMessage` satisfied `outputSchema`;
- 48 answer delta events preceded the authoritative item;
- terminal status was `completed`; and
- the ephemeral thread was absent from `thread/list`.

The observed turn took 135,896 ms. The generated schema SHA-256 was
`d6824af76e35868701cc79fe935c642bcb7acfc68e2ade063834be6089c84495`.

Important compatibility result: the generated 0.151.0 classic `readOnly` union does not
contain the official documentation's newer restricted-readable-roots shape. The proven
least-privilege path for this locked executable is the named permission profile. Product
code must feature-detect this and fail closed; it must not send unsupported fields.

This is one local feasibility turn. Cross-platform, double-job isolation, interruption,
process-crash, and cleanup fault injection remain Gate Q6 release work.

## Q1-C · UI and performance

The Ask panel remains a separate optional IIFE; the current Runtime has no import or export
edge to the POC.

| Metric                               |    Result |         POC budget |
| ------------------------------------ | --------: | -----------------: |
| Ask bundle raw                       |   6,905 B |         diagnostic |
| Ask bundle gzip                      |   2,762 B |            < 8 KiB |
| Existing Runtime ESM raw             | 275,652 B | unchanged baseline |
| Existing Runtime ESM gzip            |  58,887 B | unchanged baseline |
| 39,640-character answer mount median |   2.47 ms |            < 30 ms |
| 39,640-character answer mount P95    |   6.23 ms |            < 80 ms |
| Ask/Change switch P95                |  0.011 ms |             < 2 ms |
| Long-answer DOM nodes                |       265 |              < 400 |

Real Chromium passed at 320 px and again with a 200% root font size without document-level
horizontal overflow. The fixtures used 40 answer blocks and 64 source references.

## Decision

Q1 feasibility is sufficient to begin Gate Q2 public models and local protocol. It does
not enable a product flag, register an executor, or change the public support matrix.
