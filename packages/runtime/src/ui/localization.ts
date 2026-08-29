import {
  ERROR_CODES,
  type AgentJobStatus,
  type ErrorCode,
  type SpotPatchLocale,
  type SpotPatchLocalePreference,
} from "@spotpatch/shared";

import type { SelectionSummaryMessages } from "./selection-summary.js";
import type { ExecutionActivityKind } from "./execution-island.js";

export interface UiMessages {
  readonly localeName: string;
  readonly alternateLocaleName: string;
  readonly switchLocale: string;
  readonly brand: Readonly<{
    name: string;
    context: string;
    repository: string;
    repositoryTitle: string;
  }>;
  readonly trigger: Readonly<{
    select: string;
    stop: string;
    title: (shortcut: string) => string;
  }>;
  readonly dialog: Readonly<{
    close: string;
    editTitle: string;
    editSubtitle: string;
    previewTitle: string;
    previewSubtitle: string;
  }>;
  readonly floatingSurface: Readonly<{
    dragHandle: string;
    resetPosition: string;
    positionReset: string;
  }>;
  readonly context: Readonly<{
    collecting: string;
    ready: string;
    partial: string;
    sourceUnavailable: string;
    selectedElement: string;
    selectedCount: (count: number) => string;
  }>;
  readonly targets: Readonly<{
    title: string;
    ariaLabel: string;
    count: (selected: number, maximum: number) => string;
    complete: (complete: number, total: number) => string;
    instructionBudget: (used: number, maximum: number) => string;
    instructionBudgetExceeded: (used: number, maximum: number) => string;
    statusReady: string;
    statusPartial: string;
    statusCollecting: string;
    instructionReady: string;
    instructionMissing: string;
    instructionLabel: (name: string) => string;
    instructionPlaceholder: string;
    instructionCount: (used: number, maximum: number) => string;
    activate: (index: number) => string;
    remove: (index: number) => string;
    removeTitle: string;
    addTitle: string;
    limitTitle: (maximum: number) => string;
  }>;
  readonly diagnostics: Readonly<{
    title: string;
    resolving: string;
    noExactSource: string;
    promptAriaLabel: string;
  }>;
  readonly summary: SelectionSummaryMessages;
  readonly actions: Readonly<{
    addElement: string;
    reselect: string;
    openEditor: string;
    openTarget: (index: number) => string;
    preview: string;
    copy: string;
    back: string;
  }>;
  readonly agent: Readonly<{
    title: string;
    mode: string;
    review: string;
    autoGated: string;
    trustedFast: string;
    provider: string;
    model: string;
    providerAriaLabel: string;
    modelAriaLabel: string;
    providerUnavailable: string;
    consent: (provider: string) => string;
    trustedFastConsent: (provider: string) => string;
    connectionNotTested: string;
    workspaceNotChecked: string;
    checkingWorkspace: string;
    workspaceReady: string;
    workspaceDirty: (staged: number, unstaged: number, untracked: number) => string;
    includeLocalChanges: string;
    includeLocalChangesHelp: string;
    localChangesConsentRequired: string;
    capabilityVerified: string;
    capabilityVerifiedAnnouncement: string;
    testingCapability: string;
    applying: string;
    cancelling: string;
    reverting: string;
    consentRequired: string;
    toolsReady: string;
    testConnection: string;
    verifying: string;
    run: string;
    cancel: string;
    discard: string;
    apply: string;
    revert: string;
    revise: string;
    diffAriaLabel: string;
    noOutput: string;
    status: (status: AgentJobStatus) => string;
  }>;
  readonly execution: Readonly<{
    claude: string;
    codex: string;
    receivingTitle: (identity: string) => string;
    runningTitle: (identity: string) => string;
    completedTitle: (identity: string) => string;
    failedTitle: (identity: string) => string;
    resultReturned: string;
    runningStatus: string;
    activityAction: (kind: ExecutionActivityKind, detail?: string) => string;
    activityLane: (kind: ExecutionActivityKind, detail?: string) => string;
  }>;
  readonly announcements: Readonly<{
    adapterDisabled: string;
    selectionEnabled: string;
    chooseAnother: string;
    reselectAfterChange: string;
    sourceLoaded: string;
    sourceFailed: string;
    addCancelled: string;
    selectionLimit: (maximum: number) => string;
    chooseAdditional: (selected: number, maximum: number) => string;
    duplicate: string;
    sourceProbable: string;
    sourceMissing: string;
    noSelectable: string;
    allTargetsRemoved: string;
    targetRemoved: string;
    detachedTargetPreserved: string;
    contextWarning: string;
    contextCollected: string;
    editorOpening: string;
    editorOpened: string;
    editorFailed: string;
    completeInstructions: string;
    promptCopied: string;
    clipboardUnavailable: string;
    copyFailed: string;
    appliedTargetsDetached: string;
  }>;
  readonly errors: Readonly<Record<ErrorCode, string>>;
}

const STATUS_EN: Readonly<Record<AgentJobStatus, string>> = Object.freeze({
  queued: "Queued",
  preparing: "Preparing",
  running: "Running",
  validating: "Validating",
  "awaiting-review": "Awaiting review",
  applying: "Applying",
  applied: "Applied",
  completed: "Completed",
  cancelling: "Cancelling",
  cancelled: "Cancelled",
  reverting: "Reverting",
  reverted: "Reverted",
  failed: "Failed",
});

