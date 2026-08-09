<p align="center">
  <a href="https://github.com/huanglvjing/spotpatch">
    <img src="https://raw.githubusercontent.com/huanglvjing/spotpatch/main/docs/assets/spotpatch-logo.svg" alt="SpotPatch" width="680" />
  </a>
</p>

<p align="center">
  <a href="#english">English</a> · <a href="#简体中文">简体中文</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@spotpatch/vite"><img src="https://img.shields.io/npm/v/%40spotpatch%2Fvite?logo=npm" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@spotpatch/vite"><img src="https://img.shields.io/npm/dm/%40spotpatch%2Fvite?logo=npm" alt="npm downloads" /></a>
  <a href="https://github.com/huanglvjing/spotpatch/actions/workflows/ci.yml"><img src="https://github.com/huanglvjing/spotpatch/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status" /></a>
  <a href="https://github.com/huanglvjing/spotpatch/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/%40spotpatch%2Fvite" alt="MIT license" /></a>
</p>

# `@spotpatch/vite`

## English

The supported Vite integration for SpotPatch: select React UI, trace it to JSX/TSX source, collect bounded and sanitized context, write per-target change requests, and either copy a structured prompt or run an optional review-gated AI Agent.

SpotPatch runs only with the Vite development server. Production builds contain no SpotPatch Runtime, source markers, or local API endpoints.

### Install

```bash
npm install --save-dev @spotpatch/vite
# or
pnpm add -D @spotpatch/vite
```

### Configure

Place SpotPatch before the React plugin so its development source transform runs first.

```ts
// vite.config.ts
import { spotPatch } from "@spotpatch/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [spotPatch(), react()],
});
```

Start the application normally:

```bash
pnpm dev
```

Select **Select element** in the bottom-right corner or press `Mod+Shift+S`. SpotPatch can collect multiple targets, preserve a separate instruction for each one, open the exact source location in Cursor or VS Code, and generate a structured prompt without requiring AI configuration.

### Compatibility

| Dependency           | Supported range                |
| -------------------- | ------------------------------ |
| Node.js              | `>=20.19.0`                    |
| Vite                 | `^5.0.0                        |     | ^6.0.0 |     | ^7.0.0` |
| React public support | `18.2–18.3`                    |
| Default source files | `src/**/*.jsx`, `src/**/*.tsx` |

React 19 is not part of the Vite v1 public support promise. Next.js projects must not use this package as a substitute for a Next adapter; see the repository's [Next.js status](https://github.com/huanglvjing/spotpatch/blob/main/docs/%E6%8A%80%E6%9C%AF%E6%96%B9%E6%A1%88/Next%E9%80%82%E9%85%8D/00-%E7%B4%A2%E5%BC%95%E4%B8%8E%E6%9E%B6%E6%9E%84%E6%91%98%E8%A6%81.md).

### Options

```ts
spotPatch({
  enabled: true,
  editor: "auto",
  redact: true,
  shortcut: "Mod+Shift+S",
  allowLan: false,
  debug: false,
  locale: "auto",
  maxTargets: 8,
  ai: false,
});
```

| Option       | Default                                           | Description                                                             |
| ------------ | ------------------------------------------------- | ----------------------------------------------------------------------- |
| `enabled`    | `true`                                            | Enables the development plugin.                                         |
| `include`    | JSX/TSX under `src`                               | Files eligible for source marker injection.                             |
| `exclude`    | dependencies, tests, stories and generated output | Files excluded from transformation.                                     |
| `editor`     | `"auto"`                                          | Auto-detect Cursor or VS Code; either can be fixed explicitly.          |
| `redact`     | `true`                                            | Sanitizes collected context; mandatory secret classes remain protected. |
| `budget`     | bounded defaults                                  | Limits total, DOM, CSS and source context sizes.                        |
| `shortcut`   | `"Mod+Shift+S"`                                   | Toggles element selection.                                              |
| `allowLan`   | `false`                                           | Keeps Host and Origin authorization loopback-only by default.           |
| `debug`      | `false`                                           | Enables development diagnostics without logging credentials.            |
| `locale`     | `"auto"`                                          | Resolves `en-US` or `zh-CN`.                                            |
| `maxTargets` | `8`                                               | Targets allowed in one change request by default.                       |
| `ai`         | disabled or a detected complete environment       | Optional provider and Agent settings.                                   |

