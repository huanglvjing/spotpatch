---
name: spotpatch
description: 为 React 项目建立从浏览器页面元素到精确 JSX/TSX 源码、结构化上下文与可审阅修改的 SpotPatch 工作流。用户提到 SpotPatch、截图沟通前端修改、页面元素定位源码、Vite 或 Next.js 接入、组件数据链路、结构化 Prompt、AI 补丁审阅、安装检查或故障排查时使用此技能。
license: MIT
metadata:
  author: huanglvjing
  version: 1.0.0
  homepage: https://spotpatch.dev
  repository: https://github.com/huanglvjing/spotpatch
  compatibility: Node.js 20.19+；正式支持 Vite 5–7 与 React 18.2–18.3
---

# SpotPatch

把 React 页面中被点选的元素连接到精确源码和受边界约束的开发上下文。先判断用户需要的是了解产品、接入项目、使用工作流还是排查问题，再执行对应流程。

## 工作原则

1. 只根据实际项目和官方文档作结论，不把 peer dependency 范围写成已经验证的支持矩阵。
2. 用户只要求解释、评估或排查时，仅检查并报告，不安装依赖、不改文件。
3. 用户要求接入时，先识别框架、React 版本、Node.js 版本、包管理器、配置文件和现有工作区变更。
4. 修改前保留用户已有改动；修改后展示变更并执行项目中已有的相关检查。
5. SpotPatch 只用于开发环境。不要把 Runtime、源码标记、本地协议端点或凭据引入生产路径。
6. AI 修改默认使用 Review。不要自动 commit、push、发布或部署用户项目。

需要精确兼容范围、安全边界、命令和能力限制时，读取 `references/product-reference.md`。

## 触发示例

- “帮我把 SpotPatch 接入这个 Vite + React 项目。”
- “我点选了页面上的按钮，怎么跳到它对应的 TSX？”
- “用 SpotPatch 整理这个 UI 修改需求，但先不要让 AI 改代码。”
- “检查 SpotPatch 为什么没有显示 Select element。”
- “我想看这个组件真正消费了哪些接口字段。”
- “在 Next.js 项目里试用 SpotPatch，并告诉我预览版有哪些限制。”

## 选择流程

### 用户想了解 SpotPatch

- 用一句话说明：SpotPatch 让开发者直接点选 React 页面元素，定位对应 JSX/TSX，并把可信上下文交给编辑器、任意编码助手或可选的审阅式 AI Agent。
- 强调无需 AI 也能使用源码定位、上下文检查和结构化 Prompt。
- 提供官网、GitHub 与 npm 链接；避免空泛的“万能”“完全自动”等宣传词。

### 用户想在 Vite + React 中接入

1. 读取 `package.json`、锁文件和 `vite.config.*`，确认：
   - Node.js `>=20.19.0`；
   - Vite `>=5 <8`；
   - React 18.2–18.3；
   - 项目使用 npm 或 pnpm。
2. 如果不满足正式支持范围，说明具体差异并停止宣称“正式支持”；只有用户明确接受实验性验证后才继续。
3. 在项目根目录执行推荐初始化：

   ```bash
   npx --yes @spotpatch/vite@latest setup
   ```

4. 检查生成结果。`spotPatch(...)` 必须位于 React 插件之前；有歧义的动态 Vite 配置应让初始化器安全失败，再人工审阅接入。
5. 使用项目原有开发命令启动页面。点击右下角 **Select element / 选择元素**，或按 `Mod+Shift+S`。
6. 展示依赖与配置 Diff，并运行可发现的类型检查或构建检查。不要替用户提交代码。

如果用户要求手动接入 npm 项目，可使用：

```bash
npm install --save-dev @spotpatch/vite@latest
npx spotpatch-vite init
```

### 用户想在 Next.js 中接入

先明确告知：`@spotpatch/next` 是 0.x Public Preview，不在正式支持矩阵内；组件 Data Flow Beta 也不支持 Next.js。只有用户接受预览风险后继续。