const STATUS_ZH: Readonly<Record<AgentJobStatus, string>> = Object.freeze({
  queued: "已排队",
  preparing: "准备中",
  running: "执行中",
  validating: "验证中",
  "awaiting-review": "等待审阅",
  applying: "应用中",
  applied: "已应用",
  completed: "已完成",
  cancelling: "取消中",
  cancelled: "已取消",
  reverting: "撤销中",
  reverted: "已撤销",
  failed: "失败",
});

const EXECUTION_ACTIVITY_EN: Readonly<Record<ExecutionActivityKind, string>> =
  Object.freeze({
    prepare: "Preparing context",
    dispatch: "Dispatching context",
    discover: "Discovering project files",
    search: "Searching source",
    read: "Reading",
    patch: "Generating a minimal patch",
    check: "Running",
    audit: "Auditing proposed changes",
    apply: "Applying verified changes",
    sync: "Returning results to SpotPatch",
    unknown: "Processing the current task",
  });

const EXECUTION_ACTIVITY_ZH: Readonly<Record<ExecutionActivityKind, string>> =
  Object.freeze({
    prepare: "正在准备上下文",
    dispatch: "正在派发上下文",
    discover: "正在查找项目文件",
    search: "正在搜索源码",
    read: "正在读取",
    patch: "正在生成最小修改补丁",
    check: "正在运行",
    audit: "正在审计候选修改",
    apply: "正在应用已验证修改",
    sync: "正在将结果回流 SpotPatch",
    unknown: "正在处理当前任务",
  });

const EXECUTION_LANE_LABELS: Readonly<Record<ExecutionActivityKind, string>> =
  Object.freeze({
    prepare: "prepare",
    dispatch: "dispatch",
    discover: "list",
    search: "search",
    read: "read",
    patch: "patch",
    check: "check",
    audit: "audit",
    apply: "apply",
    sync: "sync",
    unknown: "agent",
  });

function executionActivityAction(
  labels: Readonly<Record<ExecutionActivityKind, string>>,
  kind: ExecutionActivityKind,
  detail?: string,
): string {
  return detail === undefined || detail.length === 0
    ? labels[kind]
    : `${labels[kind]} ${detail}`;
}

function executionActivityLane(kind: ExecutionActivityKind, detail?: string): string {
  return detail === undefined || detail.length === 0
    ? EXECUTION_LANE_LABELS[kind]
    : `${EXECUTION_LANE_LABELS[kind]} · ${detail}`;
}

const EXTERNAL_HANDOFF_ERROR_EN = "The external Agent handoff request failed.";
const EXTERNAL_HANDOFF_ERROR_ZH = "外部 Agent 交接请求失败。";

