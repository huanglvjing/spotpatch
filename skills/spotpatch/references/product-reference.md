# SpotPatch 产品参考

以下内容用于需要精确命令、兼容性和安全边界时查阅。以仓库当前 README 与各包 README 为准；发布新版本时应同步更新本文件和 `SKILL.md` 中的版本元数据。

## 定位

SpotPatch 是面向 React 的 local-first、development-only 反馈工作区。它把浏览器中点选的页面元素连接到精确 JSX/TSX 源码和受预算约束、经过清理的上下文，并支持打开编辑器、复制结构化 Prompt，或通过可选 AI Agent 准备可审阅补丁。

## 正式支持范围

| 项目         | 范围                           |
| ------------ | ------------------------------ |
| Node.js      | `>=20.19.0`                    |
| Vite         | `>=5.0.0 <8.0.0`               |
| React        | `18.2–18.3`                    |
| 默认源码     | `src/**/*.jsx`、`src/**/*.tsx` |
| 公开 Vite 包 | `@spotpatch/vite`              |

推荐 Vite 初始化：

```bash
npx --yes @spotpatch/vite@latest setup
```

npm 手动方式：

```bash
npm install --save-dev @spotpatch/vite@latest
npx spotpatch-vite init
```

Vite 插件顺序：

```ts
import { spotPatch } from "@spotpatch/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [spotPatch({ dataFlow: {} }), react()],
});
```

## Next.js 公共预览

`@spotpatch/next` 是 0.x Public Preview，不是正式支持集成。

| 项目              | 候选范围；不是支持保证 |
| ----------------- | ---------------------- |
| Node.js           | `>=20.19.0`            |
| Next.js           | `>=15.3.0 <17.0.0`     |
| React / React DOM | `^18.2.0` 或 `^19.0.0` |

pnpm 预览接入：

```bash
pnpm add --save-dev @spotpatch/next
pnpm exec spotpatch-next init
pnpm exec spotpatch-next check
pnpm dev
```

开发必须通过 `spotpatch-next dev`。Data Flow Beta 不属于 Next.js 预览。

## 页面工作流

1. 启动普通开发服务器。
2. 点击 **Select element / 选择元素**，或按 `Mod+Shift+S`。
3. 点选最多八个默认独立目标，并分别填写修改要求。
4. 核对源码坐标、组件栈、置信度和受限上下文。
5. 打开 Cursor/VS Code、复制结构化 Prompt，或使用可选 AI Agent。
6. AI 默认在隔离 Git worktree 中准备变更，由用户审阅检查和 Diff 后 Apply 或 Discard。

## Data Flow Beta

当前仅适用于 Vite + React 18。覆盖受支持的 direct/component-service `fetch`、Axios、React Query/TanStack Query callback 形态，以及实验性 tRPC 逻辑 procedure 路径。

可以展示：

- HTTP method/path；
- 参数键及其位置；
- 源码实际消费的响应字段；
- React state、Zustand、storage 与 callback 数据去向；
- 当前页面已派发但尚未归属的请求。

不会收集 query 值或读取/克隆响应体。证据不完整时必须保留 unknown、partial 或 unassigned，不通过时间或 URL 相似性猜测归属。

## AI 与凭据

- AI 默认关闭，只有完整 Provider 配置存在时才可用。
- API key 只应放在 Git 忽略的 `.env.local`，不得使用 `VITE_` 前缀。
- Review 是默认模式，使用隔离 worktree、受限工具、项目检查与完整 Diff。
- Trusted direct 需要显式配置与一次 session-scoped consent；它跳过宿主项目检查，不能保证类型检查、lint、测试或构建通过。
- 始终保留项目根目录边界、受保护路径、原子补丁验证、并发编辑检查与 Revert。
- SpotPatch 不 commit、push、publish 或 deploy 应用代码。

## 生产隔离

SpotPatch 仅用于开发期。Vite 正式集成的生产构建需要保持：

- 无 SpotPatch Runtime；
- 无 `data-spotpatch-source` 源码标记；
- 无本地协议或 API 端点；
- 无 Provider 凭据。

Next.js 0.x 预览仍需按其文档继续验证生产零残留；不要把候选 peer 范围当作生产支持承诺。

## 官方来源

- https://spotpatch.dev
- https://github.com/huanglvjing/spotpatch
- https://github.com/huanglvjing/spotpatch/blob/main/packages/vite/README.md
- https://github.com/huanglvjing/spotpatch/blob/main/packages/next/README.md
- https://www.npmjs.com/package/@spotpatch/vite
- https://www.npmjs.com/package/@spotpatch/next
