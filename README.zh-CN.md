<p align="center">
  <a href="https://github.com/huanglvjing/spotpatch">
    <img src="./docs/assets/spotpatch-logo-mark.svg" alt="SpotPatch 标志" width="160" />
  </a>
</p>

<h1 align="center">SpotPatch</h1>

<p align="center">
  <a href="./README.md">English</a> · <strong>简体中文</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@spotpatch/vite"><img src="https://img.shields.io/npm/v/%40spotpatch%2Fvite?logo=npm&label=%40spotpatch%2Fvite" alt="npm 版本" /></a>
  <a href="https://www.npmjs.com/package/@spotpatch/next"><img src="https://img.shields.io/npm/v/%40spotpatch%2Fnext?logo=npm&label=%40spotpatch%2Fnext" alt="Next.js 预览版本" /></a>
  <a href="https://www.npmjs.com/package/@spotpatch/vite"><img src="https://img.shields.io/npm/dm/%40spotpatch%2Fvite?logo=npm&label=downloads" alt="npm 下载量" /></a>
  <a href="https://github.com/huanglvjing/spotpatch/actions/workflows/ci.yml"><img src="https://github.com/huanglvjing/spotpatch/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI 状态" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/huanglvjing/spotpatch" alt="MIT 许可证" /></a>
</p>

SpotPatch 是一个本地优先、仅在开发期运行的 React 页面反馈工作台。你可以在真实页面中选择元素，追溯到对应 JSX/TSX 源码，为每个目标分别编写修改要求，然后复制结构化 Prompt，或运行一个默认需要审阅的可选 AI 编码流程。

