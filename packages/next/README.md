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

The preview connects SpotPatch's element picker, source-aware context, bilingual multi-target requests, and optional review-gated AI Agent to a Next.js development server.

### Implemented preview path

- `withSpotPatch()` composes an existing `next.config` without evaluating it twice.
- `spotpatch-next dev` owns the loopback-only Next child process and Sidecar lifecycle.
- Development-only Turbopack and webpack Loader paths register source and inject JSX/TSX markers.
- `@spotpatch/next/client` installs the React hook from `instrumentation-client`, then bootstraps one Runtime.
- Private API rewrites use a randomized loopback Sidecar origin and per-launch secrets.
- Production configuration aliases the client to a side-effect-free no-op and does not add the Loader, Sidecar, source registry, or private rewrite.
- `spotpatch-next init` previews and applies supported integration edits with rollback on failure.
- `spotpatch-next check` diagnoses the package graph and generated integration without starting development.

### Public preview integration

Install the single framework entry package. Its required SpotPatch internal packages are resolved automatically; do not install them individually.

```bash
pnpm add --save-dev @spotpatch/next
pnpm exec spotpatch-next init
pnpm exec spotpatch-next check
pnpm dev
```

The supported initializer result has three parts. The TypeScript example below enables the in-page Review / Trusted fast selector by discovering the local TypeScript check; a JavaScript-only project remains on `withSpotPatch()` and review mode.

```ts
// next.config.ts
import type { NextConfig } from "next";
import { withSpotPatch } from "@spotpatch/next";

const nextConfig: NextConfig = {};

export default withSpotPatch({ trustedFastMode: true })(nextConfig);
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

### Current evidence and remaining gates

The public preview has passed:

- package build, type publication, Publint, and Are The Types Wrong checks;
- formal unit and HTTP boundary tests;
- a locked Loader POC covering selected Next 15/React 18 and Next 16/React 19 combinations;
- one private Next 16 App Router host with Turbopack and webpack development startup;
- authenticated Runtime bootstrap, source registration, source-context lookup, and Runtime singleton checks in that host;
- Turbopack and webpack Fast Refresh in the private Runtime POC;
- webpack production isolation in the private host;
- a separate historical Turbopack production Loader POC for the locked host.

Formal public support remains blocked on the complete required Next/React/router/Node/OS matrix, Pages and hybrid router coverage, broader RSC navigation cases, fresh browser interaction evidence, complex rewrite/base path fixtures, and a full Turbopack production zero-residual fixture.

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

当前预览把 SpotPatch 的元素选择、源码上下文、中英文多目标修改要求和可选审阅式 AI Agent 接入 Next.js 开发服务器。

### 已实现的预览链路

- `withSpotPatch()` 组合现有 `next.config`，不会重复执行宿主配置。
- `spotpatch-next dev` 管理只监听 loopback 的 Next 子进程与 Sidecar 生命周期。
- 仅开发期启用的 Turbopack/webpack Loader 注册源码并注入 JSX/TSX 标记。
- `@spotpatch/next/client` 从 `instrumentation-client` 安装 React hook，再启动唯一 Runtime。
- 私有 API rewrite 使用随机 loopback Sidecar origin 和每次启动生成的秘密。
- 生产配置把客户端入口替换为无副作用 no-op，不添加 Loader、Sidecar、源码注册或私有 rewrite。
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

受支持的初始化结果包含三部分。下面的 TypeScript 示例会通过自动发现本地 TypeScript 校验来开放页面内“审阅 / 可信快速”选择；纯 JavaScript 项目保持 `withSpotPatch()` 和审阅模式。

```ts
// next.config.ts
import type { NextConfig } from "next";
import { withSpotPatch } from "@spotpatch/next";

const nextConfig: NextConfig = {};

export default withSpotPatch({ trustedFastMode: true })(nextConfig);
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

### 当前证据与剩余门禁

公共预览已经通过：

- 包构建、类型发布、Publint 与 Are The Types Wrong；
- 正式单元测试与 HTTP 边界测试；
- 锁定范围的 Loader POC，覆盖选定的 Next 15/React 18 和 Next 16/React 19 组合；
- 一个私有 Next 16 App Router 宿主的 Turbopack 与 webpack 开发启动；
- 该宿主中的认证 Runtime bootstrap、源码注册、源码上下文读取和 Runtime 单例检查；
- 私有 Runtime POC 的 Turbopack 与 webpack Fast Refresh；
- 私有宿主的 webpack 生产隔离；
- 锁定宿主独立的历史 Turbopack 生产 Loader POC。

正式公共支持仍被以下项目阻断：完整 Next/React/router/Node/OS required matrix、Pages 与 hybrid Router、更广泛的 RSC 导航、全新浏览器交互证据、复杂 rewrite/basePath fixture，以及完整的 Turbopack 生产零残留 fixture。

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
