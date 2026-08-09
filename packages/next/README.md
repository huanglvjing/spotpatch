# @spotpatch/next

Development-only Next.js adapter for SpotPatch.

> Status: local preview. The package is version `0.0.0` in this repository and
> has not been published or promoted to the public Next.js support matrix.

## What this package owns

- `withSpotPatch()` composes the host `next.config` without evaluating it a
  second time.
- `spotpatch-next dev` owns the local Next child process and the loopback-only
  Sidecar lifecycle.
- A development-only Loader registers source files and injects source markers
  for Turbopack and webpack.
- `@spotpatch/next/client` installs the React hook synchronously from Next's
  `instrumentation-client` entry, then bootstraps the SpotPatch Runtime.
- Production config aliases the client entry to a side-effect-free noop and
  does not add the Loader, rewrite, Sidecar, or source registry.

The current package accepts Next.js `>=15.3.0 <17.0.0`, React 18/19 peer
dependencies, and Node.js `>=20.19.0`. That install range is not a claim that
the complete release matrix has passed.

## Integration

Install the package from this workspace while it is unpublished, then run:

```bash
pnpm exec spotpatch-next init
pnpm exec spotpatch-next check
```

The resulting integration has these three parts:

```ts
// next.config.ts
import type { NextConfig } from "next";
import { withSpotPatch } from "@spotpatch/next";

const nextConfig: NextConfig = {};

export default withSpotPatch()(nextConfig);
```

```ts
// instrumentation-client.ts, or src/instrumentation-client.ts for a src router
import "@spotpatch/next/client";
```

```json
{
  "scripts": {
    "dev": "spotpatch-next dev"
  }
}
```

Start development with the package script, not with a direct `next dev`:

```bash
pnpm dev
```

The first preview only accepts a loopback hostname. By default, open the exact
origin printed by the CLI (`http://localhost:3000`). A successful activation
prints a single line beginning with `[spotpatch:next] ready`. The Runtime then
mounts a `spotpatch-root` Shadow DOM host with the “Select element”/“选择元素”
button.

If React reports only a removed body attribute such as
`cz-shortcut-listen="true"`, a browser extension changed the document before
hydration. That warning is independent of SpotPatch initialization.

## Production behavior

Use the ordinary Next commands:

```bash
pnpm exec next build
pnpm exec next start
```

`spotpatch-next` intentionally proxies only `dev`. A production build must not
contain `data-spotpatch-source`, `spotpatch-root`, SpotPatch bootstrap state,
the private API prefix, or internal configuration/registration secrets.

## Current release boundary

The local preview has passed package build/type publication checks, formal
unit tests, Next 16 App Router development with both Turbopack and webpack,
webpack Fast Refresh, source-context lookup, and webpack production isolation
in the private marketing host. Publication still requires the full required
Next/React/router/Node/OS matrix, fresh browser interaction evidence, and a
Turbopack production rerun outside the restricted agent execution environment.

The first preview deliberately rejects LAN hostnames and `allowLan: true`.
Complex CommonJS `next.config` files and conflicting Loader rule/rewrite keys
require manual integration and fail closed.
