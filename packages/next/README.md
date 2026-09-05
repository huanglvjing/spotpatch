<h1><a href="https://github.com/huanglvjing/spotpatch"><img src="https://raw.githubusercontent.com/huanglvjing/spotpatch/main/docs/assets/spotpatch-npm-icon.png" alt="SpotPatch" width="48" height="48" align="absmiddle" /></a> <code>@spotpatch/next</code></h1>

<p align="center">
  <a href="#english">English</a> · <a href="#简体中文">简体中文</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@spotpatch/next"><img src="https://img.shields.io/npm/v/%40spotpatch%2Fnext?logo=npm&label=npm" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/status-public_preview-F59E0B" alt="Public preview" />
  <a href="https://github.com/huanglvjing/spotpatch/actions/workflows/ci.yml"><img src="https://github.com/huanglvjing/spotpatch/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status" /></a>
  <a href="https://github.com/huanglvjing/spotpatch/blob/main/LICENSE"><img src="https://img.shields.io/github/license/huanglvjing/spotpatch" alt="MIT license" /></a>
</p>

## English

> [!WARNING]
> This package is a **0.x public preview**, not a formally supported Next.js integration. Its peer dependency range must not be interpreted as a completed compatibility or production-support claim.

The preview connects SpotPatch's element picker, source-aware context, evidence-first component data flow, bilingual multi-target requests, and optional review-gated AI Agent to a Next.js development server.

Component `dataFlow` uses the same compiler, analyzer, recorder, merger, protocol, and panel as Vite; Next owns only the bundler and Sidecar integration. Browser Client Components support the `fetch`, Axios, React Query/TanStack Query, and experimental tRPC evidence described by the shared Beta guide. RSC, Server Actions, and Route Handlers can contribute statically proven `declared-not-observed` evidence, but their server-side dispatch is not observable in the browser.

### Implemented preview path

- `withSpotPatch()` composes an existing `next.config` without evaluating it twice.
- `spotpatch-next dev` owns the loopback-only Next child process and Sidecar lifecycle.
- Development-only Turbopack and webpack Loader paths atomically register source/data-flow anchors, inject JSX/TSX markers, and instrument eligible browser `.js/.jsx/.ts/.tsx` modules.
- `@spotpatch/next/client` installs the React hook and dispatch-only data-flow prelude from `instrumentation-client`, then bootstraps one Runtime and the shared data-flow panel.
- Private API rewrites use a randomized loopback Sidecar origin and per-launch secrets.
- Production configuration aliases both browser entries to a side-effect-free no-op and does not add the Loader, recorder, panel, Sidecar, source registry, or private rewrite.
- `spotpatch-next init` previews and applies supported integration edits with rollback on failure.
- `spotpatch-next init` also initializes a private, revocable project grant for isolated snapshot writes and audited/validated application. Use `spotpatch-next bridge init` on an already-integrated project to leave integration files unchanged. No later dev-terminal `yes` prompt is needed; Codex login and compatibility checks still apply.
- `spotpatch-next check` diagnoses the package graph and generated integration without starting development.

### Public preview integration

Install the single framework entry package. Its required SpotPatch internal packages are resolved automatically; do not install them individually.

```bash
pnpm add --save-dev @spotpatch/next
pnpm exec spotpatch-next init
pnpm exec spotpatch-next check
pnpm dev
```

The supported initializer result has three parts. The TypeScript example below enables the in-page Review / Trusted direct selector and preserves the discovered TypeScript check for Review; a JavaScript-only project remains on `withSpotPatch()` and review mode. Trusted direct itself does not expose `run_check` or run project checks.

```ts
// next.config.ts
import type { NextConfig } from "next";
import { withSpotPatch } from "@spotpatch/next";

const nextConfig: NextConfig = {};

export default withSpotPatch({
  dataFlow: {},
  trustedFastMode: true,
})(nextConfig);
```

```ts
// instrumentation-client.ts
// Use src/instrumentation-client.ts when the router lives under src.
import "@spotpatch/next/client";
```

```json
{
  "scripts": {
    "dev": "spotpatch-next dev"
  }
}
```

