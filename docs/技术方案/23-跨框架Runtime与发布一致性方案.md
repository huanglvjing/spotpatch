---
doc-id: "23-framework-runtime-release-parity"
title: "跨框架 Runtime 与发布一致性方案"
status: "active"
version: "1.0.1"
last-updated: "2026-09-09"
implementation-status: "implemented-pending-release"
source-range: "Vite、Astro、Next 共享浏览器 Runtime 的源码所有权、构建快照、Changeset 扇出、packed npm 消费验证与发布门禁"
参考文献/依赖:
  - "02-architecture-stack"
  - "05-runtime-lifecycle"
  - "10-ui-diagnostics"
  - "11-coding-standards"
  - "12-testing-acceptance"
  - "20-local-development-acceptance"
  - "astro-02-feature-parity"
  - "next-08-testing-delivery"
---

# 跨框架 Runtime 与发布一致性方案

## 1. 目的与结论

SpotPatch 的通用工作台、Contextual Ask、数据链路、外部 Agent 控件和动效只能由 `@spotpatch/runtime` 持有一份实现。Vite、Astro 与 Next 可以保留各自的编译、注入、开发服务和生命周期适配，但不得复制或分叉通用 UI。React 不是第四个独立 UI 发布面：普通 React 项目由 `@spotpatch/vite` 接入，Next/Astro React 岛屿仍消费同一 Runtime。

2026-09-09 审计确认，源码所有权没有分叉；用户看到的差异来自发布快照漂移：npm `@spotpatch/astro@0.1.6`、`@spotpatch/vite@1.15.2` 和 `@spotpatch/next@0.11.2` 对应发布提交 `586bc03`，而 `main` 随后才合入 `72fc0d7` 与 `9d6683e` 的 Agent 控件/模型选择器修复。修复没有 Changeset，因而没有产生新 npm 版本。重新执行 `@latest` 只能继续安装旧发布物。

本方案修复发布治理和可执行门禁，不把尚未发布的代码描述成已上线版本。只有 Changesets 发布 PR 合并且 npm dist-tag 更新后，状态才能从 `implemented-pending-release` 改为 `released`。

## 2. 实仓架构事实

| 层级 | 当前实现 | 必须保持的约束 |
| --- | --- | --- |
| 通用 UI | `packages/runtime/src/ui/` | Agent、模型、Ask、数据链路、Shell 只在这里实现 |
| Vite | 独立 runtime browser entry，并用 `noExternal` 内联 Runtime | 发布 Vite 包时必须重新构建共享 UI 快照 |
| Astro | `client` 构建组用 `noExternal: [/^@spotpatch\//]` 内联 Runtime | 发布 Astro 包时必须重新构建共享 UI 快照 |
| Next | client 动态导入 `@spotpatch/runtime/external-handoff-panel` | 发布依赖图必须指向本轮 Runtime，宿主不得复制面板 |
| 服务与连接 | `@spotpatch/dev-server` + `@spotpatch/bridge` | 三个适配器使用同一状态协议和降级语义 |

框架间允许存在有证据的差异，例如 Astro 原生标签与 React 业务组件的目标名称、Astro 导航生命周期、Next RSC 边界和各自验证命令。它们不能被错误归类为 UI 漂移。相同语言、viewport、选择上下文和连接状态下，通用控件、文案、可用状态及交互必须一致。

## 3. 本次故障链

1. `@spotpatch/astro@0.1.6` 发布时，外部 Agent 面板仍使用原生 `select`。
2. 后续 Runtime 修复把 Agent 固定值与模型控件改为共享的可访问自定义 picker，并调整发送/模型等待门禁。
3. Astro 与 Vite 都内联 Runtime；已发布 tarball 不会因仓库 Runtime 源码更新而变化。
4. 修复提交没有 Changeset，`changeset status` 没有待 bump 包，发布工作流因此无法生成新版本。
5. 现有 packed npm consumer 只覆盖 Vite/Next，没有打包、安装或检查 Astro；Astro E2E 验证的是当前 workspace 构建，不是待发布 tarball。
6. 既有文档已把“packed package 与 playground UI 一致”列为 P5，但该项尚未实现为阻断发布的自动化。

## 4. 固定发布规则

### 4.1 Changeset 必须存在

普通 PR 只要改变 workspace package，CI 必须对 PR base 执行 `changeset status --since=<base-sha>`。缺少 Changeset 时失败；Changesets 自动生成的版本 PR 不重复要求已经被消费的 Changeset。

### 4.2 共享交付包必须扇出到全部框架适配器

当待发布 Changeset 包含 `@spotpatch/runtime`、`@spotpatch/shared`、`@spotpatch/dev-server` 或 `@spotpatch/bridge` 时，同一发布计划必须包含：

- `@spotpatch/vite`；
- `@spotpatch/astro`；
- `@spotpatch/next`。

这是发布可发现性和适配器版本升级规则，不表示三个框架具有相同的源码编译能力或相同稳定等级。已有项目的锁文件仍须通过包管理器或各适配器的最新版 setup/init 命令显式刷新，不能仅凭 npm dist-tag 变化假定本地依赖已经更新。

### 4.3 发布物而非源码必须通过一致性检查

Node 22.12+ 的 packed npm consumer 必须把 Astro 与所有公共依赖一起打包、安装并验证：

