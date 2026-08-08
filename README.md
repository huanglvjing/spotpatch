# SpotPatch

SpotPatch 是一个仅在本地开发期运行的 React 页面反馈工具。它把选中的 DOM
元素追溯到源码位置，为多个目标分别保存修改要求，采集经过脱敏和预算裁剪的上下文，
并生成可复制给编程助手的结构化 Prompt。工作台内置中英文并可即时切换。没有完整 AI 配置时 AI 默认关闭；v1.1 可选接入 OpenAI-compatible API，在隔离 Git
worktree 中执行受控 Agent 工具，并经 Diff 与检查审阅后修改本地代码。

规范入口：[docs/技术方案/00-索引与导航.md](./docs/技术方案/00-索引与导航.md)。
真实项目验收证据：
[docs/验收/2026-08-06-spotpatch-web-v1验收报告.md](./docs/验收/2026-08-06-spotpatch-web-v1验收报告.md)。

## 支持范围

- Node.js 20.19+ 或 22
- Vite 5、6、7
- React 18.2、18.3
- Chromium 自动化验收

正式支持边界以产品规范为准 (见 doc-id:01-product-boundary)。

## 安装与接入

入口包已发布到 npm，用户只需安装：

```bash
npm install --save-dev @spotpatch/vite
# 或：pnpm add -D @spotpatch/vite
```

SpotPatch 必须放在 React/SWC 插件之前：

```ts
import { spotPatch } from "@spotpatch/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [spotPatch(), react()],
});
```

启动 Vite 开发服务器后，点击右下角 `Select element`，或使用
`Mod+Shift+S`，即可完成“选择元素 → 为当前目标输入修改要求 → 按需追加并分别描述其他目标 → 预览 Prompt → 复制”。标题栏可在中文和英文之间切换，已有草稿不会丢失。生产构建
不会注入 runtime、source marker 或本地协议端点。

