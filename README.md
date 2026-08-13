<p align="center">
  <a href="https://github.com/huanglvjing/spotpatch">
    <img src="./docs/assets/spotpatch-logo-mark.svg" alt="SpotPatch logo mark" width="160" />
  </a>
</p>

<h1 align="center">SpotPatch</h1>

<p align="center">
  <strong>English</strong> · <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@spotpatch/vite"><img src="https://img.shields.io/npm/v/%40spotpatch%2Fvite?logo=npm&label=%40spotpatch%2Fvite" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@spotpatch/next"><img src="https://img.shields.io/npm/v/%40spotpatch%2Fnext?logo=npm&label=%40spotpatch%2Fnext" alt="Next.js preview version" /></a>
  <a href="https://www.npmjs.com/package/@spotpatch/vite"><img src="https://img.shields.io/npm/dm/%40spotpatch%2Fvite?logo=npm&label=downloads" alt="npm downloads" /></a>
  <a href="https://github.com/huanglvjing/spotpatch/actions/workflows/ci.yml"><img src="https://github.com/huanglvjing/spotpatch/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/huanglvjing/spotpatch" alt="MIT license" /></a>
</p>

SpotPatch is a local-first, development-only feedback workspace for React applications. Select rendered UI, trace it to the responsible JSX/TSX source, attach a separate instruction to each target, and either copy a structured prompt or run an optional review-gated AI coding workflow.

> [!IMPORTANT]
> `@spotpatch/vite` is the supported public integration. The installable [Next.js adapter](./packages/next/README.md) is a **0.x public preview**, not yet part of the public support matrix.