- Astro 的 CommonJS/ESM export 与 `spotpatch-astro` bin 可用；
- Runtime、Vite bundle、Astro bundle 同时包含当前共享 Agent 控件、双语文案和 picker 标识；
- 三个产物不得保留已淘汰的 `.spotpatch-external-control select`；
- Next client 必须继续加载公共 `@spotpatch/runtime/external-handoff-panel`，不得内置第二套面板；
- packed Astro 包能在一次性真实 Astro 宿主中启动开发模式并注入源码 marker，生产构建不得残留 SpotPatch。

依赖唯一性检查只查询本仓库负责的 `@spotpatch/*` 包。不得使用无过滤的 `npm ls --all` 充当该断言：Astro 的 Sharp 等宿主依赖包含平台可选包，npm 在部分 Next/Vite 组合下会把有效安装中的 WASM fallback 报为第三方 `extraneous/invalid`，导致尚未检查 SpotPatch 就误失败。第三方宿主依赖是否真正可用，继续由后续 Vite/Astro/Next 开发启动与生产构建证明。

Node 20 低于 Astro 包声明的 `>=22.12.0`，其 packed consumer 继续只验证 Vite/Next，不能把跳过 Astro 写成 Astro 通过证据。

### 4.4 构建产物门禁

`package:validate` 在构建之后检查 Runtime、Vite、Astro 和 Next 的正式产物。该门禁用于发现入口分叉、旧 UI 回流和 bundle 漏构建；Runtime DOM 单测与 Astro 5/6/7 浏览器测试继续验证交互行为。

## 5. 本轮发布计划

2026-09-09 文档复核：版本 PR #23 已合入 `71700d6`，源码清单已采用下表版本；同次官方 registry 查询仍返回旧的 `latest`，因此保留 `implemented-pending-release`。这只更新发布进度事实，不替代 release run 或 dist-tag 完成证据。

本轮 Changeset 显式 patch bump：

| 包 | 预期版本 | 原因 |
| --- | --- | --- |
| `@spotpatch/runtime` | `1.15.3` | 发布共享 Agent 控件与稳定 picker 修复 |
| `@spotpatch/bridge` | `0.4.3` | 发布有界、批量的 descriptor discovery 修复 |
| `@spotpatch/astro` | `0.1.7` | 重建并发布新的 Runtime UI 快照与连接依赖 |
| `@spotpatch/vite` | `1.15.3` | 重建并发布相同 Runtime UI 快照 |
| `@spotpatch/next` | `0.11.3` | 为 `@latest` 提供同轮 Runtime/Bridge 发布入口；已有项目仍须刷新锁文件 |

版本号由 Changesets 版本 PR 最终计算；表内版本基于当前 npm/latest 与 patch 规则，不在功能 PR 中手改 package version。

## 6. 验收与发布顺序

功能 PR 合并前至少执行：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm package:validate
pnpm test:astro
pnpm test:astro:compatibility
pnpm test:compatibility
pnpm test:production-leakage
pnpm test:e2e:chromium
pnpm test:package-beta
```

本功能分支在 2026-09-09 的实测结果：

| 门禁 | 结果 |
| --- | --- |
| Prettier / ESLint / TypeScript | 通过；TypeScript 覆盖根工程及 21 个带 typecheck 的工作区 |
| Unit | 141 个测试文件通过，982 个测试通过；2 个文件/6 个显式条件测试跳过 |
| Package validate | 11 个公共包的 build、publint、Are the Types Wrong 与 4 条产物一致性检查通过 |
| Packed npm consumer | Node 26.0.0 + Vite 7.3.6/Next 16.3.0，以及 Node 22.23.2 + Vite 6.4.3 或 7.3.6/Next 15.3.9；Astro 7.2.8 均通过 |
| Astro browser | Astro 5/6/7 共 15 条 Chromium 测试通过 |
| Astro production compatibility | Astro 5.18.2、6.4.8、7.2.8 构建及零 Runtime 残留验证通过 |
| Vite production compatibility | Vite 5.4.21、6.4.3 构建及验证通过 |
| Production suite | bundle budget、框架 UI 产物与生产泄漏共 22 条测试通过 |
| Chromium E2E | React/Vite 主 playground 26 条测试通过 |

以上是本地功能分支证据，不等于 GitHub Actions 多系统矩阵或 npm `@latest` 已发布；后两项仍必须按下述发布流程完成。

合并本功能 PR 后，Changesets Action 创建版本 PR；维护者核对五个包的版本、Changelog 和内部依赖，再合并版本 PR。npm 发布完成后必须用官方 registry 核对五个 dist-tag，并在一次性 Astro/Vite/Next 宿主中重新安装 `@latest`。在 npm 核验完成前，不得对用户声称该 UI 已发布。

## 7. 验收边界

本方案提供源码单一所有权、关键 DOM/文案契约、真实构建产物、packed consumer 和 Astro 5/6/7 浏览器交互证据。它不声称不同操作系统的原生字体栅格或浏览器缩放后像素逐点相同，也不改变 Next 公共预览和外部 Agent 实验性能力的成熟度声明。像素级视觉回归仍可在固定字体、DPR 与 Chromium 镜像后增补，但不能替代本方案的结构、状态与发布物门禁。