Start development through the package script, not a direct `next dev` command. A successful startup prints one line beginning with `[spotpatch:next] ready`; the page then mounts one `spotpatch-root` Shadow DOM host with the **Select element** / **选择元素** action.

### External Agent handoff (local validation)

Enable the development-only handoff UI explicitly in the same wrapper options:

```ts
export default withSpotPatch({ externalAgent: true })(nextConfig);
```

Run setup and active commands from the exact canonical project root that owns the running `spotpatch-next dev` session. Setup is a dry run without `--write`:

```bash
pnpm exec spotpatch-next bridge setup --client claude --scope project --mode active --write
MCP_PROTOCOL_NEGOTIATION=legacy claude --dangerously-load-development-channels server:spotpatch

pnpm exec spotpatch-next connect codex --allow-workspace-write

pnpm exec spotpatch-next bridge setup --client cursor --scope project --write
```

The active command forms support an explicit session when `bridge sessions --json` reports multiple sessions for that exact root:

```text
spotpatch-next bridge channel claude [--session <opaque-id>]
spotpatch-next connect codex --allow-workspace-write [--session <opaque-id>]
```

The Claude legacy environment belongs on the Claude host process. Claude Channels are a Research Preview, work only while the Channel-enabled session is running, and provide no completion acknowledgement; completion depends on Claude calling the SpotPatch result tool. Codex active mode is zero-setup: the Connector injects the project-local SpotPatch MCP entry into its App Server thread and does not create or modify `.codex/config.toml`. Codex can still load other MCP servers already enabled by the user's normal Codex configuration. Stable Codex versions from `0.149.0` onward must pass per-executable generated-schema validation plus the live protocol and security preflight; SpotPatch does not install or update Codex. `bridge setup --client codex ...` remains available only for optional Inbox use; Cursor and all generic MCP hosts remain Inbox-only.

