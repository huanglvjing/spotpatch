---
doc-id: "04-vite-plugin"
title: "Vite 插件实现"
status: "active"
version: "1.6.0"
last-updated: "2026-08-09"
source-range: "规格书 §2.4 第 1 条、§8、§8.1–§8.6；v1.1 Agent server 装配边界；v1.2 约定式环境解析生命周期；v1.3 编辑器适配器；v1.4 编辑器工作区路由；Next.js 公共编译内核迁移约束"
参考文献/依赖:
  - "02-architecture-stack"
  - "03-public-api-models"
  - "09-local-protocol-security"
  - "11-coding-standards"
  - "15-risks-adr"
  - "16-ai-agent-execution"
  - "17-model-provider-credentials"
  - "next-02-package-architecture"
  - "next-04-transform-source"
---

# Vite 插件实现

本文件是 source marker、Source Registry、AST transform 和 source map 行为的唯一事实来源，并遵守总体包依赖方向 (见 doc-id:02-architecture-stack)。公共配置由公共 API 文档定义 (见 doc-id:03-public-api-models)，文件读取与 HTTP 边界由安全规范定义 (见 doc-id:09-local-protocol-security)。

框架无关 transform 已迁移到 `@spotpatch/compiler`，Vite 与 Next 适配器共同消费该公共事实。本文件继续定义 Vite 专属生命周期与组合行为；marker 格式、过滤规则或 source map 语义不得在适配器内复制 (见 doc-id:next-02-package-architecture)、(见 doc-id:next-04-transform-source)。

## 插件拆分

公共函数返回多个职责单一的 Vite 插件：

```tsx
import type { Plugin } from "vite";

export function spotPatch(
  userOptions: SpotPatchOptions = {},
): Plugin[] {
  let options = resolveOptions(userOptions);
  const registry = createSourceRegistry();
  const session = createSession();
  const context = createPluginContext(() => options);

  if (!options.enabled) {
    return [];
  }

  return [
    createTransformPlugin({
      configure(config, environment) {
        options = resolveOptionsAfterEnvironment(
          userOptions,
          config,
          environment,
        );
      },
      context,
      registry,
    }),
    createRuntimeInjectionPlugin({ context, session }),
    createServerPlugin({ context, registry, session }),
  ];
}
```

上例只表达生命周期和依赖方向，不重复公共默认值或环境变量名。`config` hook 是唯一环境解析入口：它按 Vite `root`、`envDir` 和 `mode` 加载本地环境，应用“显式配置 > 约定式环境 > 关闭”的优先级，生成最终不可变选项与仅含所需 Key 的凭据映射。后续插件通过只读 context 取最终快照；不得持有初始 options 的过期副本、再次读取 env、修改全局 `process.env` 或把凭据放入 Runtime config。环境规则由 Provider 规范定义 (见 doc-id:17-model-provider-credentials)。

每个插件都设置 `apply: "serve"`。不能只依赖 `import.meta.env.DEV`，因为生产零残留必须在构建层就阻断。

`createServerPlugin` 只负责把经过解析的配置、所需凭据映射、registry、会话与项目 root 交给窄接口 handler。`options.ai === false` 时不得创建 Agent Engine、注册 Agent endpoint、解析 Key 或调用 Git；启用后的本地执行职责仍属于 Agent 模块 (见 doc-id:16-ai-agent-execution)，provider 连接职责属于模型提供商模块 (见 doc-id:17-model-provider-credentials)。AST transform、source marker 和 source map 链路不得因为 AI 开关产生行为差异。

## Transform 过滤

处理顺序：

1. 去掉 Vite id 的 query 部分，仅用于判断真实扩展名。
2. 必须是 `.jsx` 或 `.tsx`。
3. 必须匹配 include。
4. 必须不匹配 exclude。
5. 必须在项目 root 内。
6. 跳过 `node_modules`、虚拟模块、SpotPatch 自身模块。
7. 文件不包含 `<` 时可快速跳过，但不能把它作为正确性判断。

默认排除：

```tsx
const DEFAULT_EXCLUDE = [
  /node_modules/,
  /\.test\.[jt]sx$/,
  /\.spec\.[jt]sx$/,
  /\.stories\.[jt]sx$/,
  /(?:^|\/)dist(?:\/|$)/,
  /(?:^|\/)coverage(?:\/|$)/,
];
```

## Source marker 与 Source ID

source marker 属性名只在本文件定义：

```tsx
export const SOURCE_MARKER_ATTRIBUTE = "data-spotpatch-source" as const;
```

DOM 属性格式：