const ERROR_MESSAGES_EN = Object.freeze({
  [ERROR_CODES.INVALID_REQUEST]: "The Agent request was rejected as invalid.",
  [ERROR_CODES.INVALID_TOKEN]: "The local SpotPatch session expired.",
  [ERROR_CODES.ORIGIN_NOT_ALLOWED]: "The current page origin is not authorized.",
  [ERROR_CODES.SOURCE_NOT_FOUND]: "The selected source is no longer available.",
  [ERROR_CODES.SOURCE_OUTSIDE_ROOT]: "The selected source is outside the project.",
  [ERROR_CODES.SOURCE_TOO_LARGE]: "The selected source exceeds the safety limit.",
  [ERROR_CODES.EDITOR_OPEN_FAILED]: "The editor request failed.",
  [ERROR_CODES.DATA_FLOW_DISABLED]: "Component data-flow analysis is disabled.",
  [ERROR_CODES.DATA_FLOW_SOURCE_STALE]:
    "The selected source changed. Select the component again.",
  [ERROR_CODES.DATA_FLOW_ANALYSIS_CANCELLED]:
    "Component data-flow analysis was cancelled.",
  [ERROR_CODES.AI_DISABLED]: "AI execution is disabled in Vite configuration.",
  [ERROR_CODES.PROVIDER_NOT_CONFIGURED]:
    "The provider Key environment variable is missing on the Vite process.",
  [ERROR_CODES.PROVIDER_AUTH_FAILED]:
    "The provider rejected authentication. Check the server-side Key.",
  [ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED]:
    "The relay does not match the configured OpenAI-compatible protocol.",
  [ERROR_CODES.MODEL_NOT_ALLOWED]: "The selected model profile is not allowed.",
  [ERROR_CODES.MODEL_TOOL_CALL_UNSUPPORTED]:
    "The selected model did not start or continue the required tool call.",
  [ERROR_CODES.PROVIDER_RATE_LIMITED]:
    "The provider is rate limited. Wait and try again.",
  [ERROR_CODES.AGENT_BUSY]: "Another write Agent job is still active.",
  [ERROR_CODES.AGENT_LIMIT_EXCEEDED]:
    "The Agent stopped at a configured time, turn, output, or size limit.",
  [ERROR_CODES.AGENT_CANCELLED]: "The Agent job was cancelled.",
  [ERROR_CODES.EXTERNAL_HANDOFF_DISABLED]: EXTERNAL_HANDOFF_ERROR_EN,
  [ERROR_CODES.EXTERNAL_HANDOFF_UNAVAILABLE]: EXTERNAL_HANDOFF_ERROR_EN,
  [ERROR_CODES.HANDOFF_VALIDATION_FAILED]: EXTERNAL_HANDOFF_ERROR_EN,
  [ERROR_CODES.HANDOFF_SOURCE_STALE]: EXTERNAL_HANDOFF_ERROR_EN,
  [ERROR_CODES.HANDOFF_NOT_FOUND]: EXTERNAL_HANDOFF_ERROR_EN,
  [ERROR_CODES.HANDOFF_EXPIRED]: EXTERNAL_HANDOFF_ERROR_EN,
  [ERROR_CODES.HANDOFF_CURSOR_INVALID]: EXTERNAL_HANDOFF_ERROR_EN,
  [ERROR_CODES.HANDOFF_RESPONSE_TOO_LARGE]: EXTERNAL_HANDOFF_ERROR_EN,
  [ERROR_CODES.BRIDGE_UNAUTHORIZED]: EXTERNAL_HANDOFF_ERROR_EN,
  [ERROR_CODES.BRIDGE_PROTOCOL_MISMATCH]: EXTERNAL_HANDOFF_ERROR_EN,
  [ERROR_CODES.BRIDGE_BUSY]: EXTERNAL_HANDOFF_ERROR_EN,
  [ERROR_CODES.EXTERNAL_AGENT_BUSY]: EXTERNAL_HANDOFF_ERROR_EN,
  [ERROR_CODES.ACTIVE_ADAPTER_CONFLICT]: EXTERNAL_HANDOFF_ERROR_EN,
  [ERROR_CODES.ACTIVE_ADAPTER_LEASE_INVALID]: EXTERNAL_HANDOFF_ERROR_EN,
  [ERROR_CODES.ACTIVE_DISPATCH_INVALID]: EXTERNAL_HANDOFF_ERROR_EN,
  [ERROR_CODES.SESSION_NOT_FOUND]: EXTERNAL_HANDOFF_ERROR_EN,
  [ERROR_CODES.SESSION_AMBIGUOUS]: EXTERNAL_HANDOFF_ERROR_EN,
  [ERROR_CODES.SESSION_CLOSED]: EXTERNAL_HANDOFF_ERROR_EN,
  [ERROR_CODES.WORKTREE_DIRTY]: "Confirm inclusion of local changes before running AI.",
  [ERROR_CODES.WORKTREE_NOT_REPOSITORY]:
    "Vite root must be an initialized Git repository root.",
  [ERROR_CODES.WORKTREE_OPERATION_IN_PROGRESS]:
    "Finish the active merge, rebase, cherry-pick, or revert.",
  [ERROR_CODES.WORKTREE_CONFLICTED]: "Resolve all Git conflicts before running AI.",
  [ERROR_CODES.WORKTREE_LOCAL_CHANGES_TOO_LARGE]:
    "Reduce untracked files below the safe count and size limits.",
  [ERROR_CODES.WORKTREE_UNTRACKED_UNSUPPORTED]:
    "An untracked path is missing, linked, or not a regular file.",
  [ERROR_CODES.WORKTREE_LOCAL_CHANGES_UNSUPPORTED]:
    "Local changes cannot be isolated safely.",
  [ERROR_CODES.TOOL_DENIED]: "A tool request violated local safety policy.",
  [ERROR_CODES.TOOL_INPUT_INVALID]: "Invalid tool request.",
  [ERROR_CODES.TOOL_ARGUMENTS_INVALID]: "Tool arguments are invalid.",
  [ERROR_CODES.TOOL_CALL_ID_CONFLICT]: "Tool ID conflicts in this turn.",
  [ERROR_CODES.TOOL_PATH_DENIED]: "The model requested a protected or external path.",
  [ERROR_CODES.PATCH_REJECTED]: "The patch violated local policy.",
  [ERROR_CODES.VALIDATION_FAILED]: "Required checks failed; changes cannot be applied.",
  [ERROR_CODES.APPLY_CONFLICT]: "Agent-touched files changed; nothing was overwritten.",
  [ERROR_CODES.INTERNAL_ERROR]: "The Agent failed without exposing private details.",
} satisfies Record<ErrorCode, string>);

