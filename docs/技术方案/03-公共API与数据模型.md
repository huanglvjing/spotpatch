---
doc-id: "03-public-api-models"
title: "公共 API 与数据模型"
status: "active"
version: "1.7.0"
last-updated: "2026-08-08"
source-range: "规格书 §6、§6.1、§7；v1.1 AI Provider、Agent 配置与 Job 模型；v1.2 有界多目标模型；v1.3 逐目标修改说明与界面语言；v1.4 约定式与简洁 AI 配置；v1.5 编辑器偏好与仓库标识；v1.6 实际编辑器响应；v1.7 本地工作区健康与纳入同意模型"
参考文献/依赖:
  - "04-vite-plugin"
  - "08-code-prompt"
  - "09-local-protocol-security"
  - "10-ui-diagnostics"
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

  /** 默认 auto；可显式固定 Cursor 或 VS Code。 */
  editor?: SpotPatchEditorPreference;

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

  /** 默认 auto；可显式固定为 en-US 或 zh-CN。 */
  locale?: SpotPatchLocalePreference;

  /** 同一次修改任务可选择的元素数；默认 8，最大值见 MAX_ANNOTATION_TARGETS。 */
  maxTargets?: number;

  /** 未提供时尝试约定式本地环境；false 显式关闭。 */
  ai?: false | SimpleAiOptions | AiOptions;
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
export type AiProviderAuthentication = "bearer" | "x-api-key";
export type AgentApplyMode = "review" | "auto" | "trusted-auto";
export type SpotPatchLocale = "en-US" | "zh-CN";
export type SpotPatchLocalePreference = "auto" | SpotPatchLocale;
export type SpotPatchEditorPreference = "auto" | "vscode" | "cursor";

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
  /** 默认 bearer；只允许固定认证类型，不接受任意 Header。 */
  readonly authentication?: AiProviderAuthentication;
  readonly baseURL: string;
  /** API Key 所在的服务端环境变量名，不是 Key 值。 */
  readonly apiKeyEnv: string;
  readonly models: Readonly<Record<string, AiModelProfile>>;
  readonly defaultModel: string;
}

export interface SimpleAiOptions {
  /** 必填；规则与完整 provider 的 baseURL 相同。 */
  readonly baseURL: string;
  /** 必填；provider 的真实模型名。 */
  readonly model: string;
  /** 默认 SPOTPATCH_AI_API_KEY；只保存变量名。 */
  readonly apiKeyEnv?: string;
  /** 默认 chat-completions。 */
  readonly protocol?: AiProviderProtocol;
  /** 默认 bearer。 */
  readonly authentication?: AiProviderAuthentication;
  /** 默认 AI provider。 */
  readonly providerLabel?: string;
  /** 默认 AI model；避免把真实模型名注入浏览器。 */
  readonly modelLabel?: string;
  /** 与完整配置共用执行默认值和校验。 */
  readonly execution?: AiExecutionOptions;
}