```html
data-spotpatch-source="Q7k3pA9vL2s:36:5"
```

- `Q7k3pA9vL2s`：本次 Vite 会话内的文件 ID（至少 64 bit 随机值的 base64url 表示）。
- `36`：1-based 行号。
- `5`：1-based 列号。

文件 ID 使用 `crypto.randomBytes()` 产生并存入双向 registry。不要把相对路径直接 base64，因为 base64 不是加密，也不要使用连续数字以免轻易枚举。

Registry 接口：

```tsx
export interface SourceRegistry {
  register(absolutePath: string): string;
  resolve(fileId: string): string | undefined;
  clear(): void;
}
```

同一规范化路径在一次会话内必须返回相同 ID，保证 HMR 后稳定。

浏览器端如何使用 `fileId`、服务端如何授权读取，由本地协议与安全规范约束 (见 doc-id:09-local-protocol-security)。

## AST 注入规则

只给 intrinsic host element 注入：

```tsx
<div />        // 注入
<button />     // 注入
<svg />        // 注入
<my-element /> // 注入，Web Component

<UserCard />   // 不注入
<motion.div /> // 不注入
<>...</>       // 不注入
```

判断规则：

- JSXIdentifier 首字符为小写，或名称包含 。
- JSXMemberExpression 不是 host element。
- JSXFragment 没有 DOM 节点。
- 已存在 `data-spotpatch-source` 时不覆盖，发出诊断警告。

> 原文在“名称包含”后没有给出字符。本次规范化拆分按原文保留，不在拆分过程中擅自改变判断规则；应通过后续勘误或 ADR 明确。

属性插入到 opening element 的最后、关闭符号之前：

```tsx
<button {...props} data-spotpatch-source="Q7k3pA9vL2s:36:5" />
```

放在 spread 之后可以避免业务 props 意外覆盖工具标记。

## Source map

MagicString 必须返回高精度 source map：

```tsx
return {
  code: magicString.toString(),
  map: magicString.generateMap({
    hires: true,
    includeContent: true,
    source: normalizedRelativePath,
  }),
};
```

不能返回 `map: null`，否则会破坏 Vite 后续 transform、错误 overlay 和调试器的位置链。

## 编辑器适配器

打开源码由 Vite Node 端的窄适配器完成。插件把解析后的公共 `editor` 偏好注入 Runtime 仅用于标签与反馈；浏览器请求仍只发送 source ID 和行列，不能覆盖服务端编辑器配置。适配器只执行固定映射 `vscode -> code`、`cursor -> cursor`，并为两者固定传入 `--goto <normalized-absolute-file>:<line>:<column>`；不得把任意字符串转为命令或参数，也不得启用 shell。

`auto` 依次检查启动当前 Vite 进程的受控集成环境信号：`TERM_PROGRAM`、`VSCODE_GIT_ASKPASS_NODE`、`VSCODE_GIT_ASKPASS_MAIN`、`GIT_ASKPASS`。出现 Cursor 路径时优先判定 Cursor，避免其通用 `TERM_PROGRAM=vscode` 被误判；其次识别 VS Code/Code Insiders。识别成功后执行上述固定 CLI；无法识别时才调用 `launch-editor` 后备探测。此顺序是编辑器探测的唯一事实来源。

Cursor/VS Code CLI 不附加 `--reuse-window`：该参数会把文件强制送入最后活跃窗口，在多个项目窗口同时打开时可能落入错误工作区。也不附加 `--new-window`；只提交绝对源码坐标，由编辑器按文件归属复用匹配工作区并打开文件标签。适配器等待短暂启动确认窗口；在窗口内收到命令不存在、非零退出或启动信号错误时拒绝请求并由协议层返回脱敏错误。只有未出现即时启动错误时才返回成功，且返回实际识别的受控编辑器偏好。完整请求、响应和错误边界 (见 doc-id:09-local-protocol-security)，公共枚举 (见 doc-id:03-public-api-models)。

## 错误策略

- AST 转换失败时 fail-open：记录警告并返回原代码。

AST 转换遵循 fail-open：

```tsx
try {
  return await injectSourceMarkers(input);
} catch (error: unknown) {
  diagnostics.warn(createTransformDiagnostic(input.id, error));
  return null;
}
```

禁止使用空 `catch`，禁止将 parser 异常变成业务页面无法启动的致命错误。debug 模式展示完整错误；普通模式每个文件只警告一次。

错误处理和模块边界同时遵守统一编码规范 (见 doc-id:11-coding-standards)。AST 与编辑器实现分别受 ADR-001/002 与 ADR-018 约束 (见 doc-id:15-risks-adr)。
