---
doc-id: "03-public-api-models"
title: "公共 API 与数据模型"
status: "active"
version: "1.1.0"
last-updated: "2026-08-07"
source-range: "规格书 §6、§6.1、§7；v1.1 AI Provider、Agent 配置与 Job 模型"
参考文献/依赖:
  - "04-vite-plugin"
  - "08-code-prompt"
  - "09-local-protocol-security"
  - "16-ai-agent-execution"
  - "17-model-provider-credentials"
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

  /** 默认 false；显式配置后才注册 AI Agent 能力。 */
  ai?: false | AiOptions;
}

export interface ContextBudget {
  totalCharacters: number;
  domCharacters: number;
  cssCharacters: number;
  codeCharacters: number;
  maxCodeLines: number;
  maxComponentDepth: number;
}

export type AiProviderProtocol = "responses" | "chat-completions";
export type AgentApplyMode = "review" | "auto";

export interface AiModelProfile {
  /** UI 中展示的非敏感名称。 */
  readonly label: string;
  /** 只在 Vite Node 端使用的 provider 模型名。 */
  readonly model: string;
}

export interface OpenAICompatibleProviderOptions {
  readonly type: "openai-compatible";
  /** UI 中展示的非敏感 provider 名称。 */
  readonly label: string;
  readonly protocol: AiProviderProtocol;
  readonly baseURL: string;
  /** API Key 所在的服务端环境变量名，不是 Key 值。 */
  readonly apiKeyEnv: string;
  readonly models: Readonly<Record<string, AiModelProfile>>;
  readonly defaultModel: string;
}

export interface AgentCheckDefinition {
  readonly label: string;
  readonly command: string;
  readonly args?: readonly string[];
  /** 默认 true；auto 模式至少需要一个 required check。 */
  readonly required?: boolean;
  /** 默认 DEFAULT_AGENT_LIMITS.checkTimeoutMs。 */
  readonly timeoutMs?: number;
}

export interface AgentLimits {
  readonly maxTurns: number;
  readonly maxToolCalls: number;
  readonly maxChangedFiles: number;
  readonly maxDiffBytes: number;
  readonly maxReadBytesPerFile: number;
  readonly maxToolOutputCharacters: number;
  readonly maxProviderResponseBytes: number;
  readonly providerConnectTimeoutMs: number;
  readonly providerFirstByteTimeoutMs: number;
  readonly providerIdleTimeoutMs: number;
  readonly checkTimeoutMs: number;
  readonly jobTimeoutMs: number;
}

export interface AiExecutionOptions {
  /** v1.1 唯一支持值。 */
  readonly isolation?: "git-worktree";
  /** 默认 review。 */
  readonly applyMode?: AgentApplyMode;
  readonly checks?: Readonly<Record<string, AgentCheckDefinition>>;
  readonly limits?: Partial<AgentLimits>;
}

export interface AiOptions {
  readonly providers: Readonly<
    Record<string, OpenAICompatibleProviderOptions>
  >;
  readonly defaultProvider: string;
  readonly execution?: AiExecutionOptions;
}
```

默认值集中在一个不可变对象中：

```tsx
export const DEFAULT_AGENT_LIMITS = Object.freeze({
  maxTurns: 20,
  maxToolCalls: 80,
  maxChangedFiles: 20,
  maxDiffBytes: 512_000,
  maxReadBytesPerFile: 256_000,
  maxToolOutputCharacters: 40_000,
  maxProviderResponseBytes: 2_000_000,
  providerConnectTimeoutMs: 15_000,
  providerFirstByteTimeoutMs: 30_000,
  providerIdleTimeoutMs: 60_000,
  checkTimeoutMs: 120_000,
  jobTimeoutMs: 600_000,
} satisfies AgentLimits);

export const DEFAULT_OPTIONS = Object.freeze({
  enabled: true,
  editor: "vscode",
  redact: true,
  shortcut: "Mod+Shift+S",
  allowLan: false,
  debug: false,
  ai: false,
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

AI 配置解析必须满足：provider 和 model profile ID 非空且唯一；`defaultProvider` 与每个 `defaultModel` 都引用已登记 ID；`apiKeyEnv` 是不以 `VITE_` 开头的大写环境变量名；`baseURL`、协议和凭据规则通过 provider 校验；check ID 只含安全标识字符，命令非空，超时和 limits 为有限正整数。`applyMode: "auto"` 至少配置一个 required check。任何失败都使 AI 整体禁用，不得回退到宽松默认值。执行语义见 Agent 规范 (见 doc-id:16-ai-agent-execution)，provider 与凭据语义见模型提供商规范 (见 doc-id:17-model-provider-credentials)。

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

### AI 接入示例

```tsx
spotPatch({
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
        lint: {
          label: "Lint",
          command: "pnpm",
          args: ["lint"],
        },
        build: {
          label: "Build",
          command: "pnpm",
          args: ["build"],
        },
      },
    },
  },
});
```

真实 Key 只能由启动 Vite 的 Node 环境提供；不得写入此配置、`VITE_*` 变量或仓库文件。浏览器模型选择器只提交上例中的 `relay`、`coding` 两个稳定 ID，不提交真实 URL、环境变量名或 provider 模型名。

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

## Agent Job 公共模型

以下枚举和结构是 Runtime、Vite server 与 Agent Engine 的唯一共享声明：

```tsx
export type AgentJobStatus =
  | "queued"
  | "preparing"
  | "running"
  | "validating"
  | "awaiting-review"
  | "applying"
  | "applied"
  | "completed"
  | "cancelling"
  | "cancelled"
  | "reverting"
  | "reverted"
  | "failed";

export type AgentCapabilityState =
  | "unknown"
  | "probing"
  | "agent-ready"
  | "prompt-only"
  | "unavailable";

export interface AgentCapabilitySnapshot {
  readonly providerProfileId: string;
  readonly providerLabel: string;
  readonly modelProfileId: string;
  readonly modelLabel: string;
  readonly protocol: AiProviderProtocol;
  readonly state: AgentCapabilityState;
  readonly authenticated: boolean;
  readonly modelAvailable: boolean;
  readonly toolCalling: boolean;
  readonly toolResultContinuation: boolean;
  readonly streaming: boolean;
  readonly checkedAt?: string;
  readonly errorCode?: ErrorCode;
}

export type AgentFileChangeKind = "added" | "modified" | "deleted";

export interface AgentChangedFile {
  readonly relativePath: string;
  readonly kind: AgentFileChangeKind;
  readonly additions: number;
  readonly deletions: number;
}

export interface AgentCheckResult {
  readonly checkId: string;
  readonly label: string;
  readonly status: "passed" | "failed" | "cancelled" | "timed-out";
  readonly durationMs: number;
  readonly output: string;
}

export interface AgentJobSnapshot {
  readonly jobId: string;
  readonly status: AgentJobStatus;
  readonly providerProfileId: string;
  readonly providerLabel: string;
  readonly modelProfileId: string;
  readonly modelLabel: string;
  readonly phaseMessage: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly canCancel: boolean;
  readonly canApply: boolean;
  readonly canRevert: boolean;
  readonly errorCode?: ErrorCode;
}

export interface AgentJobResult {
  readonly jobId: string;
  readonly summary: string;
  readonly diff: string;
  readonly files: readonly AgentChangedFile[];
  readonly checks: readonly AgentCheckResult[];
}
```

Job 的状态转换、工具循环和变更语义只由 Agent 执行规范定义 (见 doc-id:16-ai-agent-execution)；HTTP event 包络与稳定错误码只由本地协议定义 (见 doc-id:09-local-protocol-security)。
