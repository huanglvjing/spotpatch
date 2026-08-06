---
doc-id: "04-vite-plugin"
title: "Vite 插件实现"
status: "active"
version: "1.0.0"
last-updated: "2026-08-06"
source-range: "规格书 §2.4 第 1 条、§8、§8.1–§8.6"
参考文献/依赖:
  - "02-architecture-stack"
  - "03-public-api-models"
  - "09-local-protocol-security"
  - "11-coding-standards"
  - "15-risks-adr"
---

# Vite 插件实现

本文件是 source marker、Source Registry、AST transform 和 source map 行为的唯一事实来源，并遵守总体包依赖方向 (见 doc-id:02-architecture-stack)。公共配置由公共 API 文档定义 (见 doc-id:03-public-api-models)，文件读取与 HTTP 边界由安全规范定义 (见 doc-id:09-local-protocol-security)。

## 插件拆分

公共函数返回多个职责单一的 Vite 插件：

```tsx
import type { Plugin } from "vite";

export function spotPatch(
  userOptions: SpotPatchOptions = {},
): Plugin[] {
  const options = resolveOptions(userOptions);
  const registry = createSourceRegistry();
  const session = createSession();

  if (!options.enabled) {
    return [];
  }

  return [
    createTransformPlugin({ options, registry }),
    createRuntimeInjectionPlugin({ options, session }),
    createServerPlugin({ options, registry, session }),
  ];
}
```

每个插件都设置 `apply: "serve"`。不能只依赖 `import.meta.env.DEV`，因为生产零残留必须在构建层就阻断。

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

错误处理和模块边界同时遵守统一编码规范 (见 doc-id:11-coding-standards)。本实现受 ADR-001 与 ADR-002 约束 (见 doc-id:15-risks-adr)。