const ERROR_MESSAGES_ZH = Object.freeze({
  [ERROR_CODES.INVALID_REQUEST]: "Agent 请求无效，已被拒绝。",
  [ERROR_CODES.INVALID_TOKEN]: "本地 SpotPatch 会话已失效。",
  [ERROR_CODES.ORIGIN_NOT_ALLOWED]: "当前页面来源未获授权。",
  [ERROR_CODES.SOURCE_NOT_FOUND]: "选中目标对应的源码已不可用。",
  [ERROR_CODES.SOURCE_OUTSIDE_ROOT]: "选中源码位于项目根目录之外。",
  [ERROR_CODES.SOURCE_TOO_LARGE]: "选中源码超过安全大小限制。",
  [ERROR_CODES.EDITOR_OPEN_FAILED]: "编辑器打开请求失败。",
  [ERROR_CODES.DATA_FLOW_DISABLED]: "组件数据链路分析未启用。",
  [ERROR_CODES.DATA_FLOW_SOURCE_STALE]: "选中源码已经变化，请重新选择组件。",
  [ERROR_CODES.DATA_FLOW_ANALYSIS_CANCELLED]: "组件数据链路分析已取消。",
  [ERROR_CODES.AI_DISABLED]: "Vite 配置未启用 AI 执行。",
  [ERROR_CODES.PROVIDER_NOT_CONFIGURED]:
    "启动 Vite 的进程中缺少模型服务 Key 环境变量。",
  [ERROR_CODES.PROVIDER_AUTH_FAILED]: "模型服务鉴权失败，请检查服务端 Key。",
  [ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED]:
    "中转服务与配置的 OpenAI 兼容协议不一致。",
  [ERROR_CODES.MODEL_NOT_ALLOWED]: "当前模型配置未获授权。",
  [ERROR_CODES.MODEL_TOOL_CALL_UNSUPPORTED]: "当前模型未完成必要的工具调用或结果续接。",
  [ERROR_CODES.PROVIDER_RATE_LIMITED]: "模型服务正在限流，请稍后重试。",
  [ERROR_CODES.AGENT_BUSY]: "当前项目已有一个写入任务正在运行。",
  [ERROR_CODES.AGENT_LIMIT_EXCEEDED]: "Agent 达到时间、轮次、输出或变更规模限制。",
  [ERROR_CODES.AGENT_CANCELLED]: "Agent 任务已取消。",
  [ERROR_CODES.EXTERNAL_HANDOFF_DISABLED]: EXTERNAL_HANDOFF_ERROR_ZH,
  [ERROR_CODES.EXTERNAL_HANDOFF_UNAVAILABLE]: EXTERNAL_HANDOFF_ERROR_ZH,
  [ERROR_CODES.HANDOFF_VALIDATION_FAILED]: EXTERNAL_HANDOFF_ERROR_ZH,
  [ERROR_CODES.HANDOFF_SOURCE_STALE]: EXTERNAL_HANDOFF_ERROR_ZH,
  [ERROR_CODES.HANDOFF_NOT_FOUND]: EXTERNAL_HANDOFF_ERROR_ZH,
  [ERROR_CODES.HANDOFF_EXPIRED]: EXTERNAL_HANDOFF_ERROR_ZH,
  [ERROR_CODES.HANDOFF_CURSOR_INVALID]: EXTERNAL_HANDOFF_ERROR_ZH,
  [ERROR_CODES.HANDOFF_RESPONSE_TOO_LARGE]: EXTERNAL_HANDOFF_ERROR_ZH,
  [ERROR_CODES.BRIDGE_UNAUTHORIZED]: EXTERNAL_HANDOFF_ERROR_ZH,
  [ERROR_CODES.BRIDGE_PROTOCOL_MISMATCH]: EXTERNAL_HANDOFF_ERROR_ZH,
  [ERROR_CODES.BRIDGE_BUSY]: EXTERNAL_HANDOFF_ERROR_ZH,
  [ERROR_CODES.EXTERNAL_AGENT_BUSY]: EXTERNAL_HANDOFF_ERROR_ZH,
  [ERROR_CODES.ACTIVE_ADAPTER_CONFLICT]: EXTERNAL_HANDOFF_ERROR_ZH,
  [ERROR_CODES.ACTIVE_ADAPTER_LEASE_INVALID]: EXTERNAL_HANDOFF_ERROR_ZH,
  [ERROR_CODES.ACTIVE_DISPATCH_INVALID]: EXTERNAL_HANDOFF_ERROR_ZH,
  [ERROR_CODES.SESSION_NOT_FOUND]: EXTERNAL_HANDOFF_ERROR_ZH,
  [ERROR_CODES.SESSION_AMBIGUOUS]: EXTERNAL_HANDOFF_ERROR_ZH,
  [ERROR_CODES.SESSION_CLOSED]: EXTERNAL_HANDOFF_ERROR_ZH,
  [ERROR_CODES.WORKTREE_DIRTY]: "运行 AI 前，请明确同意将当前本地修改纳入隔离基线。",
  [ERROR_CODES.WORKTREE_NOT_REPOSITORY]: "Vite 根目录不是已初始化 Git 仓库的顶层目录。",
  [ERROR_CODES.WORKTREE_OPERATION_IN_PROGRESS]:
    "请先完成当前 merge、rebase、cherry-pick 或 revert，再运行 AI。",
  [ERROR_CODES.WORKTREE_CONFLICTED]: "请先解决全部 Git 冲突，再运行 AI。",
  [ERROR_CODES.WORKTREE_LOCAL_CHANGES_TOO_LARGE]:
    "未跟踪文件超过安全数量或体积上限，请先精简。",
  [ERROR_CODES.WORKTREE_UNTRACKED_UNSUPPORTED]:
    "未跟踪项已丢失、是符号链接或不是普通文件。",
  [ERROR_CODES.WORKTREE_LOCAL_CHANGES_UNSUPPORTED]: "当前本地修改无法安全隔离。",
  [ERROR_CODES.TOOL_DENIED]: "工具请求违反本地安全策略。",
  [ERROR_CODES.TOOL_INPUT_INVALID]: "工具请求无效。",
  [ERROR_CODES.TOOL_ARGUMENTS_INVALID]: "工具参数无效。",
  [ERROR_CODES.TOOL_CALL_ID_CONFLICT]: "本轮工具 ID 冲突。",
  [ERROR_CODES.TOOL_PATH_DENIED]: "模型请求了受保护或项目外路径。",
  [ERROR_CODES.PATCH_REJECTED]: "补丁违反本地策略。",
  [ERROR_CODES.VALIDATION_FAILED]: "必需检查失败，无法应用变更。",
  [ERROR_CODES.APPLY_CONFLICT]: "Agent 触及文件已变化，未覆盖。",
  [ERROR_CODES.INTERNAL_ERROR]: "Agent 失败，未暴露私有细节。",
} satisfies Record<ErrorCode, string>);