1. 检查 Node.js `>=20.19.0`，并把 Next.js `>=15.3 <17`、React 18/19 仅解释为候选 peer 范围。
2. 优先遵循仓库当前的 Next.js 预览文档；pnpm 项目使用：

   ```bash
   pnpm add --save-dev @spotpatch/next
   pnpm exec spotpatch-next init
   pnpm exec spotpatch-next check
   pnpm dev
   ```

3. 确认开发脚本通过 `spotpatch-next dev` 启动，并检查 `next.config.*` 与 `instrumentation-client.*` 的生成结果。
4. 遇到复杂 CommonJS 配置、混合 root/`src` Router、冲突 Loader 或 rewrite 时安全停止，说明需要人工接入。

### 用户已经安装，想完成一次页面修改

1. 启动项目原有开发服务器，不替换宿主应用的启动方式；Next.js 预览必须使用初始化后生成的脚本。
2. 让用户点选一个或多个目标，并为每个目标写独立、可验证的修改要求。
3. 在 SpotPatch 中核对组件名、文件路径、行列、React 栈和置信度；上下文不足或有歧义时先补证据。
4. 根据用户意图选择：
   - 在 Cursor 或 VS Code 打开精确源码；
   - 预览并复制结构化 Prompt；
   - 使用已明确配置的 AI Provider 在隔离 Git worktree 中准备修改。
5. AI 路径默认选择 **Review**：查看项目检查、完整 Diff，再 Apply 或 Discard。
6. 只有用户明确理解风险并主动选择时才使用 **Trusted direct**。该模式跳过宿主项目检查，不保证类型检查、lint、测试或构建通过。

### 用户想看组件数据链路

- 仅在 Vite + React 18 的开发环境使用 Data Flow Beta。
- 只报告有稳定组件、源码、调用点和调用实例证据的关系。
- 可以展示 HTTP 方法与路径、参数键位置、源码实际消费的响应字段，以及 React state、Zustand、storage 或 callback 去向。
- 不读取或复制响应体，不保留 query 值；模糊流量标记为 partial、unknown 或 unassigned。
- 不把时间或 URL 相似性当作组件归属证明，也不要声称 Next.js 已支持该功能。

## 故障排查

按以下顺序检查，避免直接重装：

1. Node、React、Vite/Next.js 是否在相应范围内。
2. 包管理器与锁文件是否一致，依赖树是否安装了同一套 SpotPatch 版本。
3. Vite 中 SpotPatch 是否位于 React 插件之前；Next.js 是否通过 `spotpatch-next dev` 启动。
4. 页面是否处于开发模式，是否出现唯一的 `spotpatch-root`。
5. 源文件是否位于默认 `src/**/*.jsx` 或 `src/**/*.tsx` 范围，或被自定义 include/exclude 排除。
6. 编辑器无法打开时，明确配置 `editor: "cursor"` 或 `editor: "vscode"`。
7. LAN 访问、动态配置、rewrite/Loader 冲突等边界必须按文档安全失败，不要绕过认证或生产隔离。

报告问题时给出最小复现信息：框架与版本、React 与 Node 版本、包管理器、配置片段、启动命令、可复现步骤和完整错误文本；发送前移除密钥、Cookie、Token、响应体及业务隐私数据。

## 完成标准

- 项目范围与支持状态表述准确。
- 变更可见、可审阅，且未覆盖用户已有工作。
- 开发流程可以启动并完成元素选择或诊断。
- 生产路径没有被启用 SpotPatch。
- 未泄露凭据，未自动 commit、push、发布或部署。
- 最终回复附上下一步操作和必要链接。

## 官方链接

- 官网：https://spotpatch.dev
- GitHub：https://github.com/huanglvjing/spotpatch
- Vite npm：https://www.npmjs.com/package/@spotpatch/vite
- Next.js 预览 npm：https://www.npmjs.com/package/@spotpatch/next