export interface AgentCheckDefinition {
  readonly label: string;
  readonly command: string;
  readonly args?: readonly string[];
  /** 默认 true；auto 与 trusted-auto 模式至少需要一个 required check。 */
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

export const MAX_ANNOTATION_TARGETS = 20;
export const MAX_TARGET_INSTRUCTION_CHARACTERS = 2_000;
export const MAX_ANNOTATION_INSTRUCTION_CHARACTERS = 4_000;
export const SPOTPATCH_LOCALES = Object.freeze(["en-US", "zh-CN"] as const);
export const SPOTPATCH_LOCALE_PREFERENCES = Object.freeze([
  "auto",
  ...SPOTPATCH_LOCALES,
] as const);
export const SPOTPATCH_EDITOR_PREFERENCES = Object.freeze([
  "auto",
  "vscode",
  "cursor",
] as const);
export const SPOTPATCH_REPOSITORY_URL =
  "https://github.com/huanglvjing/spotpatch" as const;

export const DEFAULT_OPTIONS = Object.freeze({
  enabled: true,
  editor: "auto",
  redact: true,
  shortcut: "Mod+Shift+S",
  allowLan: false,
  debug: false,
  locale: "auto",
  maxTargets: 8,
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

普通选项先做无环境解析；Vite `config` 阶段加载本地环境后完成一次最终解析，之后通过只读上下文向内部模块提供 `Readonly<ResolvedSpotPatchOptions>`，不得让各模块重复处理默认值。`maxTargets` 必须是从 1 到 `MAX_ANNOTATION_TARGETS` 的安全整数；Runtime 使用已解析值限制交互，协议使用硬上限限制不可信请求，服务端再次使用已解析值授权，三层都不得只依赖 UI。

`locale` 只接受 `auto | en-US | zh-CN`。`auto` 先读取宿主 `<html lang>`，没有可用值时读取 `navigator.languages`，最后回退 `en-US`；该设置只决定初始界面和 Prompt 语言，用户仍可在工作台内显式切换。Runtime 不依赖宿主项目的 i18n 库，也不读取宿主业务语言状态；显示和交互规则见 UI 规范 (见 doc-id:10-ui-diagnostics)。

`editor` 只接受 `auto | vscode | cursor`。`auto` 的解析顺序和 CLI 参数只由 Vite 插件实现定义 (见 doc-id:04-vite-plugin)；公共模型不维护第二份探测逻辑。浏览器不能传入编辑器名、命令或参数，服务端成功响应返回实际采用的受控偏好：识别成功时为 `vscode` 或 `cursor`，仅后备探测无法进一步判定时为 `auto`。官方仓库 URL 只由 `SPOTPATCH_REPOSITORY_URL` 定义，UI 不复制字面量；协议和外链行为分别见安全与 UI 规范 (见 doc-id:09-local-protocol-security)、(见 doc-id:10-ui-diagnostics)。

预算的裁剪行为由源码与 Prompt 规范定义 (见 doc-id:08-code-prompt)；`redact` 和 `allowLan` 的强制安全边界由本地协议与安全规范定义 (见 doc-id:09-local-protocol-security)。

AI 有三层入口，优先级为“显式 `ai: false` 或显式对象 > 约定式本地环境 > 关闭”。完整 `AiOptions` 服务多 Provider/多模型；`SimpleAiOptions` 固定生成 `default` provider/model profile；未传 `ai` 时，仅在 URL、模型和 Key 三个必要环境值完整存在时生成同一简洁配置。简洁配置默认 `chat-completions`、`bearer`、`SPOTPATCH_AI_API_KEY`、`review`、`git-worktree`、空 checks 和公共 limits；所有默认均允许由相应字段覆盖。不得猜测项目的包管理器或脚本，因而 `lint/build` 不属于跨项目默认 checks。

AI 配置解析必须满足：URL、模型和运行时 Key 均存在；provider 和 model profile ID 非空且唯一；`defaultProvider` 与每个 `defaultModel` 都引用已登记 ID；`apiKeyEnv` 是不以 `VITE_` 开头的大写环境变量名；`authentication` 只接受 `bearer | x-api-key`；`baseURL`、协议和凭据规则通过 provider 校验；check ID 只含安全标识字符，命令非空，超时和 limits 为有限正整数。`applyMode: "auto" | "trusted-auto"` 至少配置一个 required check。`trusted-auto` 还要求每次创建 Job 都携带当前浏览器会话的显式可信快速模式同意；缺少必要值或存在部分约定式配置时，开发服务器启动失败并只报告缺少的变量名，不回显值，也不得静默降级为似乎可运行的 AI。执行语义见 Agent 规范 (见 doc-id:16-ai-agent-execution)，环境变量名、provider 与凭据语义见模型提供商规范 (见 doc-id:17-model-provider-credentials)。

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

### AI 简洁接入示例

```tsx
spotPatch({
  ai: {
    baseURL: "https://relay.example.com/v1",
    model: "provider-model-name",
  },
});
```

此时 Key 使用默认环境变量；中转站要求 `x-api-key` 时只增加 `authentication: "x-api-key"`。若 URL、模型和 Key 全部使用约定式本地环境，则 Vite 配置仍为 `spotPatch()`。环境变量的唯一名称和读取边界见模型提供商规范 (见 doc-id:17-model-provider-credentials)。

### AI 高级接入示例

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

export interface SpotTargetContext {
  /** 只属于当前目标的修改要求；trim 后非空。 */
  readonly instruction: string;
  readonly source: SourceRef;
  readonly react: ReactContext;
  readonly element: ElementContext;
  readonly styles: StyleContext;
  readonly code?: CodeContext;
  readonly warnings: readonly string[];
}

export interface SpotAnnotation {
  readonly schemaVersion: 3;
  readonly id: string;
  readonly locale: SpotPatchLocale;
  readonly page: Readonly<{
    url: string;
    pathname: string;
    title: string;
    viewportWidth: number;
    viewportHeight: number;
    devicePixelRatio: number;
  }>;
  readonly targets: readonly SpotTargetContext[];
  readonly createdAt: string;
}
```

原则：数据对象创建后不可变；`targets` 至少一个、保持用户选择顺序且不超过已解析限制；页面环境和最终界面语言只在 `SpotAnnotation` 顶层保存一次，每个目标独占自己的 `instruction`、来源、React、DOM、CSS、源码和警告。不存在全局 `note` 或共享修改要求，避免多个组件的不同要求在传输或 Agent 执行时被合并。单个 `instruction` trim 后必须为 1–`MAX_TARGET_INSTRUCTION_CHARACTERS` 字符，整组 trim 后字符总数不得超过 `MAX_ANNOTATION_INSTRUCTION_CHARACTERS`；Runtime、工厂和协议 Schema 使用同一组公共常量且均不得静默截断。采集阶段返回新对象，不共享可变 DOM 引用，不把 Fiber、Element、CSSStyleDeclaration 放入最终模型。

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

### 本地工作区健康模型

```ts
export type AgentWorkingTreeMode = "require-clean" | "include-local-changes";

export type AgentWorkspaceState = "ready" | "consent-required" | "blocked";

export const AGENT_WORKSPACE_SNAPSHOT_LIMITS = Object.freeze({
  maxUntrackedFiles: 1_000,
  maxUntrackedBytes: 20 * 1024 * 1024,
});

export interface AgentWorkspaceChangeSummary {
  readonly staged: number;
  readonly unstaged: number;
  readonly untracked: number;
  readonly conflicted: number;
  /** 去重后的本地变更文件数；同一文件同时 staged/unstaged 只计一次。 */
  readonly total: number;
}

export interface AgentWorkspaceHealthSnapshot {
  readonly state: AgentWorkspaceState;
  readonly checkedAt: string;
  readonly changes: AgentWorkspaceChangeSummary;
  readonly canIncludeLocalChanges: boolean;
  readonly errorCode?: ErrorCode;
}
```

`require-clean` 是协议默认值和兼容旧客户端的安全回退；只有 Runtime 已取得 `consent-required` 健康快照并获得用户显式同意时，Job 请求才能发送 `include-local-changes`。`blocked` 不能被同意按钮覆盖。未跟踪快照只接受最多 1,000 个普通非符号链接文件且合计不超过 20 MiB；该固定安全上限由 `AGENT_WORKSPACE_SNAPSHOT_LIMITS` 唯一定义，不是用户可放宽配置。具体基线、Apply/Revert 语义由 Agent 执行规范唯一规定 (见 doc-id:16-ai-agent-execution)，endpoint 与稳定错误码由本地协议规定 (见 doc-id:09-local-protocol-security)。

Job 的状态转换、工具循环和变更语义只由 Agent 执行规范定义 (见 doc-id:16-ai-agent-execution)；HTTP event 包络与稳定错误码只由本地协议定义 (见 doc-id:09-local-protocol-security)。