const SUMMARY_MESSAGES_EN = Object.freeze({
  adapter: "React adapter",
  api: "API",
  apiStatuses: Object.freeze({
    connected: "connected",
    failed: "failed",
    loading: "loading",
    "not-required": "not required",
  }),
  available: "available",
  boundary: "Boundary",
  boundaries: Object.freeze({
    component: "component",
    "nearby-lines": "nearby lines",
  }),
  browserContext: "Browser context",
  collectionStatuses: Object.freeze({
    failed: "failed",
    loading: "loading",
    ready: "ready",
  }),
  component: "Component",
  confidence: "Confidence",
  confidenceLabels: Object.freeze({
    exact: "exact element source",
    probable: "probable owning component",
    approximate: "nearest business container",
    unknown: "source not found",
  }),
  cssWarnings: "CSS warnings",
  lineLocation: (line: number, column?: number) =>
    `line ${String(line)}${column === undefined ? "" : `, column ${String(column)}`}`,
  origin: "Origin",
  source: "Source",
  sourceContext: "Source context",
  stack: "Stack",
  target: (index: number, active: boolean) =>
    `Target ${String(index)}${active ? " (active)" : ""}`,
  unavailable: "unavailable",
  unsupported: "unsupported",
  warning: "Warning",
} satisfies SelectionSummaryMessages);

const SUMMARY_MESSAGES_ZH = Object.freeze({
  adapter: "React 适配器",
  api: "API",
  apiStatuses: Object.freeze({
    connected: "已连接",
    failed: "失败",
    loading: "加载中",
    "not-required": "无需请求",
  }),
  available: "可用",
  boundary: "代码边界",
  boundaries: Object.freeze({
    component: "完整组件",
    "nearby-lines": "附近代码",
  }),
  browserContext: "浏览器上下文",
  collectionStatuses: Object.freeze({
    failed: "失败",
    loading: "采集中",
    ready: "已就绪",
  }),
  component: "组件",
  confidence: "置信度",
  confidenceLabels: Object.freeze({
    exact: "精确元素源码",
    probable: "可能的所属组件",
    approximate: "最近业务容器",
    unknown: "未找到源码",
  }),
  cssWarnings: "CSS 警告",
  lineLocation: (line: number, column?: number) =>
    `第 ${String(line)} 行${column === undefined ? "" : `，第 ${String(column)} 列`}`,
  origin: "定位来源",
  source: "源码",
  sourceContext: "源码上下文",
  stack: "组件栈",
  target: (index: number, active: boolean) =>
    `目标 ${String(index)}${active ? "（当前）" : ""}`,
  unavailable: "不可用",
  unsupported: "不支持",
  warning: "警告",
} satisfies SelectionSummaryMessages);