源码按钮默认自动识别当前可用的 Cursor 或 VS Code，并精确打开到所选元素的行、列；
也可通过 `editor: "cursor"` 或 `editor: "vscode"` 固定选择。工作台标题栏提供
[GitHub 仓库](https://github.com/huanglvjing/spotpatch)入口，方便查看文档、反馈问题和 Star 项目。

接入选项、默认值和安全边界分别见公共 API 与安全规范
(见 doc-id:03-public-api-models) (见 doc-id:09-local-protocol-security)。

## AI Agent（可选）

AI 模式不要求 Codex CLI。最简接入无需修改上面的 `spotPatch()`：在被 Git 忽略的
`.env.local` 中提供 URL、模型和 Key，插件会在 Vite Node 端自动发现，任何必要值缺失都会明确失败：

```dotenv
SPOTPATCH_AI_BASE_URL=https://relay.example.com/v1
SPOTPATCH_AI_MODEL=provider-model-name
SPOTPATCH_AI_API_KEY=<your-key>

# 可选，默认 chat-completions 与 bearer
SPOTPATCH_AI_PROTOCOL=chat-completions
SPOTPATCH_AI_AUTHENTICATION=bearer
```

Key 不得使用 `VITE_` 前缀，也不得提交到 Git。中转站使用 `x-api-key` 时，把认证变量设为 `x-api-key`，无需在源码中加入 Header 或 Key。

只希望在 Vite 配置指定非秘密的 URL 和模型时，可以使用简洁 API：

```ts
spotPatch({
  ai: {
    baseURL: "https://relay.example.com/v1",
    model: "provider-model-name",
  },
});
```

完整多 Provider、多模型和项目检查仍使用高级配置。以下是非规范性示例；完整字段和约束以
[公共 API](./docs/技术方案/03-公共API与数据模型.md)、
[Provider 与凭据](./docs/技术方案/17-模型提供商与凭据配置.md)及
[Agent 执行规范](./docs/技术方案/16-AIAgent执行与变更审阅.md)为准。

```ts
spotPatch({
  redact: true,
  ai: {
    providers: {
      relay: {
        type: "openai-compatible",
        label: "Team relay",
        protocol: "responses",
        authentication: "bearer",
        baseURL: "https://relay.example.com/v1",
        apiKeyEnv: "SPOTPATCH_AI_API_KEY",
        models: {
          coding: {
            label: "Coding model",
            model: "provider-model-name",
          },
        },
        defaultModel: "coding",
      },
    },
    defaultProvider: "relay",
    execution: {
      applyMode: "review",
      checks: {
        lint: { label: "Lint", command: "pnpm", args: ["lint"] },
        build: { label: "Build", command: "pnpm", args: ["build"] },
      },
    },
  },
});
```

使用顺序是“选择一个或多个元素 → 为每个目标分别输入要求 → 确认远程传输 → 检查运行环境 →
Verify & run → 审阅完整 Diff/检查 → Apply changes”，应用后可在 Agent 触及文件未继续变化时安全
Revert。工作区干净时可直接运行；存在 staged、unstaged 或有界普通 untracked 文件时，工作台会列出
分类计数并要求一次明确的“纳入本地修改”同意。SpotPatch 把这些内容复制成隔离基线，不会自动
stash、reset、commit 或改动暂存区；Apply/Revert 只处理 Agent 增量。冲突、进行中的 Git 操作、
不支持的未跟踪项或超出安全快照上限时会显示具体阻断原因。能力探测未确认结构化工具调用、工具
结果续传和流式协议时，SpotPatch 只保留本地 Prompt，不会从自然语言代码块自动改文件。
兼容中转站在后续模型轮次复用 tool call ID；同一轮出现冲突 ID 时仍会拒绝且不产生源码副作用。
工具参数不符合声明与调用 ID 冲突会显示不同诊断，便于区分模型参数问题和中转协议问题。

## 本地开发

```bash
pnpm install
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

质量门禁和性能预算的唯一规范见测试与验收文档
(见 doc-id:12-testing-acceptance)。`@spotpatch/runtime`、
`@spotpatch/react-adapter` 和 `@spotpatch/shared` 是随入口包安装的内部依赖，应用
不应直接配置它们。

## npm 发布

仓库使用 Changesets 管理五个公共包的统一首发。用户只安装 `@spotpatch/vite`，但
`@spotpatch/shared`、`@spotpatch/react-adapter`、`@spotpatch/runtime` 和
`@spotpatch/agent` 必须同时发布，才能形成可安装的依赖图。

首次发布需要维护者完成以下外部配置：

1. 在 npm 创建或确认拥有 `@spotpatch` scope 的发布权限。
2. 在 GitHub 仓库 Secret 中配置最小权限的 `NPM_TOKEN`。
3. 在仓库 Actions 设置中启用 workflow 读写权限，并允许 Actions 创建 Pull Request。
4. 推送带 Changeset 的变更；Release workflow 会先创建 Version Packages PR。
5. 审阅并合并版本 PR；合并后的 Release workflow 才会发布 npm 包。

发布工作流会在发布前运行格式、Lint、类型、单测和包验证，并为公开仓库产物生成
provenance。首次发布成功后，应在 npm 为五个包分别配置 GitHub Actions trusted
publisher，再通过后续变更移除长期 `NPM_TOKEN`。不得把 npm token、AI Key 或其他
凭据写入仓库、Changeset、workflow 参数或 `VITE_` 环境变量。

## 安全原则

- 浏览器只持有随机 `fileId` 和会话令牌，不持有绝对源码路径。
- 默认只接受 loopback Host/Origin；开启 LAN 必须显式配置。
- 文件读取只能命中本次 Vite 会话已登记、项目 root 内的 JSX/TSX 文件。
- 表单值、密码、token、Cookie、Authorization、URL 凭据和内联数据始终脱敏。
- Shadow DOM UI 只通过 `textContent` 展示采集内容。

完整规则及错误码只有安全规范一处定义 (见 doc-id:09-local-protocol-security)。