The package exports the option types, AI provider types, Agent limits, and immutable defaults. See the [public API specification](https://github.com/huanglvjing/spotpatch/blob/main/docs/%E6%8A%80%E6%9C%AF%E6%96%B9%E6%A1%88/03-%E5%85%AC%E5%85%B1API%E4%B8%8E%E6%95%B0%E6%8D%AE%E6%A8%A1%E5%9E%8B.md) for the complete constraints.

### Optional AI Agent

AI remains disabled unless every required provider value is available. The smallest setup uses a Git-ignored `.env.local` file:

```dotenv
SPOTPATCH_AI_BASE_URL=https://relay.example.com/v1
SPOTPATCH_AI_MODEL=provider-model-name
SPOTPATCH_AI_API_KEY=<your-key>

# Optional:
# SPOTPATCH_AI_PROTOCOL=chat-completions
# SPOTPATCH_AI_AUTHENTICATION=bearer
```

Supported protocols are `chat-completions` and `responses`; supported authentication modes are `bearer` and `x-api-key`. Never give the API key a `VITE_` prefix: credentials must stay in the Vite Node process.

Non-secret provider values can instead be declared in the plugin configuration:

```ts
spotPatch({
  ai: {
    baseURL: "https://relay.example.com/v1",
    model: "provider-model-name",
  },
});
```

The default Agent path is review-gated: it probes provider capabilities, works in an isolated Git worktree, exposes bounded file tools rather than an arbitrary shell, runs configured checks, and shows the complete Diff before Apply. SpotPatch does not commit, push, publish, or deploy application code.

### Security and production behavior

- Browser requests use a random session token and random file identifiers.
- Source reads are restricted to registered JSX/TSX files inside the active project root.
- Sensitive DOM data, credentials, tokens, cookies and authorization values are sanitized.
- API keys never enter the browser bundle or generated prompt.
- `allowLan: false` is the default. Enabling LAN access expands the trust boundary and should be deliberate.
- `vite build` and `vite preview` do not activate the SpotPatch development service.
- Production leakage tests assert zero Runtime, source markers, endpoints, and internal secrets.

### Troubleshooting

- **No selection button:** confirm `spotPatch()` appears before the React plugin and that the app is running through `vite`/`vite dev`, not `vite preview`.
- **No exact source location:** confirm the component is authored in an included `.jsx` or `.tsx` file under `src`, or configure `include` explicitly.
- **AI is unavailable:** provide all three required environment values or set `ai: false`; partial environment configuration fails closed.
- **Editor does not open:** use `editor: "cursor"` or `editor: "vscode"` when terminal auto-detection cannot identify the intended editor.

### Links

- [Repository and complete documentation](https://github.com/huanglvjing/spotpatch)
- [Security model](https://github.com/huanglvjing/spotpatch/blob/main/docs/%E6%8A%80%E6%9C%AF%E6%96%B9%E6%A1%88/09-%E6%9C%AC%E5%9C%B0%E5%8D%8F%E8%AE%AE%E4%B8%8E%E5%AE%89%E5%85%A8.md)
- [AI execution model](https://github.com/huanglvjing/spotpatch/blob/main/docs/%E6%8A%80%E6%9C%AF%E6%96%B9%E6%A1%88/16-AIAgent%E6%89%A7%E8%A1%8C%E4%B8%8E%E5%8F%98%E6%9B%B4%E5%AE%A1%E9%98%85.md)
- [Issues](https://github.com/huanglvjing/spotpatch/issues)

---

## 简体中文

`@spotpatch/vite` 是 SpotPatch 当前正式支持的 Vite 接入包：在 React 页面中选择元素，定位到 JSX/TSX 源码，采集经过预算约束与脱敏的上下文，为每个目标分别编写要求，然后复制结构化 Prompt，或运行默认需要审阅的可选 AI Agent。

SpotPatch 只在 Vite 开发服务器中运行。生产构建不包含 SpotPatch Runtime、源码标记或本地 API 端点。

### 安装

```bash
npm install --save-dev @spotpatch/vite
# 或
pnpm add -D @spotpatch/vite
```

### 配置

SpotPatch 必须放在 React 插件之前，让开发期源码转换先执行。

```ts
// vite.config.ts
import { spotPatch } from "@spotpatch/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [spotPatch(), react()],
});
```

照常启动应用：

```bash
pnpm dev
```

点击右下角的 **选择元素** 或按下 `Mod+Shift+S`。SpotPatch 支持一次采集多个目标、为每个目标保留独立修改要求、在 Cursor 或 VS Code 中打开精确位置，并且在完全不配置 AI 的情况下生成结构化 Prompt。

### 兼容范围

| 依赖           | 正式支持范围                   |
| -------------- | ------------------------------ |
| Node.js        | `>=20.19.0`                    |
| Vite           | `^5.0.0                        |     | ^6.0.0 |     | ^7.0.0` |
| React 正式支持 | `18.2–18.3`                    |
| 默认源码文件   | `src/**/*.jsx`、`src/**/*.tsx` |

React 19 不在 Vite v1 正式承诺内。Next.js 项目不能把本包当作 Next 适配器使用；准确状态见仓库中的 [Next.js 适配说明](https://github.com/huanglvjing/spotpatch/blob/main/docs/%E6%8A%80%E6%9C%AF%E6%96%B9%E6%A1%88/Next%E9%80%82%E9%85%8D/00-%E7%B4%A2%E5%BC%95%E4%B8%8E%E6%9E%B6%E6%9E%84%E6%91%98%E8%A6%81.md)。

### 选项

```ts
spotPatch({
  enabled: true,
  editor: "auto",
  redact: true,
  shortcut: "Mod+Shift+S",
  allowLan: false,
  debug: false,
  locale: "auto",
  maxTargets: 8,
  ai: false,
});
```

| 选项         | 默认值                       | 说明                                                 |
| ------------ | ---------------------------- | ---------------------------------------------------- |
| `enabled`    | `true`                       | 启用开发期插件。                                     |
| `include`    | `src` 下 JSX/TSX             | 允许注入源码标记的文件。                             |
| `exclude`    | 依赖、测试、Story 与生成目录 | 不进行转换的文件。                                   |
| `editor`     | `"auto"`                     | 自动识别 Cursor 或 VS Code，也可显式固定。           |
| `redact`     | `true`                       | 清洗采集上下文；强制保护的秘密类型不会因关闭而暴露。 |
| `budget`     | 有界默认值                   | 限制总量、DOM、CSS 和源码上下文大小。                |
| `shortcut`   | `"Mod+Shift+S"`              | 切换元素选择器。                                     |
| `allowLan`   | `false`                      | 默认只允许 loopback Host 与 Origin。                 |
| `debug`      | `false`                      | 输出不包含凭据的开发诊断。                           |
| `locale`     | `"auto"`                     | 自动解析 `en-US` 或 `zh-CN`。                        |
| `maxTargets` | `8`                          | 一次修改任务默认允许的目标数。                       |
| `ai`         | 关闭或检测到完整环境配置     | 可选 Provider 和 Agent 配置。                        |

本包导出选项类型、AI Provider 类型、Agent 限制和不可变默认值。完整约束见[公共 API 规范](https://github.com/huanglvjing/spotpatch/blob/main/docs/%E6%8A%80%E6%9C%AF%E6%96%B9%E6%A1%88/03-%E5%85%AC%E5%85%B1API%E4%B8%8E%E6%95%B0%E6%8D%AE%E6%A8%A1%E5%9E%8B.md)。

### 可选 AI Agent

只有全部必需 Provider 值可用时 AI 才会启用。最小配置放在 Git 忽略的 `.env.local` 中：

```dotenv
SPOTPATCH_AI_BASE_URL=https://relay.example.com/v1
SPOTPATCH_AI_MODEL=provider-model-name
SPOTPATCH_AI_API_KEY=<your-key>

# 可选：
# SPOTPATCH_AI_PROTOCOL=chat-completions
# SPOTPATCH_AI_AUTHENTICATION=bearer
```

协议支持 `chat-completions` 与 `responses`，认证支持 `bearer` 与 `x-api-key`。API Key 绝不能使用 `VITE_` 前缀，凭据必须只保留在 Vite Node 进程中。

非秘密的 Provider 信息也可以写入插件配置：

```ts
spotPatch({
  ai: {
    baseURL: "https://relay.example.com/v1",
    model: "provider-model-name",
  },
});
```

默认 Agent 路径必须经过审阅：先探测 Provider 能力，在隔离 Git worktree 中工作，只暴露有界文件工具而不是任意 Shell，执行已配置检查，并在 Apply 前展示完整 Diff。SpotPatch 不会替业务代码执行 commit、push、发包或部署。

### 安全与生产行为

- 浏览器请求使用随机会话令牌和随机文件标识。
- 源码读取只允许命中活动项目 root 内、当前会话登记的 JSX/TSX 文件。
- 敏感 DOM 数据、凭据、Token、Cookie 与 Authorization 会被清洗。
- API Key 不会进入浏览器 bundle 或生成的 Prompt。
- `allowLan: false` 是默认值；启用 LAN 会扩大信任边界，必须明确评估。
- `vite build` 与 `vite preview` 不会启动 SpotPatch 开发服务。
- 生产泄漏测试验证 Runtime、源码标记、端点和内部秘密零残留。

### 常见问题

- **没有选择元素按钮：**确认 `spotPatch()` 位于 React 插件之前，并且应用通过 `vite`/`vite dev` 而不是 `vite preview` 启动。
- **没有精确源码位置：**确认组件来自 include 范围内的 `.jsx` 或 `.tsx` 文件，默认范围是 `src`。
- **AI 不可用：**提供全部三个必需环境变量，或者显式设置 `ai: false`；不完整配置会安全失败。
- **编辑器没有打开：**终端自动识别无法确定目标时，显式设置 `editor: "cursor"` 或 `editor: "vscode"`。

### 链接

- [仓库与完整文档](https://github.com/huanglvjing/spotpatch)
- [安全模型](https://github.com/huanglvjing/spotpatch/blob/main/docs/%E6%8A%80%E6%9C%AF%E6%96%B9%E6%A1%88/09-%E6%9C%AC%E5%9C%B0%E5%8D%8F%E8%AE%AE%E4%B8%8E%E5%AE%89%E5%85%A8.md)
- [AI 执行模型](https://github.com/huanglvjing/spotpatch/blob/main/docs/%E6%8A%80%E6%9C%AF%E6%96%B9%E6%A1%88/16-AIAgent%E6%89%A7%E8%A1%8C%E4%B8%8E%E5%8F%98%E6%9B%B4%E5%AE%A1%E9%98%85.md)
- [问题反馈](https://github.com/huanglvjing/spotpatch/issues)

### License / 许可证

[MIT](https://github.com/huanglvjing/spotpatch/blob/main/LICENSE) © SpotPatch contributors.