export const UI_MESSAGES = Object.freeze({
  "en-US": Object.freeze({
    localeName: "EN",
    alternateLocaleName: "中",
    switchLocale: "Switch interface language to Chinese",
    brand: Object.freeze({
      name: "SpotPatch",
      context: "Live context",
      repository: "GitHub ↗",
      repositoryTitle: "Star SpotPatch on GitHub",
    }),
    trigger: Object.freeze({
      select: "Select element",
      stop: "Stop selecting",
      title: (shortcut: string) => `Toggle SpotPatch (${shortcut})`,
    }),
    dialog: Object.freeze({
      close: "Close SpotPatch",
      editTitle: "Plan the change",
      editSubtitle: "Give each selected target its own precise instruction.",
      previewTitle: "Review the request",
      previewSubtitle: "Verify the complete context before it leaves the browser.",
    }),
    floatingSurface: Object.freeze({
      dragHandle: "Drag to move the SpotPatch workbench",
      resetPosition: "Reset workbench position",
      positionReset: "SpotPatch position reset to the lower-right corner.",
    }),
    context: Object.freeze({
      collecting: "Collecting context",
      ready: "Context ready",
      partial: "Partial context",
      sourceUnavailable: "Source unavailable",
      selectedElement: "Selected element",
      selectedCount: (count: number) => `${String(count)} elements selected`,
    }),
    targets: Object.freeze({
      title: "Selected targets",
      ariaLabel: "Selected targets and change instructions",
      count: (selected: number, maximum: number) =>
        `${String(selected)} of ${String(maximum)}`,
      complete: (complete: number, total: number) =>
        `${String(complete)} of ${String(total)} described`,
      instructionBudget: (used: number, maximum: number) =>
        `${String(used)} / ${String(maximum)} characters`,
      instructionBudgetExceeded: (used: number, maximum: number) =>
        `${String(used)} / ${String(maximum)} characters — reduce the request`,
      statusReady: "Ready",
      statusPartial: "Partial",
      statusCollecting: "Collecting",
      instructionReady: "Instruction added",
      instructionMissing: "Needs instruction",
      instructionLabel: (name: string) => `Change for ${name}`,
      instructionPlaceholder:
        "Describe the desired result for this target, including constraints…",
      instructionCount: (used: number, maximum: number) =>
        `${String(used)} / ${String(maximum)}`,
      activate: (index: number) => `Edit target ${String(index)}`,
      remove: (index: number) => `Remove target ${String(index)}`,
      removeTitle: "Remove target",
      addTitle: "Add another element to this request",
      limitTitle: (maximum: number) => `Selection limit reached (${String(maximum)})`,
    }),
    diagnostics: Object.freeze({
      title: "Captured context",
      resolving: "Resolving source…",
      noExactSource: "No exact source marker",
      promptAriaLabel: "Generated prompt",
    }),
    summary: SUMMARY_MESSAGES_EN,
    actions: Object.freeze({
      addElement: "Add element",
      reselect: "Start over",
      openEditor: "Open source",
      openTarget: (index: number) => `Open source for target ${String(index)}`,
      preview: "Preview prompt",
      copy: "Copy prompt",
      back: "Back to edit",
    }),
    agent: Object.freeze({
      title: "AI code agent",
      mode: "Execution mode",
      review: "Review",
      autoGated: "Auto gated",
      trustedFast: "Trusted direct",
      provider: "Provider",
      model: "Model",
      providerAriaLabel: "AI provider",
      modelAriaLabel: "AI model",
      providerUnavailable: "Provider configuration is unavailable.",
      consent: (provider: string) =>
        `I understand selected context and allowed source may be sent to ${provider}; its data policy is my responsibility.`,
      trustedFastConsent: (provider: string) =>
        `Enable trusted direct mode for ${provider}: send allowed project context, include current local changes, skip project validation checks, and immediately apply AI changes, including file deletions and configuration changes.`,
      connectionNotTested: "Optional connection check not run",
      workspaceNotChecked: "Local workspace not checked",
      checkingWorkspace: "Checking Git workspace and isolated execution…",
      workspaceReady: "Local workspace is ready for isolated execution",
      workspaceDirty: (staged: number, unstaged: number, untracked: number) =>
        `Local changes found · ${String(staged)} staged · ${String(unstaged)} unstaged · ${String(untracked)} untracked`,
      includeLocalChanges: "Allow the Agent to continue from my current local changes",
      includeLocalChangesHelp:
        "The Agent may edit these files. SpotPatch preserves the baseline and applies or reverts only the Agent delta.",
      localChangesConsentRequired:
        "Confirm inclusion of current local changes before running AI.",
      capabilityVerified: "Agent capability verified",
      capabilityVerifiedAnnouncement: "AI provider capability verified.",
      testingCapability: "Testing authentication, tools, continuation, and streaming…",
      applying: "Applying changes to the project.",
      cancelling: "Cancelling Agent job.",
      reverting: "Reverting the applied Agent change.",
      consentRequired: "Confirm remote provider data transmission before running AI.",
      toolsReady: "tools and streaming ready",
      testConnection: "Check environment",
      verifying: "Verifying…",
      run: "Run AI",
      cancel: "Cancel agent",
      discard: "Discard changes",
      apply: "Apply changes",
      revert: "Revert changes",
      revise: "Revise request",
      diffAriaLabel: "Proposed source diff",
      noOutput: "No output.",
      status: (status: AgentJobStatus) => STATUS_EN[status],
    }),
    execution: Object.freeze({
      claude: "Claude",
      codex: "Codex",
      receivingTitle: (identity: string) => `${identity} is receiving context`,
      runningTitle: (identity: string) => `${identity} is modifying code`,
      completedTitle: (identity: string) => `${identity} finished the change`,
      failedTitle: (identity: string) => `${identity} stopped`,
      resultReturned: "The result is back in SpotPatch",
      runningStatus: "Running",
      activityAction: (kind: ExecutionActivityKind, detail?: string) =>
        executionActivityAction(EXECUTION_ACTIVITY_EN, kind, detail),
      activityLane: executionActivityLane,
    }),
    announcements: Object.freeze({
      adapterDisabled: "React inspection was disabled after an adapter failure.",
      selectionEnabled: "Element selection enabled.",
      chooseAnother: "Choose another element.",
      reselectAfterChange: "Choose the current elements again after the file change.",
      sourceLoaded: "Source context loaded.",
      sourceFailed: "Source context could not be loaded.",
      addCancelled: "Additional selection cancelled.",
      selectionLimit: (maximum: number) =>
        `The selection limit of ${String(maximum)} elements has been reached.`,
      chooseAdditional: (selected: number, maximum: number) =>
        `Choose another element. ${String(selected)} of ${String(maximum)} selected.`,
      duplicate: "That source target is already selected.",
      sourceProbable:
        "A probable React component was found without an authorized file token.",
      sourceMissing: "No authorized source marker was found for the selected element.",
      noSelectable: "No selectable element was found.",
      allTargetsRemoved: "All targets were removed. Choose an element to continue.",
      targetRemoved: "Selected target removed.",
      detachedTargetPreserved:
        "The page element was unloaded; its collected context remains selected.",
      contextWarning: "Browser context collection completed with a warning.",
      contextCollected: "Browser context collected.",
      editorOpening: "Opening source…",
      editorOpened: "Source opened in the editor.",
      editorFailed: "Could not open the editor. Start it or configure editor.",
      completeInstructions:
        "Add an instruction for every target and wait for context collection to finish.",
      promptCopied: "Prompt copied to the clipboard.",
      clipboardUnavailable:
        "Clipboard access is unavailable. Select the prompt manually.",
      copyFailed: "Copy failed. Select the prompt manually.",
      appliedTargetsDetached:
        "Changes applied. Reselect page elements after HMR before creating another request.",
    }),
    errors: ERROR_MESSAGES_EN,
  }),
  "zh-CN": Object.freeze({
    localeName: "中",
    alternateLocaleName: "EN",
    switchLocale: "将界面语言切换为英文",
    brand: Object.freeze({
      name: "SpotPatch",
      context: "实时上下文",
      repository: "GitHub ↗",
      repositoryTitle: "在 GitHub 上 Star SpotPatch",
    }),
    trigger: Object.freeze({
      select: "选择元素",
      stop: "停止选择",
      title: (shortcut: string) => `切换 SpotPatch（${shortcut}）`,
    }),
    dialog: Object.freeze({
      close: "关闭 SpotPatch",
      editTitle: "规划本次修改",
      editSubtitle: "为每个选中目标分别写清楚修改要求。",
      previewTitle: "审阅修改请求",
      previewSubtitle: "发送给 AI 前，请核对完整上下文与每项目标说明。",
    }),
    floatingSurface: Object.freeze({
      dragHandle: "拖拽以移动 SpotPatch 工作台",
      resetPosition: "重置工作台位置",
      positionReset: "SpotPatch 已恢复到右下角。",
    }),
    context: Object.freeze({
      collecting: "正在采集上下文",
      ready: "上下文已就绪",
      partial: "部分上下文可用",
      sourceUnavailable: "源码位置不可用",
      selectedElement: "已选元素",
      selectedCount: (count: number) => `已选择 ${String(count)} 个元素`,
    }),
    targets: Object.freeze({
      title: "修改目标",
      ariaLabel: "已选目标与逐项目标说明",
      count: (selected: number, maximum: number) =>
        `${String(selected)} / ${String(maximum)}`,
      complete: (complete: number, total: number) =>
        `已描述 ${String(complete)} / ${String(total)}`,
      instructionBudget: (used: number, maximum: number) =>
        `说明字符 ${String(used)} / ${String(maximum)}`,
      instructionBudgetExceeded: (used: number, maximum: number) =>
        `说明字符 ${String(used)} / ${String(maximum)}，请精简后继续`,
      statusReady: "已就绪",
      statusPartial: "部分可用",
      statusCollecting: "采集中",
      instructionReady: "已填写修改说明",
      instructionMissing: "待填写修改说明",
      instructionLabel: (name: string) => `${name} 的修改说明`,
      instructionPlaceholder: "描述这个目标期望达到的结果，以及不能破坏的约束……",
      instructionCount: (used: number, maximum: number) =>
        `${String(used)} / ${String(maximum)}`,
      activate: (index: number) => `编辑目标 ${String(index)}`,
      remove: (index: number) => `移除目标 ${String(index)}`,
      removeTitle: "移除目标",
      addTitle: "继续为本次请求选择元素",
      limitTitle: (maximum: number) => `已达到 ${String(maximum)} 个目标的上限`,
    }),
    diagnostics: Object.freeze({
      title: "已采集上下文",
      resolving: "正在解析源码……",
      noExactSource: "没有精确源码标记",
      promptAriaLabel: "生成的 Prompt",
    }),
    summary: SUMMARY_MESSAGES_ZH,
    actions: Object.freeze({
      addElement: "添加元素",
      reselect: "重新开始",
      openEditor: "打开源码",
      openTarget: (index: number) => `打开目标 ${String(index)} 的源码`,
      preview: "预览 Prompt",
      copy: "复制 Prompt",
      back: "返回编辑",
    }),
    agent: Object.freeze({
      title: "AI 代码 Agent",
      mode: "执行方式",
      review: "审阅模式",
      autoGated: "受控自动模式",
      trustedFast: "可信极速模式",
      provider: "模型服务",
      model: "模型",
      providerAriaLabel: "AI 模型服务",
      modelAriaLabel: "AI 模型",
      providerUnavailable: "模型服务配置不可用。",
      consent: (provider: string) =>
        `我了解选中上下文与获准源码可能发送到 ${provider}，并自行负责其数据策略。`,
      trustedFastConsent: (provider: string) =>
        `为 ${provider} 启用可信极速模式：发送获准的项目上下文、纳入当前本地修改、跳过项目验证检查，并立即应用 AI 变更，包括删除文件与配置变更。`,
      connectionNotTested: "尚未执行可选连接检查",
      workspaceNotChecked: "尚未检查本地工作区",
      checkingWorkspace: "正在检查 Git 工作区与隔离执行环境……",
      workspaceReady: "本地工作区已满足隔离执行条件",
      workspaceDirty: (staged: number, unstaged: number, untracked: number) =>
        `发现本地修改 · 暂存 ${String(staged)} · 未暂存 ${String(unstaged)} · 未跟踪 ${String(untracked)}`,
      includeLocalChanges: "允许 Agent 基于我当前的本地修改继续",
      includeLocalChangesHelp:
        "Agent 可能继续修改这些文件；SpotPatch 会保留原基线，仅应用或撤销 Agent 自己的增量。",
      localChangesConsentRequired: "运行 AI 前，请确认允许纳入当前本地修改。",
      capabilityVerified: "Agent 能力验证通过",
      capabilityVerifiedAnnouncement: "AI 模型服务能力验证通过。",
      testingCapability: "正在验证鉴权、工具调用、连续调用与流式响应……",
      applying: "正在将变更应用到项目。",
      cancelling: "正在取消 Agent 任务。",
      reverting: "正在撤销已应用的 Agent 变更。",
      consentRequired: "运行 AI 前，请先确认允许向远程模型服务传输数据。",
      toolsReady: "工具调用与流式响应已就绪",
      testConnection: "检查运行环境",
      verifying: "验证中……",
      run: "运行 AI",
      cancel: "取消 Agent",
      discard: "放弃变更",
      apply: "应用变更",
      revert: "撤销变更",
      revise: "修改请求",
      diffAriaLabel: "建议的源码差异",
      noOutput: "没有输出。",
      status: (status: AgentJobStatus) => STATUS_ZH[status],
    }),
    execution: Object.freeze({
      claude: "Claude",
      codex: "Codex",
      receivingTitle: (identity: string) => `${identity} 正在接收上下文`,
      runningTitle: (identity: string) => `${identity} 正在执行修改`,
      completedTitle: (identity: string) => `${identity} 修改完成`,
      failedTitle: (identity: string) => `${identity} 执行失败`,
      resultReturned: "结果已回流 SpotPatch",
      runningStatus: "执行中",
      activityAction: (kind: ExecutionActivityKind, detail?: string) =>
        executionActivityAction(EXECUTION_ACTIVITY_ZH, kind, detail),
      activityLane: executionActivityLane,
    }),
    announcements: Object.freeze({
      adapterDisabled: "React 适配器异常，本次会话已停用 React 检查。",
      selectionEnabled: "元素选择已启用。",
      chooseAnother: "请选择另一个元素。",
      reselectAfterChange: "文件变更后，请重新选择当前页面元素。",
      sourceLoaded: "源码上下文已加载。",
      sourceFailed: "源码上下文加载失败。",
      addCancelled: "已取消追加选择。",
      selectionLimit: (maximum: number) =>
        `已达到 ${String(maximum)} 个元素的选择上限。`,
      chooseAdditional: (selected: number, maximum: number) =>
        `请选择另一个元素，当前已选 ${String(selected)} / ${String(maximum)}。`,
      duplicate: "该源码目标已经在当前选择中。",
      sourceProbable: "找到可能的 React 组件，但没有获授权的源码标记。",
      sourceMissing: "选中元素没有获授权的源码标记。",
      noSelectable: "当前位置没有可选择的元素。",
      allTargetsRemoved: "已移除全部目标，请重新选择元素。",
      targetRemoved: "已移除选中目标。",
      detachedTargetPreserved: "页面元素已卸载，已采集的上下文仍保留在选择中。",
      contextWarning: "浏览器上下文采集完成，但存在警告。",
      contextCollected: "浏览器上下文采集完成。",
      editorOpening: "正在打开源码……",
      editorOpened: "源码已在编辑器中打开。",
      editorFailed: "无法打开编辑器。请先启动编辑器或检查 editor 配置。",
      completeInstructions: "请为每个目标填写修改说明，并等待上下文采集完成。",
      promptCopied: "Prompt 已复制到剪贴板。",
      clipboardUnavailable: "无法访问剪贴板，请手动选择并复制 Prompt。",
      copyFailed: "复制失败，请手动选择并复制 Prompt。",
      appliedTargetsDetached: "变更已应用；HMR 后请重新选择页面元素再发起新请求。",
    }),
    errors: ERROR_MESSAGES_ZH,
  }),
} satisfies Readonly<Record<SpotPatchLocale, UiMessages>>);

