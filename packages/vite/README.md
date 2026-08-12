<h1><a href="https://github.com/huanglvjing/spotpatch"><img src="https://raw.githubusercontent.com/huanglvjing/spotpatch/main/docs/assets/spotpatch-npm-icon.png" alt="SpotPatch" width="48" height="48" align="absmiddle" /></a> <code>@spotpatch/vite</code></h1>

<p align="center">
  <a href="#english">English</a> · <a href="#简体中文">简体中文</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@spotpatch/vite"><img src="https://img.shields.io/npm/v/%40spotpatch%2Fvite?logo=npm" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@spotpatch/vite"><img src="https://img.shields.io/npm/dm/%40spotpatch%2Fvite?logo=npm" alt="npm downloads" /></a>
  <a href="https://github.com/huanglvjing/spotpatch/actions/workflows/ci.yml"><img src="https://github.com/huanglvjing/spotpatch/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status" /></a>
  <a href="https://github.com/huanglvjing/spotpatch/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/%40spotpatch%2Fvite" alt="MIT license" /></a>
</p>

## English

The supported Vite integration for SpotPatch: select React UI, trace it to JSX/TSX source, collect bounded and sanitized context, write per-target change requests, and either copy a structured prompt or run an optional review-gated AI Agent.

SpotPatch runs only with the Vite development server. Production builds contain no SpotPatch Runtime, source markers, or local API endpoints.

### One-command setup (recommended)

```bash
npx --yes @spotpatch/vite@latest setup
```

This npm-bootstrap command supports both npm and pnpm projects. It fetches the registry's actual latest CLI, detects the project package manager, installs that CLI's exact SpotPatch version, updates a supported `vite.config.*`, and verifies the result. The exact-version handoff avoids pnpm 11's default 24-hour `minimumReleaseAge` policy silently resolving `@latest` to an older mature release.

The initializer supports configuration objects and object-returning `defineConfig` callbacks, while ambiguous dynamic configurations fail without writing the config.

For npm, installation and initialization can also be kept separate:

```bash
npm install --save-dev @spotpatch/vite@latest
npx spotpatch-vite init
```

With pnpm 11, use the recommended setup command, install a trusted exact version, or wait until the release is 24 hours old. SpotPatch does not globally disable the project's supply-chain quarantine.

The initializer places SpotPatch before the React plugin so source markers are injected before React transforms the module:

```ts
// vite.config.ts
import { spotPatch } from "@spotpatch/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [spotPatch({ trustedFastMode: true }), react()],
});
```

When no safe local TypeScript check can be discovered, it generates `spotPatch()` and keeps Review mode. Unsupported dynamic configuration can still be integrated manually using the same plugin order.

Start the application normally:

```bash
pnpm dev
```

Select **Select element** in the bottom-right corner or press `Mod+Shift+S`. SpotPatch can collect multiple targets across same-project pages, preserve them through navigation and workbench close/reopen cycles, keep a separate instruction for each one, open the exact source location in Cursor or VS Code, and generate a structured prompt without requiring AI configuration.

### Compatibility

| Dependency           | Supported range                |
| -------------------- | ------------------------------ |
| Node.js              | `>=20.19.0`                    |
| Vite                 | `>=5.0.0 <8.0.0`               |
| React public support | `18.2–18.3`                    |
| Default source files | `src/**/*.jsx`, `src/**/*.tsx` |

React 19, including 19.2.x, is not part of the Vite v1 public support promise. You may try it experimentally, but verify picking, source resolution, HMR, and the AI workflow in your application before relying on it. Next.js projects must not use this package as a substitute for a Next adapter; see the repository's [Next.js status](https://github.com/huanglvjing/spotpatch/blob/main/docs/%E6%8A%80%E6%9C%AF%E6%96%B9%E6%A1%88/Next%E9%80%82%E9%85%8D/00-%E7%B4%A2%E5%BC%95%E4%B8%8E%E6%9E%B6%E6%9E%84%E6%91%98%E8%A6%81.md).

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

