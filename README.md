# SpotPatch

SpotPatch 是一个仅在本地开发期运行的 React 页面反馈工具。它把选中的 DOM
元素追溯到源码位置，为多个目标分别保存修改要求，采集经过脱敏和预算裁剪的上下文，
并生成可复制给编程助手的结构化 Prompt。工作台内置中英文并可即时切换。AI 默认关闭；v1.1 可选接入 OpenAI-compatible API，在隔离 Git
worktree 中执行受控 Agent 工具，并经 Diff 与检查审阅后修改本地代码。

规范入口：[docs/技术方案/00-索引与导航.md](./docs/技术方案/00-索引与导航.md)。
真实项目验收证据：
[docs/验收/2026-08-06-shengsuanyun-web-v1验收报告.md](./docs/验收/2026-08-06-shengsuanyun-web-v1验收报告.md)。

## 支持范围

- Node.js 20.19+ 或 22
- Vite 5、6、7
- React 18.2、18.3
- Chromium 自动化验收

正式支持边界以产品规范为准 (见 doc-id:01-product-boundary)。

## 安装与接入

发布到 npm 后，用户只需安装入口包：

```bash
pnpm add -D @spotpatch/vite
```

SpotPatch 必须放在 React/SWC 插件之前：

```ts
import { spotPatch } from "@spotpatch/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    spotPatch({
      editor: "vscode",
      redact: true,
      allowLan: false,
      locale: "auto",
      maxTargets: 8,
    }),
    react(),
  ],
});
```

启动 Vite 开发服务器后，点击右下角 `Select element`，或使用
`Mod+Shift+S`，即可完成“选择元素 → 为当前目标输入修改要求 → 按需追加并分别描述其他目标 → 预览 Prompt → 复制”。标题栏可在中文和英文之间切换，已有草稿不会丢失。生产构建
不会注入 runtime、source marker 或本地协议端点。

接入选项、默认值和安全边界分别见公共 API 与安全规范
(见 doc-id:03-public-api-models) (见 doc-id:09-local-protocol-security)。

## AI Agent（可选）

AI 模式不要求 Codex CLI。URL、协议和真实模型名写在 Vite 的可信配置中，Key
只通过启动 Vite 的 Node 环境变量提供。以下是非规范性接入示例；完整字段和约束以
[公共 API](./docs/技术方案/03-公共API与数据模型.md)、
[Provider 与凭据](./docs/技术方案/17-模型提供商与凭据配置.md)及
[Agent 执行规范](./docs/技术方案/16-AIAgent执行与变更审阅.md)为准。

```ts
spotPatch({
  editor: "vscode",
  redact: true,
  ai: {
    providers: {
      relay: {
        type: "openai-compatible",
        label: "Team relay",
        protocol: "responses",
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

Key 不得使用 `VITE_` 前缀，也不得提交到 Git：

```bash
export SPOTPATCH_AI_API_KEY='<your-key>'
pnpm dev
```

使用顺序是“选择一个或多个元素 → 为每个目标分别输入要求 → 确认远程传输 → Verify & run → 审阅完整
Diff/检查 → Apply changes”，应用后可在文件未继续变化时安全 Revert。真实 Job
要求业务 Git 工作区干净；能力探测未确认结构化工具调用、工具结果续传和流式协议时，
SpotPatch 只保留本地 Prompt，不会从自然语言代码块自动改文件。

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

## 安全原则

- 浏览器只持有随机 `fileId` 和会话令牌，不持有绝对源码路径。
- 默认只接受 loopback Host/Origin；开启 LAN 必须显式配置。
- 文件读取只能命中本次 Vite 会话已登记、项目 root 内的 JSX/TSX 文件。
- 表单值、密码、token、Cookie、Authorization、URL 凭据和内联数据始终脱敏。
- Shadow DOM UI 只通过 `textContent` 展示采集内容。

完整规则及错误码只有安全规范一处定义 (见 doc-id:09-local-protocol-security)。