export interface UiLocalizer {
  readonly locale: () => SpotPatchLocale;
  readonly messages: () => UiMessages;
  readonly subscribe: (listener: () => void) => () => void;
  readonly toggle: () => void;
}

function localeFromLanguage(value: string | undefined): SpotPatchLocale | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "zh" || normalized.startsWith("zh-")) {
    return "zh-CN";
  }

  return normalized === "en" || normalized.startsWith("en-") ? "en-US" : undefined;
}

export function resolveUiLocale(
  preference: SpotPatchLocalePreference,
  document: Document,
): SpotPatchLocale {
  if (preference !== "auto") {
    return preference;
  }

  const documentLocale = localeFromLanguage(document.documentElement.lang);

  if (documentLocale !== undefined) {
    return documentLocale;
  }

  const navigatorLocale = document.defaultView?.navigator.languages
    .map(localeFromLanguage)
    .find((candidate): candidate is SpotPatchLocale => candidate !== undefined);
  return navigatorLocale ?? "en-US";
}

export function createUiLocalizer(
  document: Document,
  preference: SpotPatchLocalePreference = "auto",
): UiLocalizer {
  let currentLocale = resolveUiLocale(preference, document);
  const listeners = new Set<() => void>();

  return Object.freeze({
    locale: () => currentLocale,
    messages: () => UI_MESSAGES[currentLocale],
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    toggle(): void {
      currentLocale = currentLocale === "en-US" ? "zh-CN" : "en-US";

      for (const listener of listeners) {
        listener();
      }
    },
  });
}
