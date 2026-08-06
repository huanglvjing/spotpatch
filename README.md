# SpotPatch

SpotPatch 是一个仅在本地开发期运行的 React 页面反馈工具。它把选中的 DOM
元素追溯到源码位置，采集经过脱敏和预算裁剪的上下文，并生成可复制给编程助手的
结构化 Prompt；v1 不调用任何 AI 服务。

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
    }),
    react(),
  ],
});
```

启动 Vite 开发服务器后，点击右下角 `Select element`，或使用
`Mod+Shift+S`，即可完成“选择元素 → 添加说明 → 预览 Prompt → 复制”。生产构建
不会注入 runtime、source marker 或本地协议端点。

接入选项、默认值和安全边界分别见公共 API 与安全规范
(见 doc-id:03-public-api-models) (见 doc-id:09-local-protocol-security)。

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