| Option            | Default                                           | Description                                                             |
| ----------------- | ------------------------------------------------- | ----------------------------------------------------------------------- |
| `enabled`         | `true`                                            | Enables the development plugin.                                         |
| `include`         | JSX/TSX under `src`                               | Files eligible for source marker injection.                             |
| `exclude`         | dependencies, tests, stories and generated output | Files excluded from transformation.                                     |
| `editor`          | `"auto"`                                          | Auto-detect Cursor or VS Code; either can be fixed explicitly.          |
| `redact`          | `true`                                            | Sanitizes collected context; mandatory secret classes remain protected. |
| `budget`          | bounded defaults                                  | Limits total, DOM, CSS and source context sizes.                        |
| `shortcut`        | `"Mod+Shift+S"`                                   | Toggles element selection.                                              |
| `allowLan`        | `false`                                           | Keeps Host and Origin authorization loopback-only by default.           |
| `debug`           | `false`                                           | Enables development diagnostics without logging credentials.            |
| `locale`          | `"auto"`                                          | Resolves `en-US` or `zh-CN`.                                            |
| `maxTargets`      | `8`                                               | Targets allowed in one change request by default.                       |
| `ai`              | disabled or a detected complete environment       | Optional provider and Agent settings.                                   |
| `trustedFastMode` | `false`                                           | Exposes Review/Trusted direct and discovers TypeScript for Review.      |

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

The default Agent path is review-gated: **Check environment** provides an optional source-free capability diagnostic, while Run starts the real isolated tool session directly and proves tool continuation inline. The Agent supplies bounded nearby project conventions, exposes file tools rather than an arbitrary shell, reuses current host-run checks, and shows the complete Diff before Apply.

To expose the optional Trusted direct mode, configure it explicitly. It requires a local TypeScript project check; otherwise keep the default Review mode:

```ts
spotPatch({ trustedFastMode: true });
```

The page defaults to Review. Choosing Trusted direct uses the exact SpotPatch source path first, removes `run_check` from the model tools, skips host project checks, and immediately applies the isolated Diff after one session-scoped consent. This is faster but does not promise that TypeScript, lint, tests, or builds pass; configured checks still protect Review and Auto modes. Project-root boundaries, protected paths, atomic patch checks, concurrent-edit hashes, Revert, and the ban on arbitrary shell remain enforced. SpotPatch does not commit, push, publish, or deploy application code.

### Security and production behavior

- Browser requests use a random session token and random file identifiers.
- Source reads are restricted to registered JSX/TSX files inside the active project root.
- Sensitive DOM data, credentials, tokens, cookies and authorization values are sanitized.
- API keys never enter the browser bundle or generated prompt.
- `allowLan: false` is the default. Enabling LAN access expands the trust boundary and should be deliberate.
- `vite build` and `vite preview` do not activate the SpotPatch development service.
- Production leakage tests assert zero Runtime, source markers, endpoints, and internal secrets.

### Troubleshooting

- **pnpm 11 installs an older version for `@latest`:** its default 24-hour `minimumReleaseAge` policy selects the newest mature release. Use the recommended `npx ... setup`, specify a trusted exact version, or wait 24 hours.
- **Initializer rejects the config:** use a configuration object or a callback with one unambiguous object return. For conditional returns or dynamic plugin arrays, configure `spotPatch()` manually before the React plugin.
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

### 一条命令接入（推荐）

```bash
npx --yes @spotpatch/vite@latest setup
```

这条由 npm 引导的命令同时支持 npm 和 pnpm 项目。它先取得 registry 真正的最新 CLI，再识别项目包管理器、安装该 CLI 对应的 SpotPatch 精确版本、安全更新受支持的 `vite.config.*` 并验证结果。精确版本交接可以避免 pnpm 11 默认 24 小时 `minimumReleaseAge` 把 `@latest` 解析成较旧的成熟版本。

初始化器支持配置对象和返回对象的 `defineConfig` 回调；有歧义的动态配置会在不写入配置文件的情况下失败。

npm 项目也可以分开安装和初始化：

```bash
npm install --save-dev @spotpatch/vite@latest
npx spotpatch-vite init
```

pnpm 11 项目请使用推荐的 setup 命令、安装已确认的精确版本，或等待发布满 24 小时。SpotPatch 不会全局关闭项目的供应链隔离策略。

初始化器会将 SpotPatch 放在 React 插件之前，确保源码标记在 React 转换前注入：

```ts
// vite.config.ts
import { spotPatch } from "@spotpatch/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [spotPatch({ trustedFastMode: true }), react()],
});
```

无法发现安全的本地 TypeScript 检查时，初始化器会生成 `spotPatch()` 并保持审阅模式。不受支持的动态配置仍可按相同插件顺序手动接入。

照常启动应用：

```bash
pnpm dev
```

点击右下角的 **选择元素** 或按下 `Mod+Shift+S`。SpotPatch 支持跨同一项目的多个页面采集目标，在页面跳转及工作台关闭/重开后保留目标与独立修改要求，在 Cursor 或 VS Code 中打开精确位置，并且在完全不配置 AI 的情况下生成结构化 Prompt。

### 兼容范围