**Integration guides:** [Vite quick start](#quick-start-vite) · [Next.js public preview](#nextjs-public-preview)

## Why SpotPatch

- **UI-to-source selection** — map a rendered element to an authorized source file, line, and column.
- **Component data flow (Beta)** — inspect proven component APIs, parameter keys, consumed response fields, data destinations, and current-page unassigned requests without opening DevTools.
- **Multi-target feedback** — keep independent instructions and context for up to eight targets by default.
- **Useful without AI** — inspect context, open Cursor or VS Code, preview a structured prompt, and copy it to any coding assistant.
- **Optional AI Agent** — use an explicitly configured OpenAI-compatible provider, bounded tools, an isolated Git worktree, project checks, Diff review, Apply, and conflict-safe Revert.
- **Chinese and English UI** — switch locale without losing the current draft or review state.
- **Development-only by construction** — production builds contain no SpotPatch Runtime, source markers, or local protocol endpoints.

## Quick start: Vite

### 1. One-command setup (recommended)

```bash
npx --yes @spotpatch/vite@latest setup
```

This npm-bootstrap command works for both npm and pnpm projects. It fetches the registry's actual `latest` CLI, detects the project's package manager, installs that CLI's exact SpotPatch version, updates a supported `vite.config.*`, and enables Trusted fast when a safe local TypeScript check is available. Installing the exact version is important with pnpm 11, whose default 24-hour `minimumReleaseAge` policy can otherwise make `pnpm add ...@latest` select an older day-old release.

The initializer supports static config objects and object-returning `defineConfig` callbacks. Ambiguous dynamic configurations fail without writing the Vite config.

For npm, installation and initialization can also be kept separate:

```bash
npm install --save-dev @spotpatch/vite@latest
npx spotpatch-vite init
```

On pnpm 11, either use the recommended setup command, specify an exact trusted version, or wait until the release is 24 hours old. Disabling `minimumReleaseAge` is a project security decision and SpotPatch does not do it globally.

The generated integration places SpotPatch before the React plugin:

```ts
// vite.config.ts
import { spotPatch } from "@spotpatch/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [spotPatch({ dataFlow: {}, trustedFastMode: true }), react()],
});
```

If the project has no discoverable TypeScript check, initialization safely uses `spotPatch({ dataFlow: {} })` and keeps Review mode. For an unsupported dynamic config, make the same edit manually.

### 2. Use

Start the ordinary Vite development server, open the application, then select **Select element** in the bottom-right corner or press `Mod+Shift+S`.

```bash
pnpm dev
```

The default workflow is:

1. Select one or more UI elements.
2. Write a separate change request for each target.
3. Inspect the source, DOM, CSS, and bounded code context.
4. Open the exact location in Cursor or VS Code, or copy the generated prompt.
5. If AI is enabled, choose **Review** or **Trusted fast** on the page, approve the matching session notice, and run the task.

### Component data flow (Beta)

The current `setup/init` writes this development-only option automatically. Enable it explicitly when integrating manually:

```ts
spotPatch({ dataFlow: {} });
```

After selecting an element, use **Data flow** for the proven component report and **Page APIs** for the selected page scope plus actually observed but unassigned requests. Reports include HTTP method/path, parameter keys and positions, source-consumed response fields, and proven React state/Zustand/storage/callback destinations. Runtime observation is dispatch-only: SpotPatch does not read or clone response bodies, and query values are never retained.

The current adapter set covers supported direct/component-service `fetch`, Axios, React Query/TanStack Query callback forms, and an experimental tRPC logical-procedure path. A tRPC procedure and its physical batch HTTP request remain separate evidence layers; SpotPatch does not assign a shared batch URL to one component by timing or URL similarity.

This Beta reports a component relationship only when stable component, source, callsite, and invocation evidence agree. Unsupported or ambiguous traffic remains partial, unknown, or unassigned; matching URL/time alone is never treated as proof. It currently targets Vite + React 18 and does not enable data-flow AI, safe JSON response inspection, or Next.js support. See the [implementation status and exact support matrix](./docs/技术方案/组件数据链路/13-Beta实现状态与使用手册.md).

## Optional AI setup

AI is disabled unless a complete provider configuration is available. The smallest setup uses a Git-ignored `.env.local` file and requires no change to `spotPatch()`:

```dotenv
SPOTPATCH_AI_BASE_URL=https://relay.example.com/v1
SPOTPATCH_AI_MODEL=provider-model-name
SPOTPATCH_AI_API_KEY=<your-key>

# Optional defaults:
# SPOTPATCH_AI_PROTOCOL=chat-completions
# SPOTPATCH_AI_AUTHENTICATION=bearer
```

`SPOTPATCH_AI_PROTOCOL` supports `chat-completions` and `responses`. Authentication supports `bearer` and `x-api-key`. API keys stay in the Vite Node process and must never use a `VITE_` prefix or be committed to Git.

You can also declare non-secret provider information in `vite.config.ts`:

```ts
spotPatch({
  ai: {
    baseURL: "https://relay.example.com/v1",
    model: "provider-model-name",
  },
});
```

If you configure SpotPatch manually and intentionally want the optional **Trusted fast** mode, enable it explicitly. It requires a local TypeScript project check; use the default Review mode when the project cannot provide one:

```ts
spotPatch({ trustedFastMode: true });
```

The page still defaults to Review. Selecting Trusted fast includes current local changes and directly applies validated file deletions and configuration changes. It remains project-scoped and never grants access to credentials, environment files, Git metadata, external paths, arbitrary shell commands, failed checks, or baseline conflicts. SpotPatch always creates changes in an isolated Git worktree first. Advanced projects can still provide explicit checks through `ai.execution`. See [AI Agent execution](./docs/技术方案/16-AIAgent执行与变更审阅.md) and [provider credentials](./docs/技术方案/17-模型提供商与凭据配置.md) for the normative rules.

## Supported scope

| Area              | Supported public scope                | Notes                                                        |
| ----------------- | ------------------------------------- | ------------------------------------------------------------ |
| Framework         | React with Vite                       | `@spotpatch/vite` is the public entry point.                 |
| Vite              | 5, 6, 7                               | Verified through versioned compatibility fixtures.           |
| React             | 18.2–18.3                             | React 19 is not in the Vite v1 support promise.              |
| Source            | `.jsx`, `.tsx` under `src` by default | Include and exclude filters are configurable.                |
| Node.js           | 20.19 or newer                        | Node 20 and 22 are exercised in CI.                          |
| Browsers          | Chromium                              | Automated interaction coverage runs through Playwright.      |
| Editors           | Cursor, VS Code                       | Auto-detected by default; either can be selected explicitly. |
| Operating systems | macOS, Windows, Linux                 | CI and editor launch behavior are platform-aware.            |

Other combinations may work, but they are not part of the current public promise. The [product boundary](./docs/技术方案/01-产品定义与边界.md) is the source of truth.

> [!WARNING]
> React 19 (including 19.2.x) may be tried experimentally, but it is outside the supported range. Verify picking, source resolution, HMR, and any AI workflow in your own project before relying on it.

## Next.js public preview

> [!WARNING]
> `@spotpatch/next@0.1.0` is the first public preview. It is installable from npm, but its peer range is a candidate test range—not a completed compatibility or production-support claim.

The preview contains a CLI, Sidecar, Turbopack/webpack Loader paths, source registration, Runtime bootstrap, and production no-op isolation. It has passed the locked POC and one private Next 16 App Router host, but the complete Next/React/router/Node/OS/browser support matrix is still unfinished.

Install the single framework entry, initialize the host, verify the generated integration, and start development:

```bash
pnpm add -D @spotpatch/next
pnpm exec spotpatch-next init
pnpm exec spotpatch-next check
pnpm dev
```

`init` safely composes `next.config`, adds the `@spotpatch/next/client` import to the correct `instrumentation-client` file, and changes a simple `next dev` script to `spotpatch-next dev`. `check` verifies those integration points without writing files. Always start development through the package script; a direct `next dev` has no SpotPatch Sidecar lifecycle owner.

A successful startup prints a line beginning with `[spotpatch:next] ready`. Open the printed loopback URL and use **Select element** / **选择元素**. The optional AI workflow uses the same server-only `SPOTPATCH_AI_*` variables described above; never rename them with a `NEXT_PUBLIC_` prefix.

See the complete [`@spotpatch/next` public-preview guide](./packages/next/README.md) for generated file examples, production commands, known restrictions, and the exact evidence boundary. Follow the [Next.js adapter plan](./docs/技术方案/Next适配/00-索引与架构摘要.md) and [remaining support gates](./docs/技术方案/Next适配/08-测试验收与实施计划.md) before making compatibility claims.

## Configuration

The public Vite entry exports `spotPatch(options)`. Important defaults are:

| Option       | Default                                        | Purpose                                           |
| ------------ | ---------------------------------------------- | ------------------------------------------------- |
| `enabled`    | `true`                                         | Disable the plugin explicitly when needed.        |
| `include`    | JSX/TSX inside `src`                           | Source files eligible for marker injection.       |
| `exclude`    | dependencies, tests, stories, generated output | Files that must not be transformed.               |
| `editor`     | `"auto"`                                       | Auto-detect Cursor or VS Code.                    |
| `redact`     | `true`                                         | Sanitize collected browser context.               |
| `shortcut`   | `"Mod+Shift+S"`                                | Toggle the element picker.                        |
| `allowLan`   | `false`                                        | Keep the local protocol loopback-only by default. |
| `locale`     | `"auto"`                                       | Resolve `en-US` or `zh-CN`.                       |
| `maxTargets` | `8`                                            | Maximum targets in one task by default.           |
| `ai`         | `false` or detected complete environment       | Optional provider and Agent configuration.        |
| `dataFlow`   | `false`                                        | Opt-in dispatch-only component data-flow Beta.    |

See [`@spotpatch/vite`](./packages/vite/README.md) and the [public API specification](./docs/技术方案/03-公共API与数据模型.md) for complete types and constraints.

## Security and production isolation

- The browser receives random file identifiers, never absolute source paths.
- Source reads are limited to files registered by the active development session and kept inside the project root.
- Passwords, tokens, cookies, authorization data, URL credentials, and inline data are sanitized.
- Provider credentials stay on the Node side and are never injected into client code.
- Loopback Host and Origin checks are the default. Enabling Vite LAN access explicitly expands the trust boundary.
- Production builds are tested for zero Runtime, source markers, private API routes, and internal secrets.
- SpotPatch never performs an implicit `stash`, `reset`, `commit`, `push`, publish, or deployment.

Read the complete [local protocol and security specification](./docs/技术方案/09-本地协议与安全.md) before enabling LAN access or AI execution.

## Packages

Applications should normally install only a framework adapter.

| Package                                                            | Role                                                          | Direct application use                  |
| ------------------------------------------------------------------ | ------------------------------------------------------------- | --------------------------------------- |
| [`@spotpatch/vite`](https://www.npmjs.com/package/@spotpatch/vite) | Supported Vite integration                                    | **Yes**                                 |
| [`@spotpatch/next`](./packages/next/README.md)                     | Installable Next.js 0.x public preview                        | Preview only; not formally supported    |
| `@spotpatch/compiler`                                              | Framework-neutral JSX/TSX marker compiler                     | Adapter infrastructure                  |
| `@spotpatch/analyzer`                                              | Node-only component/request semantic analyzer                 | Adapter infrastructure; Node only       |
| `@spotpatch/dev-server`                                            | Local sessions, source access, editor and Agent orchestration | Adapter infrastructure; Node only       |
| `@spotpatch/runtime`                                               | Browser picker, collectors, workbench and prompt composer     | Installed through an adapter            |
| `@spotpatch/react-adapter`                                         | Isolated React/Fiber compatibility boundary                   | Installed through an adapter            |
| `@spotpatch/agent`                                                 | Provider, bounded tools, worktree and validation engine       | Installed through an adapter; Node only |
| `@spotpatch/shared`                                                | Immutable models, protocol schemas and error codes            | Shared internal contract                |

Packages that are publicly published to complete the dependency graph are not automatically separate user-facing integration surfaces.

## Repository development

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build
pnpm test:compatibility
pnpm test:performance
pnpm test:e2e:chromium
pnpm test:production-leakage
pnpm package:validate
```

The CI workflow also runs its quality matrix on Ubuntu, macOS, and Windows with the declared Node versions. Next.js experiments have separate POC and private real-host commands; passing them does not bypass the documented Next formal-support gates.

## Documentation

- [Documentation index](./docs/技术方案/00-索引与导航.md)
- [Product definition and support boundary](./docs/技术方案/01-产品定义与边界.md)
- [Architecture and package ownership](./docs/技术方案/02-总体架构与技术栈.md)
- [Public API and defaults](./docs/技术方案/03-公共API与数据模型.md)
- [Security model](./docs/技术方案/09-本地协议与安全.md)
- [Testing and acceptance](./docs/技术方案/12-测试与验收.md)
- [Component data-flow Beta status](./docs/技术方案/组件数据链路/13-Beta实现状态与使用手册.md)
- [Next.js adapter status](./docs/技术方案/Next适配/00-索引与架构摘要.md)

## License

[MIT](./LICENSE) © SpotPatch contributors.