> [!IMPORTANT]
> `@spotpatch/vite` 是当前正式支持的公共接入包。可安装的 [Next.js 适配器](./packages/next/README.md#简体中文)是 **0.x 公共预览版**，尚未进入公共支持矩阵。

**接入指南：** [Vite 快速开始](#快速开始vite) · [Next.js 公共预览](#nextjs-公共预览用法)

## 为什么使用 SpotPatch

- **从页面精确定位源码**：把渲染后的元素映射到经过授权的源码文件、行号和列号。
- **多目标独立描述**：一次任务默认最多选择八个目标，每个目标保留独立要求与上下文。
- **不配置 AI 也能完整使用**：查看上下文、打开 Cursor 或 VS Code、预览结构化 Prompt 并复制给任意编程助手。
- **可选 AI Agent**：显式配置 OpenAI-compatible Provider 后，使用受限工具、隔离 Git worktree、项目检查、Diff 审阅、Apply 和冲突安全的 Revert。
- **中英文工作台**：切换语言不会丢失当前草稿或审阅状态。
- **开发期隔离**：生产构建不包含 SpotPatch Runtime、源码标记或本地协议端点。

## 快速开始：Vite

### 1. 一条命令接入（推荐）

```bash
npx --yes @spotpatch/vite@latest setup
```

这条由 npm 引导的命令同时适用于 npm 和 pnpm 项目。它先取得 registry 真正的 `latest` CLI，再识别项目包管理器、安装该 CLI 对应的 SpotPatch 精确版本、安全更新受支持的 `vite.config.*`，并在能发现本地 TypeScript 检查时开放“可信极速”。精确版本很重要：pnpm 11 默认启用 24 小时 `minimumReleaseAge`，直接执行 `pnpm add ...@latest` 可能有意选择已发布满一天的旧版本。

初始化器支持静态配置对象，也支持返回对象的 `defineConfig` 回调；有歧义的动态配置会在不写入 Vite 配置的情况下失败。

npm 项目也可以分开安装和初始化：

```bash
npm install --save-dev @spotpatch/vite@latest
npx spotpatch-vite init
```

pnpm 11 项目请使用上面的推荐 setup 命令、显式安装你已确认的精确版本，或等待新版本发布满 24 小时。关闭 `minimumReleaseAge` 属于项目自身的供应链安全决策，SpotPatch 不会全局关闭它。

初始化器会把 SpotPatch 放在 React 插件之前：

```ts
// vite.config.ts
import { spotPatch } from "@spotpatch/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [spotPatch({ trustedFastMode: true }), react()],
});
```

如果项目无法发现 TypeScript 检查，初始化器会安全使用 `spotPatch()` 并保持审阅模式。配置结构过于动态而不受支持时，再按同样结果手动编辑。

### 2. 使用

照常启动 Vite 开发服务器并打开页面，然后点击右下角的 **选择元素**，或者按下 `Mod+Shift+S`。

```bash
pnpm dev
```

默认使用流程是：

1. 选择一个或多个页面元素。
2. 为每个目标分别编写修改要求。
3. 检查对应源码、DOM、CSS 和经过预算裁剪的代码上下文。
4. 在 Cursor 或 VS Code 中打开精确位置，或者复制生成的 Prompt。
5. 如果启用了 AI，先确认远程传输，再运行任务、审阅 Diff 与检查结果，最后明确选择应用或拒绝修改。

## 可选 AI 配置

只有完整的 Provider 配置可用时 AI 才会启用。最小接入只需在 Git 忽略的 `.env.local` 中提供以下内容，不需要修改 `spotPatch()`：

```dotenv
SPOTPATCH_AI_BASE_URL=https://relay.example.com/v1
SPOTPATCH_AI_MODEL=provider-model-name
SPOTPATCH_AI_API_KEY=<your-key>

# 可选默认值：
# SPOTPATCH_AI_PROTOCOL=chat-completions
# SPOTPATCH_AI_AUTHENTICATION=bearer
```

`SPOTPATCH_AI_PROTOCOL` 支持 `chat-completions` 和 `responses`，认证方式支持 `bearer` 和 `x-api-key`。API Key 只保留在 Vite Node 进程中，绝不能使用 `VITE_` 前缀，也不能提交到 Git。

你也可以在 `vite.config.ts` 中声明非秘密的 Provider 信息：

```ts
spotPatch({
  ai: {
    baseURL: "https://relay.example.com/v1",
    model: "provider-model-name",
  },
});
```

SpotPatch 不会向模型开放任意 Shell。Agent 修改创建在隔离 Git worktree 中，受到路径和规模策略约束；默认 `review` 模式只有在用户审阅后才会修改业务工作区。规范规则见 [AI Agent 执行与变更审阅](./docs/技术方案/16-AIAgent执行与变更审阅.md)和 [Provider 与凭据配置](./docs/技术方案/17-模型提供商与凭据配置.md)。

## 正式支持范围

| 项目     | 当前正式支持范围                   | 说明                                 |
| -------- | ---------------------------------- | ------------------------------------ |
| 框架     | React + Vite                       | `@spotpatch/vite` 是公共入口。       |
| Vite     | 5、6、7                            | 通过分版本兼容 fixture 验证。        |
| React    | 18.2–18.3                          | React 19 不在 Vite v1 的正式承诺内。 |
| 源码     | 默认处理 `src` 下的 `.jsx`、`.tsx` | 可配置 include 和 exclude。          |
| Node.js  | 20.19 或更高                       | CI 覆盖 Node 20 与 22。              |
| 浏览器   | Chromium                           | 自动化交互覆盖通过 Playwright 运行。 |
| 编辑器   | Cursor、VS Code                    | 默认自动识别，也可显式固定。         |
| 操作系统 | macOS、Windows、Linux              | CI 与编辑器启动逻辑按平台处理。      |

其他组合可能可以运行，但不属于当前公共承诺。唯一事实来源是[产品定义与边界](./docs/技术方案/01-产品定义与边界.md)。

> [!WARNING]
> React 19（包括 19.2.x）可以自行尝试，但不在正式支持范围内。请先在自身项目验证元素选择、源码定位、HMR 和 AI 流程，再用于日常开发。

## Next.js 公共预览用法

> [!WARNING]
> `@spotpatch/next@0.1.0` 是首个公共预览版，可以从 npm 安装；但 peer 范围只是候选测试范围，不能解释成完整兼容或生产支持声明。

该预览包含 CLI、Sidecar、Turbopack/webpack Loader、源码注册、Runtime bootstrap 和生产 no-op 隔离。它已经通过锁定范围 POC 和一个私有 Next 16 App Router 宿主，但完整的 Next/React/router/Node/OS/浏览器支持矩阵仍未完成。

安装唯一的框架入口包，初始化并检查接入，然后启动开发环境：

```bash
pnpm add -D @spotpatch/next
pnpm exec spotpatch-next init
pnpm exec spotpatch-next check
pnpm dev
```

`init` 会安全组合 `next.config`、在正确的 `instrumentation-client` 文件中增加 `@spotpatch/next/client`，并把简单的 `next dev` 脚本改为 `spotpatch-next dev`。`check` 只读检查这三个接入点。开发时必须通过 package script 启动；直接运行 `next dev` 不存在 SpotPatch Sidecar 生命周期所有者。

启动成功后终端会打印一行以 `[spotpatch:next] ready` 开头的信息。打开其中的 loopback 地址，即可使用 **选择元素** / **Select element**。可选 AI 流程复用上文的服务端 `SPOTPATCH_AI_*` 变量，绝不能改成带 `NEXT_PUBLIC_` 前缀的变量。

生成文件示例、生产命令、已知限制和证据边界见完整的 [`@spotpatch/next` 公共预览指南](./packages/next/README.md#简体中文)。作出兼容性声明前，必须核对 [Next.js 适配计划](./docs/技术方案/Next适配/00-索引与架构摘要.md)和[剩余支持门禁](./docs/技术方案/Next适配/08-测试验收与实施计划.md)。

## 配置

Vite 公共入口导出 `spotPatch(options)`，重要默认值如下：

| 选项         | 默认值                       | 用途                           |
| ------------ | ---------------------------- | ------------------------------ |
| `enabled`    | `true`                       | 需要时显式禁用插件。           |
| `include`    | `src` 内 JSX/TSX             | 允许注入源码标记的文件。       |
| `exclude`    | 依赖、测试、Story、生成目录  | 不允许转换的文件。             |
| `editor`     | `"auto"`                     | 自动识别 Cursor 或 VS Code。   |
| `redact`     | `true`                       | 清洗采集到的浏览器上下文。     |
| `shortcut`   | `"Mod+Shift+S"`              | 切换元素选择器。               |
| `allowLan`   | `false`                      | 默认只允许 loopback 本地协议。 |
| `locale`     | `"auto"`                     | 自动解析 `en-US` 或 `zh-CN`。  |
| `maxTargets` | `8`                          | 一次任务默认最多选择的目标数。 |
| `ai`         | `false` 或检测到完整环境配置 | 可选 Provider 和 Agent 配置。  |

完整类型和约束见 [`@spotpatch/vite`](./packages/vite/README.md)与[公共 API 规范](./docs/技术方案/03-公共API与数据模型.md)。

## 安全与生产隔离

- 浏览器只接收随机文件标识，不接收绝对源码路径。
- 源码读取仅限当前开发会话登记且位于项目 root 内的文件。
- 密码、Token、Cookie、Authorization、URL 凭据和内联数据会被清洗。
- Provider 凭据只保留在 Node 端，不注入客户端代码。
- 默认检查 loopback Host 与 Origin；显式开启 Vite LAN 会扩大信任边界。
- 生产构建验证 Runtime、源码标记、私有 API 和内部秘密零残留。
- SpotPatch 不会隐式执行 `stash`、`reset`、`commit`、`push`、发包或部署。

开启 LAN 或 AI 前请阅读完整的[本地协议与安全规范](./docs/技术方案/09-本地协议与安全.md)。

## 包结构

业务应用通常只需要安装一个框架适配器。

| 包                                                                 | 职责                                       | 业务应用是否直接使用    |
| ------------------------------------------------------------------ | ------------------------------------------ | ----------------------- |
| [`@spotpatch/vite`](https://www.npmjs.com/package/@spotpatch/vite) | 正式支持的 Vite 接入                       | **是**                  |
| [`@spotpatch/next`](./packages/next/README.md#简体中文)            | 可安装的 Next.js 0.x 公共预览              | 仅供预览，尚未正式支持  |
| `@spotpatch/compiler`                                              | 框架无关 JSX/TSX 标记编译器                | 适配器基础设施          |
| `@spotpatch/dev-server`                                            | 本地会话、源码访问、编辑器与 Agent 编排    | 适配器基础设施，仅 Node |
| `@spotpatch/runtime`                                               | 浏览器选择器、采集器、工作台和 Prompt 生成 | 由适配器安装            |
| `@spotpatch/react-adapter`                                         | 隔离的 React/Fiber 兼容边界                | 由适配器安装            |
| `@spotpatch/agent`                                                 | Provider、受限工具、worktree 和检查引擎    | 由适配器安装，仅 Node   |
| `@spotpatch/shared`                                                | 不可变模型、协议 Schema 和错误码           | 内部共享契约            |

某个包为了形成完整依赖图而公开发布，不代表它自动成为独立的用户接入入口。

## 仓库开发

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

CI 质量矩阵还会在 Ubuntu、macOS、Windows 和声明的 Node 版本上运行。Next.js 实验具有独立的 POC 与私有真实宿主命令；这些局部通过结果不能绕过文档中的 Next 正式支持门禁。

## 文档

- [文档索引](./docs/技术方案/00-索引与导航.md)
- [产品定义与支持边界](./docs/技术方案/01-产品定义与边界.md)
- [总体架构与包职责](./docs/技术方案/02-总体架构与技术栈.md)
- [公共 API 与默认值](./docs/技术方案/03-公共API与数据模型.md)
- [安全模型](./docs/技术方案/09-本地协议与安全.md)
- [测试与验收](./docs/技术方案/12-测试与验收.md)
- [Next.js 适配状态](./docs/技术方案/Next适配/00-索引与架构摘要.md)

## 许可证

[MIT](./LICENSE) © SpotPatch contributors.
