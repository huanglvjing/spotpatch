---
doc-id: "03-public-api-models"
title: "公共 API 与数据模型"
status: "active"
version: "1.0.0"
last-updated: "2026-08-06"
source-range: "规格书 §6、§6.1、§7"
参考文献/依赖:
  - "04-vite-plugin"
  - "08-code-prompt"
  - "09-local-protocol-security"
---

# 公共 API 与数据模型

本文件是公共配置、默认值和核心数据模型的唯一事实来源。内部模块不得重复定义这些类型、默认值或枚举字符串。

## 公共配置 API

```tsx
export interface SpotPatchOptions {
  /** 默认 true；仍会被 command === "serve" 强制约束。 */
  enabled?: boolean;

  /** 默认包含 src 下的 jsx/tsx。 */
  include?: Array<string | RegExp>;

  /** 默认排除 node_modules、测试、故事文件和生成文件。 */
  exclude?: Array<string | RegExp>;

  /** v1 仅正式支持 vscode。 */
  editor?: "vscode";

  /** 默认 true。关闭时仍强制清洗密码。 */
  redact?: boolean;

  /** Prompt 和各采集段的字符预算。 */
  budget?: Partial<ContextBudget>;

  /** 默认 Mod+Shift+S。 */
  shortcut?: string;

  /** 默认 false。开启后允许通过局域网 origin 使用。 */
  allowLan?: boolean;

  /** 开发期诊断日志。 */
  debug?: boolean;
}

export interface ContextBudget {
  totalCharacters: number;
  domCharacters: number;
  cssCharacters: number;
  codeCharacters: number;
  maxCodeLines: number;
  maxComponentDepth: number;
}
```

默认值集中在一个不可变对象中：

```tsx
export const DEFAULT_OPTIONS = Object.freeze({
  enabled: true,
  editor: "vscode",
  redact: true,
  shortcut: "Mod+Shift+S",
  allowLan: false,
  debug: false,
  budget: {
    totalCharacters: 16_000,
    domCharacters: 3_000,
    cssCharacters: 4_000,
    codeCharacters: 7_000,
    maxCodeLines: 80,
    maxComponentDepth: 8,
  },
} satisfies Required<SpotPatchOptions>);
```

配置解析只执行一次，之后向内部模块传递 `Readonly<ResolvedSpotPatchOptions>`，不得让各模块重复处理默认值。

预算的裁剪行为由源码与 Prompt 规范定义 (见 doc-id:08-code-prompt)；`redact` 和 `allowLan` 的强制安全边界由本地协议与安全规范定义 (见 doc-id:09-local-protocol-security)。

### 用户接入方式

```tsx
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";
import { spotPatch } from "@spotpatch/vite";

export default defineConfig({
  plugins: [
    spotPatch(),
    react(),
  ],
});
```

SpotPatch 必须位于 React SWC 插件之前，并设置 `enforce: "pre"`，确保拿到未经 JSX 降级的 TSX/JSX。

插件实现细节见 Vite 插件规范 (见 doc-id:04-vite-plugin)。

## 核心数据模型

```tsx
export type SourceConfidence =
  | "exact"
  | "probable"
  | "approximate"
  | "unknown";

export type SourceOrigin =
  | "jsx-host"
  | "react-fiber"
  | "dom-ancestor"
  | "none";

export interface SourceRef {
  readonly fileId?: string;
  readonly relativePath?: string;
  readonly line?: number;
  readonly column?: number;
  readonly origin: SourceOrigin;
  readonly confidence: SourceConfidence;
}

export interface ReactContext {
  readonly supported: boolean;
  readonly version?: string;
  readonly componentName?: string;
  readonly componentStack: readonly string[];
  readonly source?: SourceRef;
}

export interface ElementContext {
  readonly tagName: string;
  readonly selector: string;
  readonly sanitizedHtml: string;
  readonly textPreview?: string;
  readonly role?: string;
  readonly rect: Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}

export interface MatchedStyleRule {
  readonly selector: string;
  readonly declarations: string;
  readonly source?: string;
  readonly media?: string;
}

export interface StyleContext {
  readonly classNames: readonly string[];
  readonly inlineStyle?: string;
  readonly matchedRules: readonly MatchedStyleRule[];
  readonly computed: Readonly<Record<string, string>>;
  readonly warnings: readonly string[];
}

export interface CodeContext {
  readonly relativePath: string;
  readonly language: "tsx" | "jsx";
  readonly startLine: number;
  readonly endLine: number;
  readonly excerpt: string;
  readonly boundary: "component" | "nearby-lines";
}

export interface SpotAnnotation {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly note: string;
  readonly page: Readonly<{
    url: string;
    pathname: string;
    title: string;
    viewportWidth: number;
    viewportHeight: number;
    devicePixelRatio: number;
  }>;
  readonly source: SourceRef;
  readonly react: ReactContext;
  readonly element: ElementContext;
  readonly styles: StyleContext;
  readonly code?: CodeContext;
  readonly warnings: readonly string[];
  readonly createdAt: string;
}
```

原则：数据对象创建后不可变；采集阶段返回新对象，不共享可变 DOM 引用，不把 Fiber、Element、CSSStyleDeclaration 放入最终模型。