This path is `local-validation`, not part of the Next public-support promise. Automated fake-host and two-handoff tests exist, and a consecutive two-revision Codex flow has been manually validated on the recorded macOS/Next.js/Codex 0.149.0 environment. Real Claude Code consecutive delivery, repeatable real-host automation, and Windows process-tree cleanup remain `not-tested`; Cursor remains Inbox-only. See the [external Agent design and exact status](https://github.com/huanglvjing/spotpatch/blob/main/docs/%E6%8A%80%E6%9C%AF%E6%96%B9%E6%A1%88/%E5%A4%96%E9%83%A8Agent%E8%BF%9E%E6%8E%A5/00-%E7%B4%A2%E5%BC%95%E4%B8%8E%E5%86%B3%E7%AD%96%E6%91%98%E8%A6%81.md).

### Current evidence and remaining gates

The public preview has passed:

- package build, type publication, Publint, and Are The Types Wrong checks;
- formal unit and HTTP boundary tests;
- a locked Loader POC covering selected Next 15/React 18 and Next 16/React 19 combinations;
- one private Next 16 App Router host with Turbopack and webpack development startup;
- authenticated Runtime bootstrap, source registration, source-context lookup, and Runtime singleton checks in that host;
- shared data-flow compiler/runtime/HTTP unit gates, atomic Next registration, React 19 registration-only identity policy, cross-module renderer discovery, and browser/server Loader partitioning;
- one packed Next 16 App Router/Turbopack browser report showing direct `fetch` plus Axios/TanStack Query transitive static evidence;
- one packed Next 16 App Router webpack development build preserving `"use client"` and excluding `.next`/`node_modules` before the Loader;
- Turbopack and webpack Fast Refresh in the private Runtime POC;
- webpack production isolation in the private host;
- a clean packed Next 16 App Router/Turbopack production build/start with page 200, private bootstrap 404, and no executable SpotPatch data-flow residue in business output.

Formal public support remains blocked on the complete required Next/React/router/Node/OS matrix, Pages and hybrid router coverage, broader RSC navigation cases, a final React 19 identity browser recheck, complex rewrite/base path fixtures, and webpack/Turbopack production scans for Pages, standalone, static export, and multiple operating systems.

Read the [implementation status](https://github.com/huanglvjing/spotpatch/blob/main/docs/%E6%8A%80%E6%9C%AF%E6%96%B9%E6%A1%88/Next%E9%80%82%E9%85%8D/00-%E7%B4%A2%E5%BC%95%E4%B8%8E%E6%9E%B6%E6%9E%84%E6%91%98%E8%A6%81.md) and [required release matrix](https://github.com/huanglvjing/spotpatch/blob/main/docs/%E6%8A%80%E6%9C%AF%E6%96%B9%E6%A1%88/Next%E9%80%82%E9%85%8D/08-%E6%B5%8B%E8%AF%95%E9%AA%8C%E6%94%B6%E4%B8%8E%E5%AE%9E%E6%96%BD%E8%AE%A1%E5%88%92.md) before drawing compatibility conclusions.

### Declared peer range

| Dependency        | Package range          | What it means                                                                            |
| ----------------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| Node.js           | `>=20.19.0`            | Package engine requirement.                                                              |
| Next.js           | `>=15.3.0 <17.0.0`     | Candidate range for the preview matrix, not a support guarantee.                         |
| React / React DOM | `^18.2.0` or `^19.0.0` | Installable candidate range; React 19 Fiber semantics still degrade in controlled cases. |

The first preview accepts only loopback development hosts and rejects `allowLan: true`. Complex CommonJS `next.config` files, mixed root/`src` routers, conflicting Loader rules, and conflicting private-prefix rewrites fail closed or require manual integration.

### Production behavior

Use ordinary Next.js production commands:

```bash
pnpm exec next build
pnpm exec next start
```

`spotpatch-next` intentionally proxies only `dev`. Production use is not supported by the 0.x preview; validation must continue proving that production output contains no `data-spotpatch-source`, `spotpatch-root`, Runtime bootstrap state, private API prefix, or internal configuration and registration secrets.

### Hydration warning from browser extensions

If React reports only a removed body attribute such as `cz-shortcut-listen="true"`, a browser extension changed the document before hydration. That warning is independent of SpotPatch initialization; test in a clean browser profile before treating it as an adapter defect.

---

## 简体中文

> [!WARNING]
> 本包是 **0.x 公共预览版**，不是正式支持的 Next.js 接入。peer dependency 范围不能解释成兼容矩阵或生产支持已经完成。

当前预览把 SpotPatch 的元素选择、源码上下文、证据优先的组件数据链路、中英文多目标修改要求和可选审阅式 AI Agent 接入 Next.js 开发服务器。

组件 `dataFlow` 复用 Vite 的同一 compiler、analyzer、recorder、merger、协议和面板；Next 只承载构建器与 Sidecar。浏览器 Client Component 支持共享 Beta 指南列出的 `fetch`、Axios、React Query/TanStack Query 和实验性 tRPC 证据；RSC、Server Action、Route Handler 只能提供静态可证明的 `declared-not-observed` 关系，浏览器不能观测其服务端 dispatch。

### 已实现的预览链路

- `withSpotPatch()` 组合现有 `next.config`，不会重复执行宿主配置。
- `spotpatch-next dev` 管理只监听 loopback 的 Next 子进程与 Sidecar 生命周期。
- 仅开发期启用的 Turbopack/webpack Loader 原子注册源码/data-flow anchors、注入 JSX/TSX 标记，并转换符合条件的浏览器 `.js/.jsx/.ts/.tsx` 模块。
- `@spotpatch/next/client` 从 `instrumentation-client` 安装 React hook 与 dispatch-only data-flow prelude，再启动唯一 Runtime和共享数据链路面板。
- 私有 API rewrite 使用随机 loopback Sidecar origin 和每次启动生成的秘密。
- 生产配置把两个浏览器入口替换为无副作用 no-op，不添加 Loader、recorder、面板、Sidecar、源码注册或私有 rewrite。
- `spotpatch-next init` 预览并应用受支持的接入修改，失败时执行回滚。
- `spotpatch-next check` 在不启动开发服务器的情况下诊断包依赖和接入文件。

### 公共预览接入

只需安装一个框架入口包，所需 SpotPatch 内部包会自动解析，不要逐个手工安装。

```bash
pnpm add --save-dev @spotpatch/next
pnpm exec spotpatch-next init
pnpm exec spotpatch-next check
pnpm dev
```

受支持的初始化结果包含三部分。下面的 TypeScript 示例会开放页面内“审阅 / 可信极速”选择，并保留自动发现的 TypeScript 校验供审阅模式使用；纯 JavaScript 项目保持 `withSpotPatch()` 和审阅模式。可信极速模式本身不向模型暴露 `run_check`，也不执行项目检查。

```ts
// next.config.ts
import type { NextConfig } from "next";
import { withSpotPatch } from "@spotpatch/next";

const nextConfig: NextConfig = {};

export default withSpotPatch({
  dataFlow: {},
  trustedFastMode: true,
})(nextConfig);
```

```ts
// instrumentation-client.ts
// Router 位于 src 下时使用 src/instrumentation-client.ts。
import "@spotpatch/next/client";
```

```json
{
  "scripts": {
    "dev": "spotpatch-next dev"
  }
}
```

必须通过 package script 启动，而不是直接运行 `next dev`。成功启动时终端只打印一条以 `[spotpatch:next] ready` 开头的信息；页面随后挂载唯一 `spotpatch-root` Shadow DOM，并显示 **Select element** / **选择元素** 操作。

### 外部 Agent 交接（本地验证）

在同一包装器选项中显式启用仅开发期的交接 UI：

```ts
export default withSpotPatch({ externalAgent: true })(nextConfig);
```

必须在当前 `spotpatch-next dev` Session 所属的精确 canonical 项目根执行 setup 和主动命令。setup 不带 `--write` 时只是 dry-run：

```bash
pnpm exec spotpatch-next bridge setup --client claude --scope project --mode active --write
MCP_PROTOCOL_NEGOTIATION=legacy claude --dangerously-load-development-channels server:spotpatch

pnpm exec spotpatch-next connect codex --allow-workspace-write

pnpm exec spotpatch-next bridge setup --client cursor --scope project --write
```

若 `bridge sessions --json` 报告该精确项目根有多个 Session，主动子命令支持显式选择：

```text
spotpatch-next bridge channel claude [--session <opaque-id>]
spotpatch-next connect codex --allow-workspace-write [--session <opaque-id>]
```

Claude legacy 环境变量必须设置在 Claude 宿主进程。Claude Channels 仍是 Research Preview，只在已启用 Channel 的会话运行时工作，且没有 completion ACK；完成状态依赖 Claude 调用 SpotPatch 结果 tool。Codex 主动模式为零配置：Connector 只把当前项目的 SpotPatch MCP 配置注入它拥有的 App Server thread，不创建也不修改 `.codex/config.toml`；Codex 仍可能按用户既有配置启动其他已启用 MCP server。Codex 从稳定版 `0.149.0` 起必须通过当前 executable 的 generated Schema、真实协议和安全 preflight；SpotPatch 不安装或更新 Codex。`bridge setup --client codex ...` 仅保留为可选 Inbox 配置；Cursor 和所有普通 MCP 宿主仍为 Inbox-only。

该链路当前只是 `local-validation`，不属于 Next 正式支持承诺。仓库有假宿主和连续两 Handoff 自动化测试，并已在记录的 macOS/Next.js/Codex 0.149.0 环境人工验证连续两个 revision。真实 Claude Code 连续投递、可重复真实宿主自动化和 Windows 进程树清理仍为 `not-tested`；Cursor 保持 Inbox-only。准确边界见[外部 Agent 方案与实现状态](https://github.com/huanglvjing/spotpatch/blob/main/docs/%E6%8A%80%E6%9C%AF%E6%96%B9%E6%A1%88/%E5%A4%96%E9%83%A8Agent%E8%BF%9E%E6%8E%A5/00-%E7%B4%A2%E5%BC%95%E4%B8%8E%E5%86%B3%E7%AD%96%E6%91%98%E8%A6%81.md)。

### 当前证据与剩余门禁

公共预览已经通过：

- 包构建、类型发布、Publint 与 Are The Types Wrong；
- 正式单元测试与 HTTP 边界测试；
- 锁定范围的 Loader POC，覆盖选定的 Next 15/React 18 和 Next 16/React 19 组合；
- 一个私有 Next 16 App Router 宿主的 Turbopack 与 webpack 开发启动；
- 该宿主中的认证 Runtime bootstrap、源码注册、源码上下文读取和 Runtime 单例检查；
- 共享 data-flow compiler/runtime/HTTP 单测门禁、Next 原子注册、React 19 registration-only 身份策略、跨模块 renderer 发现和 browser/server Loader 分层；
- 一个 packed Next 16 App Router/Turbopack 浏览器报告，展示直接 `fetch` 与 Axios/TanStack Query transitive 静态证据；
- 一个 packed Next 16 App Router webpack development 构建，保持 `"use client"` 并在 Loader 前排除 `.next`/`node_modules`；
- 私有 Runtime POC 的 Turbopack 与 webpack Fast Refresh；
- 私有宿主的 webpack 生产隔离；
- packed Next 16 App Router/Turbopack 干净 production build/start，页面 200、私有 bootstrap 404，且业务产物无可执行 SpotPatch data-flow 残留。

正式公共支持仍被以下项目阻断：完整 Next/React/router/Node/OS required matrix、Pages 与 hybrid Router、更广泛的 RSC 导航、React 19 身份最终浏览器复验、复杂 rewrite/basePath fixture，以及 Pages/standalone/static export/多操作系统的 webpack/Turbopack 生产扫描。

判断兼容性前必须阅读[实现状态](https://github.com/huanglvjing/spotpatch/blob/main/docs/%E6%8A%80%E6%9C%AF%E6%96%B9%E6%A1%88/Next%E9%80%82%E9%85%8D/00-%E7%B4%A2%E5%BC%95%E4%B8%8E%E6%9E%B6%E6%9E%84%E6%91%98%E8%A6%81.md)与[发布 required matrix](https://github.com/huanglvjing/spotpatch/blob/main/docs/%E6%8A%80%E6%9C%AF%E6%96%B9%E6%A1%88/Next%E9%80%82%E9%85%8D/08-%E6%B5%8B%E8%AF%95%E9%AA%8C%E6%94%B6%E4%B8%8E%E5%AE%9E%E6%96%BD%E8%AE%A1%E5%88%92.md)。

### 声明的 peer 范围

| 依赖              | Package 范围           | 准确含义                                            |
| ----------------- | ---------------------- | --------------------------------------------------- |
| Node.js           | `>=20.19.0`            | 包的 engine 要求。                                  |
| Next.js           | `>=15.3.0 <17.0.0`     | 预览兼容矩阵候选范围，不是支持保证。                |
| React / React DOM | `^18.2.0` 或 `^19.0.0` | 可安装候选范围；React 19 Fiber 语义仍可能受控降级。 |

首版预览只接受 loopback 开发主机并拒绝 `allowLan: true`。复杂 CommonJS `next.config`、混合 root/`src` Router、冲突 Loader rule 和占用私有前缀的 rewrite 会安全失败或要求手动接入。

### 生产行为

生产环境使用普通 Next.js 命令：

```bash
pnpm exec next build
pnpm exec next start
```

`spotpatch-next` 只代理 `dev`。0.x 预览版不支持生产使用；验证必须继续证明生产产物中不存在 `data-spotpatch-source`、`spotpatch-root`、Runtime bootstrap 状态、私有 API 前缀和内部配置/注册秘密。

### 浏览器扩展造成的 Hydration 警告

如果 React 只报告类似 `cz-shortcut-listen="true"` 的 body 属性被移除，说明浏览器扩展在 hydration 前修改了文档。该警告与 SpotPatch 初始化无关；把它归因于适配器之前，应先在干净浏览器 Profile 中复现。

### Links / 链接

- [SpotPatch repository / 仓库](https://github.com/huanglvjing/spotpatch)
- [Next.js implementation status / 实现状态](https://github.com/huanglvjing/spotpatch/blob/main/docs/%E6%8A%80%E6%9C%AF%E6%96%B9%E6%A1%88/Next%E9%80%82%E9%85%8D/00-%E7%B4%A2%E5%BC%95%E4%B8%8E%E6%9E%B6%E6%9E%84%E6%91%98%E8%A6%81.md)
- [Issues / 问题反馈](https://github.com/huanglvjing/spotpatch/issues)

### License / 许可证

[MIT](https://github.com/huanglvjing/spotpatch/blob/main/LICENSE) © SpotPatch contributors.