| 依赖           | 正式支持范围                   |
| -------------- | ------------------------------ |
| Node.js        | `>=20.19.0`                    |
| Vite           | `>=5.0.0 <8.0.0`               |
| React 正式支持 | `18.2–18.3`                    |
| 默认源码文件   | `src/**/*.jsx`、`src/**/*.tsx` |

React 19（包括 19.2.x）不在 Vite v1 正式承诺内。可以作为实验性组合尝试，但在日常使用前必须在自身项目验证元素选择、源码定位、HMR 和 AI 流程。Next.js 项目不能把本包当作 Next 适配器使用；准确状态见仓库中的 [Next.js 适配说明](https://github.com/huanglvjing/spotpatch/blob/main/docs/%E6%8A%80%E6%9C%AF%E6%96%B9%E6%A1%88/Next%E9%80%82%E9%85%8D/00-%E7%B4%A2%E5%BC%95%E4%B8%8E%E6%9E%B6%E6%9E%84%E6%91%98%E8%A6%81.md)。

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

| 选项              | 默认值                       | 说明                                                   |
| ----------------- | ---------------------------- | ------------------------------------------------------ |
| `enabled`         | `true`                       | 启用开发期插件。                                       |
| `include`         | `src` 下 JSX/TSX             | 允许注入源码标记的文件。                               |
| `exclude`         | 依赖、测试、Story 与生成目录 | 不进行转换的文件。                                     |
| `editor`          | `"auto"`                     | 自动识别 Cursor 或 VS Code，也可显式固定。             |
| `redact`          | `true`                       | 清洗采集上下文；强制保护的秘密类型不会因关闭而暴露。   |
| `budget`          | 有界默认值                   | 限制总量、DOM、CSS 和源码上下文大小。                  |
| `shortcut`        | `"Mod+Shift+S"`              | 切换元素选择器。                                       |
| `allowLan`        | `false`                      | 默认只允许 loopback Host 与 Origin。                   |
| `debug`           | `false`                      | 输出不包含凭据的开发诊断。                             |
| `locale`          | `"auto"`                     | 自动解析 `en-US` 或 `zh-CN`。                          |
| `maxTargets`      | `8`                          | 一次修改任务默认允许的目标数。                         |
| `ai`              | 关闭或检测到完整环境配置     | 可选 Provider 和 Agent 配置。                          |
| `trustedFastMode` | `false`                      | 开放审阅/可信极速选择；TypeScript 检查供审阅模式使用。 |

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

默认 Agent 路径必须经过审阅：“检查运行环境”提供不含源码的可选能力诊断；点击运行会直接进入真实隔离工具会话，并在会话内证明工具续接能力。Agent 会提供有界的就近项目规范，只暴露文件工具而不是任意 Shell，复用当前变更版本中由宿主实际执行的检查，并在 Apply 前展示完整 Diff。

需要开放可选的“可信极速”模式时，请显式配置。它要求项目能提供本地 TypeScript 检查；否则请保持默认的审阅模式：

```ts
spotPatch({ trustedFastMode: true });
```

页面默认保持审阅模式。用户选择“可信极速”后，Agent 会优先使用 SpotPatch 已定位的精确源码路径，不再获得 `run_check` 工具，也不执行宿主项目检查；隔离 Diff 形成后立即写回。它速度更快，但不承诺 TypeScript、lint、测试或构建通过；配置的检查仍用于审阅和受控自动模式。项目根、保护路径、原子 patch 校验、并发哈希冲突和 Revert 仍然保留，也不会开放任意 Shell，或替业务代码执行 commit、push、发包和部署。

### 安全与生产行为

- 浏览器请求使用随机会话令牌和随机文件标识。
- 源码读取只允许命中活动项目 root 内、当前会话登记的 JSX/TSX 文件。
- 敏感 DOM 数据、凭据、Token、Cookie 与 Authorization 会被清洗。
- API Key 不会进入浏览器 bundle 或生成的 Prompt。
- `allowLan: false` 是默认值；启用 LAN 会扩大信任边界，必须明确评估。
- `vite build` 与 `vite preview` 不会启动 SpotPatch 开发服务。
- 生产泄漏测试验证 Runtime、源码标记、端点和内部秘密零残留。

### 常见问题

- **pnpm 11 对 `@latest` 安装了旧版本：**默认 24 小时 `minimumReleaseAge` 会选择最新的成熟版本。请使用推荐的 `npx ... setup`、安装已确认的精确版本，或等待 24 小时。
- **初始化器拒绝配置：**请使用配置对象，或只含一个明确对象返回的回调。存在条件返回或动态插件数组时，手动将 `spotPatch()` 放到 React 插件之前。
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
