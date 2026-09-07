import type { SpotPatchRuntimeConfig } from "@spotpatch/shared";
import type {
  ActiveAdapterSummary,
  DispatchSummary,
  ErrorCode,
  ExternalAgentAction,
  ExternalAgentControlStatus,
  ExternalAgentErrorCode,
  ExternalAgentManagedResult,
  ExternalHandoffCapability,
  ExternalHandoffPublishResult,
  ExternalHandoffStatusResult,
  ExternalHandoffSummary,
  SpotAnnotation,
  SpotPatchLocale,
} from "@spotpatch/shared/external-handoff-browser";

import { createButton, createMarkedElement } from "./dom.js";
import type { ExternalHandoffPanel } from "./external-handoff-contract.js";
import { createSelectPicker, SELECT_PICKER_STYLES } from "./ask-picker.js";

interface PanelOptions {
  readonly document: Document;
  readonly framework: SpotPatchRuntimeConfig["framework"];
  readonly locale: () => SpotPatchLocale;
  readonly onDispatchChange?: (dispatch: DispatchSummary | null) => void;
  readonly onControlChange?: (status: ExternalAgentControlStatus | undefined) => void;
  readonly onViewChange: () => void;
  readonly sessionId: string;
  readonly subscribeLocale: (listener: () => void) => () => void;
}

type ControlTask = NonNullable<ExternalAgentControlStatus["task"]>;
type ControlValidationOutcome = NonNullable<ControlTask["validationOutcome"]>;
type ManagedValidationOutcome = ExternalAgentManagedResult["validationOutcome"];

interface ExternalHandoffMessages {
  readonly activeReady: (agent: string) => string;
  readonly agentLabel: string;
  readonly modelLabel: string;
  readonly modelLoading: string;
  readonly modelHint: string;
  readonly applyModel: string;
  readonly cancel: string;
  readonly cancelManaged: string;
  readonly codexManaged: string;
  readonly confirm: string;
  readonly connectManaged: string;
  readonly controlActionText: Readonly<Record<ExternalAgentAction, string>>;
  readonly controlAuth: (
    auth: ExternalAgentControlStatus["authReadiness"],
    grant: ExternalAgentControlStatus["grantState"],
  ) => string;
  readonly controlConnection: (
    state: ExternalAgentControlStatus["connectionState"],
    mode: ExternalAgentControlStatus["mode"],
  ) => string;
  readonly controlConsentRequired: (command: string) => string;
  readonly controlErrorText: Readonly<Record<ExternalAgentErrorCode, string>>;
  readonly controlFailure: (error: string, action: string) => string;
  readonly controlModel: (model: string) => string;
  readonly controlRevision: (task: ControlTask) => string;
  readonly controlUnavailable: string;
  readonly controlValidation: (outcome: ControlValidationOutcome) => string;
  readonly completed: (agent: string, revision: number) => string;
  readonly description: string;
  readonly dispatched: (agent: string, revision: number) => string;
  readonly dispatching: (agent: string, revision: number) => string;
  readonly disclosureData: string;
  readonly disclosureInbox: string;
  readonly disclosureIntro: (targets: number, files: number) => string;
  readonly disclosureManagedGuarantee: string;
  readonly disclosureNoGuarantee: string;
  readonly disclosureProvider: string;
  readonly disclosureTitle: string;
  readonly error: (code?: ErrorCode) => string;
  readonly disconnectManaged: string;
  readonly expired: (revision: number) => string;
  readonly failed: (agent: string, revision: number) => string;
  readonly inboxSend: string;
  readonly pickedUp: (revision: number, count: number, time?: string) => string;
  readonly published: (revision: number, expiresAt: string) => string;
  readonly publishing: string;
  readonly queued: (agent: string, revision: number) => string;
  readonly ready: string;
  readonly readyWaiting: (count: number) => string;
  readonly refresh: string;
  readonly resultTitle: string;
  readonly resultHeader: (
    revision: number,
    outcome: ManagedValidationOutcome,
  ) => string;
  readonly resultDisposition: (outcome: ManagedValidationOutcome) => string;
  readonly resultTiming: (stage: string, durationMs: number) => string;
  readonly resolveUnknown: string;
  readonly retry: string;
  readonly revokeManaged: string;
  readonly send: string;
  readonly settingsHelp: string;
  readonly settingsTitle: string;
  readonly superseded: (revision: number) => string;
  readonly title: string;
  readonly unknown: (agent: string, revision: number) => string;
  readonly unknownResolved: (agent: string, revision: number) => string;
  readonly working: (agent: string, revision: number) => string;
}

const MESSAGES = Object.freeze({
  "en-US": Object.freeze({
    title: "External Agent connection",
    agentLabel: "Agent",
    modelLabel: "Managed Codex model",
    modelLoading: "Connect to load available models",
    modelHint:
      "Applies only to this managed connection, not API Key settings. Apply changes before publishing; switching reconnects Codex.",
    applyModel: "Apply model",
    codexManaged: "Codex · managed (experimental)",
    connectManaged: "Connect Codex",
    disconnectManaged: "Disconnect",
    revokeManaged: "Revoke grant",
    cancelManaged: "Cancel managed task",
    resultTitle: "Managed result",
    controlConnection: (
      state: ExternalAgentControlStatus["connectionState"],
      mode: ExternalAgentControlStatus["mode"],
    ) => `Connection: ${state} · Mode: ${mode}`,
    controlAuth: (
      auth: ExternalAgentControlStatus["authReadiness"],
      grant: ExternalAgentControlStatus["grantState"],
    ) => `Auth: ${auth} · Grant: ${grant}`,
    controlConsentRequired: (command: string) =>
      `Initialize project access once: run \`${command}\` from this project, then connect again. No dev-terminal confirmation is required. The grant allows isolated snapshot writes and validated application; revoke it here at any time.`,
    controlModel: (model: string) => `Model: ${model}`,
    controlRevision: (task: ControlTask) =>
      `Revision ${String(task.revision)}: ${task.deliveryStatus} / ${task.executionStatus} / ${task.managedPhase}`,
    controlValidation: (outcome: ControlValidationOutcome) => `Validation: ${outcome}`,
    controlFailure: (error: string, action: string) =>
      `Error: ${error} · Next: ${action}`,
    controlUnavailable:
      "Page connection management is unavailable; external handoffs still fall back honestly to the Agent inbox.",
    controlErrorText: Object.freeze({
      AGENT_BINARY_NOT_FOUND: "Codex is not installed or is not on PATH.",
      AGENT_BINARY_UNTRUSTED: "The resolved Codex executable is not trusted.",
      AGENT_VERSION_UNSUPPORTED:
        "The installed Codex version is below SpotPatch's compatibility baseline.",
      APP_SERVER_HANDSHAKE_FAILED: "Codex App Server did not complete startup.",
      AGENT_AUTH_REQUIRED: "Codex requires an authenticated account.",
      AGENT_MODEL_UNAVAILABLE: "The configured Codex model is unavailable.",
      AGENT_PROTOCOL_INCOMPATIBLE:
        "The generated Codex App Server schema is incompatible with SpotPatch's required protocol subset.",
      CODEX_CONFIG_ISOLATION_UNSUPPORTED:
        "This Codex version cannot prove managed configuration isolation.",
      MANAGED_GRANT_INVALID: "The saved project grant failed validation.",
      MANAGED_PLATFORM_UNSUPPORTED:
        "Managed execution is not proven safe on this platform.",
      MANAGED_GIT_REQUIRED: "Managed execution requires a Git repository.",
      MANAGED_SNAPSHOT_FAILED:
        "The independent workspace snapshot could not be created.",
      MANAGED_SCOPE_VIOLATION: "The candidate change exceeded its authorized paths.",
      MANAGED_CHANGE_LIMIT_EXCEEDED: "The candidate change exceeded safety limits.",
      MANAGED_VALIDATION_FAILED:
        "The candidate change did not pass audit or validation.",
      MANAGED_WORKSPACE_CONFLICT: "An authorized source file changed during execution.",
      MANAGED_APPLY_FAILED: "The audited change could not be applied safely.",
      MANAGED_CLEANUP_INCOMPLETE: "Managed thread or workspace cleanup is incomplete.",
    }),
    controlActionText: Object.freeze({
      "install-agent": "Install Codex and retry.",
      "use-supported-version": "Use a schema-compatible Codex version.",
      "sign-in": "Sign in with Codex, then retry.",
      "choose-available-model": "Choose an available model and reconnect Codex.",
      "use-inbox": "Continue with the Agent inbox fallback.",
      "confirm-managed-access": "Revoke the invalid grant and confirm access again.",
      "review-candidate-diff": "Review the candidate diff and validation output.",
      "review-workspace-conflict": "Review the workspace changes before retrying.",
      retry: "Retry the managed connection.",
      "inspect-cleanup-warning": "Inspect cleanup status before reconnecting.",
    }),
    resultHeader: (revision: number, outcome: ManagedValidationOutcome) =>
      `Revision ${String(revision)} · Validation ${outcome}`,
    resultDisposition: (outcome: ManagedValidationOutcome) =>
      outcome === "passed"
        ? "Applied to the project after validation passed."
        : `Candidate only; it was not applied because validation is ${outcome}.`,
    resultTiming: (stage: string, durationMs: number) =>
      `Timing ${stage}: ${String(durationMs)} ms`,
    description:
      "Send through a ready active adapter, or publish to the project Agent inbox when no active adapter is connected.",
    ready:
      "Local Broker ready. No Agent connection is assumed until a connector reads or waits.",
    readyWaiting: (count: number) =>
      `${String(count)} active connector wait request(s); publishing can wake them immediately.`,
    activeReady: (agent: string) =>
      `${agent} is connected and idle. The next send will dispatch immediately.`,
    publishing: "Authorizing current source and publishing the handoff…",
    published: (revision: number, expiresAt: string) =>
      `Revision ${String(revision)} is available until ${expiresAt}. It has not been claimed as edited.`,
    queued: (agent: string, revision: number) =>
      `Revision ${String(revision)} is reserved for ${agent}.`,
    dispatching: (agent: string, revision: number) =>
      `Dispatching revision ${String(revision)} to ${agent}…`,
    dispatched: (agent: string, revision: number) =>
      agent === "Claude Code"
        ? `Revision ${String(revision)} was written to the Claude Channel transport; there is no model ACK yet.`
        : `Codex App Server accepted revision ${String(revision)}; waiting for the matching turn to start.`,
    working: (agent: string, revision: number) =>
      `${agent} is working on revision ${String(revision)}.`,
    completed: (agent: string, revision: number) =>
      `${agent} ended revision ${String(revision)} normally. Review the diff and checks; this does not prove the requested change is correct.`,
    failed: (agent: string, revision: number) =>
      `${agent} reported revision ${String(revision)} as failed. The connector is idle again.`,
    unknown: (agent: string, revision: number) =>
      `Delivery of revision ${String(revision)} to ${agent} is uncertain. The managed writer stopped; review the workspace before allowing another task.`,
    unknownResolved: (agent: string, revision: number) =>
      `Revision ${String(revision)} for ${agent} remains delivery-unknown, but the workspace review was confirmed. A new connector or inbox task may now be used.`,
    pickedUp: (revision: number, count: number, time?: string) =>
      `Revision ${String(revision)} was picked up by ${String(count)} connector instance(s)${time === undefined ? "." : `; last pickup ${time}.`} This does not prove a code change.`,
    expired: (revision: number) =>
      `Revision ${String(revision)} expired. Review the current selection and publish again.`,
    superseded: (revision: number) =>
      `Revision ${String(revision)} was superseded by a newer handoff.`,
    send: "Send to Agent",
    inboxSend: "Publish to Agent inbox",
    retry: "Retry same send",
    refresh: "Refresh pickup status",
    resolveUnknown: "Workspace reviewed — allow a new task",
    settingsTitle: "Project connection setup",
    settingsHelp:
      "Codex managed mode is owned by the current development server. The browser never receives vendor credentials or arbitrary command access. Generic and attached adapters remain honest Inbox fallbacks.",
    disclosureTitle: "Confirm external Agent handoff",
    disclosureIntro: (targets: number, files: number) =>
      `Publish ${String(targets)} selected target(s) referencing ${String(files)} relative file(s).`,
    disclosureData:
      "The handoff includes your instructions, component/page context, sanitized DOM/CSS, and bounded source read again by the local Node service.",
    disclosureInbox:
      "Any SpotPatch connector configured for this project may read it during the 15-minute lifetime.",
    disclosureProvider:
      "The Agent host may send the content to its cloud provider under that product's data policy.",
    disclosureNoGuarantee:
      "External edits do not receive SpotPatch's built-in worktree, Apply, or Revert guarantees.",
    disclosureManagedGuarantee:
      "Managed Codex edits run in an independent temporary snapshot. SpotPatch audits the diff and only applies it when every trusted required check passes.",
    cancel: "Cancel",
    confirm: "Confirm and send",
    error: (code?: ErrorCode) =>
      code === "EXTERNAL_AGENT_BUSY"
        ? "The active Agent is still busy or blocked by an uncertain delivery."
        : code === "ACTIVE_DISPATCH_INVALID"
          ? "The active delivery state changed. Refresh before continuing."
          : code === "HANDOFF_SOURCE_STALE"
            ? "The selected source changed. Select the current component again."
            : code === "HANDOFF_RESPONSE_TOO_LARGE"
              ? "The handoff is too large. Reduce the selected context."
              : code === "EXTERNAL_HANDOFF_DISABLED"
                ? "External Agent handoff is disabled in trusted project configuration."
                : code === "EXTERNAL_HANDOFF_UNAVAILABLE" || code === "SESSION_CLOSED"
                  ? "The local external Agent Broker is unavailable. Restart the development server."
                  : "The external Agent handoff request failed without publishing a partial revision.",
  }),
  "zh-CN": Object.freeze({
    title: "外部 Agent 连接",
    agentLabel: "Agent",
    modelLabel: "受管 Codex 模型",
    modelLoading: "连接后加载可用模型",
    modelHint:
      "仅作用于此受管连接，不修改 API Key 配置。更换后请先应用模型，再发布任务；应用时会重新连接 Codex。",
    applyModel: "应用模型",
    codexManaged: "Codex · 受管模式（实验性）",
    connectManaged: "连接 Codex",
    disconnectManaged: "断开连接",
    revokeManaged: "撤销授权",
    cancelManaged: "取消受管任务",
    resultTitle: "受管执行结果",
    controlConnection: (
      state: ExternalAgentControlStatus["connectionState"],
      mode: ExternalAgentControlStatus["mode"],
    ) => `连接：${state} · 模式：${mode}`,
    controlAuth: (
      auth: ExternalAgentControlStatus["authReadiness"],
      grant: ExternalAgentControlStatus["grantState"],
    ) => `认证：${auth} · 授权：${grant}`,
    controlConsentRequired: (command: string) =>
      `请在当前项目执行一次初始化：\`${command}\`，然后重新连接，无需在开发终端输入 yes。授权允许隔离快照修改及校验后的应用，可随时在此撤销。`,
    controlModel: (model: string) => `模型：${model}`,
    controlRevision: (task: ControlTask) =>
      `revision ${String(task.revision)}：${task.deliveryStatus} / ${task.executionStatus} / ${task.managedPhase}`,
    controlValidation: (outcome: ControlValidationOutcome) => `验证：${outcome}`,
    controlFailure: (error: string, action: string) =>
      `错误：${error} · 下一步：${action}`,
    controlUnavailable:
      "页面连接管理不可用；外部交接仍会按真实能力降级为 Agent 收件箱。",
    controlErrorText: Object.freeze({
      AGENT_BINARY_NOT_FOUND: "未安装 Codex，或 Codex 不在 PATH 中。",
      AGENT_BINARY_UNTRUSTED: "解析到的 Codex 可执行文件不可信。",
      AGENT_VERSION_UNSUPPORTED: "已安装的 Codex 版本低于 SpotPatch 兼容基线。",
      APP_SERVER_HANDSHAKE_FAILED: "Codex App Server 未完成启动握手。",
      AGENT_AUTH_REQUIRED: "Codex 需要已登录的账户。",
      AGENT_MODEL_UNAVAILABLE: "Codex 配置的模型当前不可用。",
      AGENT_PROTOCOL_INCOMPATIBLE:
        "Codex 生成的 App Server Schema 不满足 SpotPatch 所需协议子集。",
      CODEX_CONFIG_ISOLATION_UNSUPPORTED: "当前 Codex 版本无法证明受管配置隔离。",
      MANAGED_GRANT_INVALID: "保存的项目授权未通过校验。",
      MANAGED_PLATFORM_UNSUPPORTED: "当前平台尚未证明可安全运行受管执行。",
      MANAGED_GIT_REQUIRED: "受管执行要求项目位于 Git 仓库中。",
      MANAGED_SNAPSHOT_FAILED: "无法创建独立工作区快照。",
      MANAGED_SCOPE_VIOLATION: "候选修改超出授权路径。",
      MANAGED_CHANGE_LIMIT_EXCEEDED: "候选修改超过安全上限。",
      MANAGED_VALIDATION_FAILED: "候选修改未通过审计或验证。",
      MANAGED_WORKSPACE_CONFLICT: "执行期间授权源码发生了变化。",
      MANAGED_APPLY_FAILED: "已审计修改无法安全写入。",
      MANAGED_CLEANUP_INCOMPLETE: "受管 thread 或工作区清理不完整。",
    }),
    controlActionText: Object.freeze({
      "install-agent": "安装 Codex 后重试。",
      "use-supported-version": "改用 Schema 兼容的 Codex 版本。",
      "sign-in": "登录 Codex 后重试。",
      "choose-available-model": "选择可用模型后重新连接 Codex。",
      "use-inbox": "继续使用 Agent 收件箱降级路径。",
      "confirm-managed-access": "撤销无效授权并重新确认。",
      "review-candidate-diff": "检查候选 diff 和验证输出。",
      "review-workspace-conflict": "检查工作区变化后再重试。",
      retry: "重试受管连接。",
      "inspect-cleanup-warning": "确认清理状态后再连接。",
    }),
    resultHeader: (revision: number, outcome: ManagedValidationOutcome) =>
      `revision ${String(revision)} · 验证 ${outcome}`,
    resultDisposition: (outcome: ManagedValidationOutcome) =>
      outcome === "passed"
        ? "验证通过，修改已写入项目。"
        : `这只是候选 diff；验证状态为 ${outcome}，因此没有写入项目。`,
    resultTiming: (stage: string, durationMs: number) =>
      `耗时 ${stage}: ${String(durationMs)} ms`,
    description:
      "有主动适配器就立即派发；未连接主动适配器时，诚实降级为项目 Agent 收件箱。",
    ready: "本地 Broker 已就绪。只有连接器读取或等待后，才能证明发生过连接。",
    readyWaiting: (count: number) =>
      `当前有 ${String(count)} 个连接器等待请求，发布后可立即唤醒。`,
    activeReady: (agent: string) =>
      `${agent} 已连接并处于空闲状态，下次发送会立即派发。`,
    publishing: "正在重新授权当前源码并发布交接……",
    published: (revision: number, expiresAt: string) =>
      `交接 revision ${String(revision)} 可读取至 ${expiresAt}；这不表示代码已被修改。`,
    queued: (agent: string, revision: number) =>
      `交接 revision ${String(revision)} 已为 ${agent} 预留。`,
    dispatching: (agent: string, revision: number) =>
      `正在把 revision ${String(revision)} 派发给 ${agent}……`,
    dispatched: (agent: string, revision: number) =>
      agent === "Claude Code"
        ? `revision ${String(revision)} 已写入 Claude Channel transport；当前没有模型 ACK。`
        : `Codex App Server 已接受 revision ${String(revision)}，正在等待匹配 turn 启动。`,
    working: (agent: string, revision: number) =>
      `${agent} 正在处理 revision ${String(revision)}。`,
    completed: (agent: string, revision: number) =>
      `${agent} 已正常结束 revision ${String(revision)}。请核对 diff 和检查结果；这不证明修改要求已经正确完成。`,
    failed: (agent: string, revision: number) =>
      `${agent} 已将 revision ${String(revision)} 报告为失败，连接器已恢复空闲。`,
    unknown: (agent: string, revision: number) =>
      `revision ${String(revision)} 向 ${agent} 的投递结果不确定。受管 writer 已停止，请先核对工作区再允许新任务。`,
    unknownResolved: (agent: string, revision: number) =>
      `${agent} 的 revision ${String(revision)} 仍记为投递未知，但工作区核对已经确认；现在可以重新连接或发布新的收件箱任务。`,
    pickedUp: (revision: number, count: number, time?: string) =>
      `交接 revision ${String(revision)} 已被 ${String(count)} 个连接器实例取走${time === undefined ? "。" : `，最近取件于 ${time}。`}这不能证明代码已经修改。`,
    expired: (revision: number) =>
      `交接 revision ${String(revision)} 已过期，请核对当前选择后重新发布。`,
    superseded: (revision: number) =>
      `交接 revision ${String(revision)} 已被更新版本取代。`,
    send: "发送给 Agent",
    inboxSend: "发布到 Agent 收件箱",
    retry: "重试同一次发送",
    refresh: "刷新取件状态",
    resolveUnknown: "已核对工作区，允许新任务",
    settingsTitle: "项目连接设置",
    settingsHelp:
      "Codex 受管模式由当前开发服务托管，浏览器不会获得厂商凭证或任意命令权限；通用与 attached adapter 仍按真实能力降级为收件箱。",
    disclosureTitle: "确认发布到外部 Agent",
    disclosureIntro: (targets: number, files: number) =>
      `将发布 ${String(targets)} 个目标，涉及 ${String(files)} 个项目相对文件。`,
    disclosureData:
      "交接包含修改说明、组件与页面上下文、已清洗的 DOM/CSS，以及本地 Node 服务重新读取的有界源码。",
    disclosureInbox:
      "15 分钟有效期内，本项目中任何已配置的 SpotPatch Connector 都可能读取。",
    disclosureProvider: "Agent 宿主可能依据其产品数据策略，将内容发送给云端模型服务。",
    disclosureNoGuarantee:
      "外部修改不具备 SpotPatch 内建 Agent 的 worktree、Apply 或 Revert 保证。",
    disclosureManagedGuarantee:
      "受管 Codex 只写独立临时快照。SpotPatch 会审计 diff，且仅在所有可信 required checks 通过后才写入业务仓库。",
    cancel: "取消",
    confirm: "确认并发送",
    error: (code?: ErrorCode) =>
      code === "EXTERNAL_AGENT_BUSY"
        ? "主动 Agent 仍在工作，或存在尚未核对的投递未知状态。"
        : code === "ACTIVE_DISPATCH_INVALID"
          ? "主动投递状态已经变化，请刷新后再继续。"
          : code === "HANDOFF_SOURCE_STALE"
            ? "选中源码已经变化，请重新选择当前组件。"
            : code === "HANDOFF_RESPONSE_TOO_LARGE"
              ? "交接内容超过上限，请减少所选上下文。"
              : code === "EXTERNAL_HANDOFF_DISABLED"
                ? "可信项目配置没有启用外部 Agent 交接。"
                : code === "EXTERNAL_HANDOFF_UNAVAILABLE" || code === "SESSION_CLOSED"
                  ? "本地外部 Agent Broker 不可用，请重启开发服务。"
                  : "外部 Agent 交接请求失败，未发布任何部分 revision。",
  }),
}) satisfies Readonly<Record<SpotPatchLocale, ExternalHandoffMessages>>;

function createStyles(document: Document): HTMLStyleElement {
  const styles = document.createElement("style");
  styles.textContent = `
    ${SELECT_PICKER_STYLES}
    .spotpatch-external-handoff { margin-top: 12px; padding: 12px; border: 1px solid var(--spotpatch-border); border-radius: var(--spotpatch-radius-card); background: rgb(82 168 255 / 5%); }
    .spotpatch-external-handoff[hidden] { display: none; }
    .spotpatch-external-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .spotpatch-external-heading strong { font-size: 12px; font-weight: 680; color: var(--spotpatch-text); }
    .spotpatch-external-description, .spotpatch-external-status, .spotpatch-external-settings p { margin: 6px 0 0; font-size: 11px; line-height: 1.5; color: var(--spotpatch-text-secondary); }
    .spotpatch-external-status { padding-left: 10px; border-left: 2px solid var(--spotpatch-accent-cyan); color: #cbd5e1; }
    .spotpatch-external-status[data-state="error"] { border-color: var(--spotpatch-danger); color: #fecdd3; }
    .spotpatch-external-status[data-state="picked-up"] { border-color: var(--spotpatch-success); color: #a7f3d0; }
    .spotpatch-external-control { margin-top: 9px; padding: 9px; border: 1px solid var(--spotpatch-border); border-radius: 8px; background: rgb(3 7 18 / 28%); }
    .spotpatch-external-control-field { display: grid; gap: 5px; min-width: 0; }
    .spotpatch-external-control-field + .spotpatch-external-control-field { margin-top: 9px; }
    .spotpatch-external-control-field > label { color: var(--spotpatch-text-secondary); font-size: 10px; }
    .spotpatch-external-agent-value { box-sizing: border-box; display: flex; width: 100%; min-height: 38px; align-items: center; border: 1px solid var(--spotpatch-border); border-radius: 9px; padding: 0 11px; overflow: hidden; color: var(--spotpatch-text); background: rgb(255 255 255 / 3%); font: inherit; text-overflow: ellipsis; white-space: nowrap; }
    .spotpatch-external-control-status { margin: 7px 0 0; color: #cbd5e1; font-size: 10.5px; line-height: 1.5; white-space: pre-wrap; }
    .spotpatch-external-control-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .spotpatch-external-control-actions button { padding: 5px 8px; border: 1px solid var(--spotpatch-border); border-radius: 6px; background: var(--spotpatch-bg-active); color: var(--spotpatch-text); font: inherit; font-size: 10px; cursor: pointer; }
    .spotpatch-external-control-actions button:disabled { cursor: default; opacity: .45; }
    .spotpatch-external-result { margin-top: 8px; color: var(--spotpatch-text-secondary); font-size: 10px; }
    .spotpatch-external-result pre { max-height: 180px; overflow: auto; margin: 6px 0 0; padding: 7px; border-radius: 6px; background: var(--spotpatch-bg-input); color: #d8d6ff; font: 9px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre; }
    .spotpatch-external-settings { margin-top: 9px; }
    .spotpatch-external-settings summary { cursor: pointer; color: #c4b5fd; font-size: 11px; }
    .spotpatch-external-refresh { padding: 3px 7px; border: 1px solid var(--spotpatch-border); border-radius: 6px; background: transparent; color: var(--spotpatch-text-secondary); font: inherit; font-size: 10px; cursor: pointer; }
    .spotpatch-external-refresh:disabled { cursor: default; opacity: .45; }
    .spotpatch-external-resolve { margin-top: 8px; padding: 6px 8px; border: 1px solid #f59e0b; border-radius: 6px; background: rgb(245 158 11 / 10%); color: #fde68a; font: inherit; font-size: 10px; cursor: pointer; }
    .spotpatch-external-resolve[hidden] { display: none; }
    .spotpatch-external-resolve:disabled { cursor: default; opacity: .45; }
    .spotpatch-external-disclosure { position: fixed; inset: 0; z-index: 4; display: grid; place-items: center; padding: 20px; background: rgb(3 3 8 / 72%); backdrop-filter: blur(3px); }
    .spotpatch-external-disclosure[hidden] { display: none; }
    .spotpatch-external-disclosure-card { width: min(420px, calc(100vw - 40px)); max-height: calc(100vh - 40px); overflow: auto; padding: 18px; border: 1px solid rgb(139 123 255 / 55%); border-radius: 14px; background: var(--spotpatch-bg-raised); box-shadow: var(--spotpatch-shadow-panel); }
    .spotpatch-external-disclosure-card h3 { margin: 0; color: var(--spotpatch-text); font-size: 15px; }
    .spotpatch-external-disclosure-card p { margin: 9px 0 0; color: #c4c7d0; font-size: 11.5px; line-height: 1.55; }
    .spotpatch-external-files { max-height: 96px; overflow: auto; color: #a5b4fc; font: 10px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; }
    .spotpatch-external-disclosure-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 15px; }
    .spotpatch-external-disclosure-actions button { padding: 7px 10px; border: 1px solid var(--spotpatch-border); border-radius: 7px; background: var(--spotpatch-bg-active); color: var(--spotpatch-text); font: inherit; cursor: pointer; }
    .spotpatch-external-disclosure-actions .spotpatch-primary { border-color: transparent; background: var(--spotpatch-accent); color: var(--spotpatch-text-on-accent); }
  `;
  return styles;
}

function formatTime(value: string, locale: SpotPatchLocale): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(date);
}

function agentName(kind: ActiveAdapterSummary["kind"]): string {
  return kind === "claude-channel" ? "Claude Code" : "Codex";
}

function dispatchMessage(
  messages: ExternalHandoffMessages,
  dispatch: DispatchSummary,
): string {
  const agent = agentName(dispatch.adapterKind);

  if (dispatch.phase === "queued") {
    return messages.queued(agent, dispatch.revision);
  }
  if (dispatch.phase === "dispatching") {
    return messages.dispatching(agent, dispatch.revision);
  }
  if (dispatch.phase === "dispatched") {
    return messages.dispatched(agent, dispatch.revision);
  }
  if (dispatch.phase === "working") {
    return messages.working(agent, dispatch.revision);
  }
  if (dispatch.phase === "completed") {
    return messages.completed(agent, dispatch.revision);
  }
  if (dispatch.phase === "failed") {
    return messages.failed(agent, dispatch.revision);
  }
  return messages.unknown(agent, dispatch.revision);
}

function disclosurePaths(annotation: SpotAnnotation): readonly string[] {
  return Object.freeze([
    ...new Set(
      annotation.targets.flatMap((target) => {
        const relativePath = target.code?.relativePath ?? target.source.relativePath;
        return relativePath === undefined ? [] : [relativePath];
      }),
    ),
  ]);
}

function controlStatusText(
  value: ExternalAgentControlStatus,
  messages: ExternalHandoffMessages,
  framework: SpotPatchRuntimeConfig["framework"],
): string {
  const model = value.effectiveModel ?? value.requestedModel;
  const task = value.task;
  const parts = [
    messages.controlConnection(value.connectionState, value.mode),
    messages.controlAuth(value.authReadiness, value.grantState),
    ...(value.connectionState === "awaiting-consent" && value.grantState === "missing"
      ? [
          messages.controlConsentRequired(
            `pnpm exec spotpatch-${framework} bridge init`,
          ),
        ]
      : []),
    ...(model === undefined ? [] : [messages.controlModel(model)]),
    ...(task === undefined
      ? []
      : [
          messages.controlRevision(task),
          ...(task.validationOutcome === undefined
            ? []
            : [messages.controlValidation(task.validationOutcome)]),
        ]),
    ...(value.error === undefined
      ? []
      : [
          messages.controlFailure(
            messages.controlErrorText[value.error.code],
            messages.controlActionText[value.error.action],
          ),
        ]),
  ];
  return parts.join("\n");
}

function managedResultText(
  result: ExternalAgentManagedResult,
  messages: ExternalHandoffMessages,
): string {
  const files = result.files.map(
    (file) => `${file.path} +${String(file.additions)} -${String(file.deletions)}`,
  );
  const checks = result.checks.map(
    (check) =>
      `${check.id}: ${check.outcome} (${String(check.durationMs)} ms${check.exitCode === undefined ? "" : `, exit ${String(check.exitCode)}`})`,
  );
  const timings = Object.entries(result.timings).flatMap(([stage, durationMs]) =>
    durationMs === undefined ? [] : [messages.resultTiming(stage, durationMs)],
  );
  return [
    messages.resultHeader(result.revision, result.validationOutcome),
    messages.resultDisposition(result.validationOutcome),
    ...files,
    ...checks,
    ...timings,
  ].join("\n");
}

export function createExternalHandoffPanel(
  document: Document,
  framework: SpotPatchRuntimeConfig["framework"],
  locale: () => SpotPatchLocale,
  sessionId: string,
  subscribeLocale: (listener: () => void) => () => void,
  onViewChange: () => void,
  onDispatchChange?: (dispatch: DispatchSummary | null) => void,
  onControlChange?: (status: ExternalAgentControlStatus | undefined) => void,
): ExternalHandoffPanel {
  const options: PanelOptions = {
    document,
    framework,
    locale,
    ...(onDispatchChange === undefined ? {} : { onDispatchChange }),
    ...(onControlChange === undefined ? {} : { onControlChange }),
    onViewChange,
    sessionId,
    subscribeLocale,
  };
  let messages = MESSAGES[options.locale()];
  let activeAdapter: ActiveAdapterSummary | null = null;
  let brokerReady = false;
  let dispatchBlocksSend = false;
  let operationBusy = false;
  let retryable = false;
  let unknownDelivery = false;
  let contextReady = false;
  let controlOperationBusy = false;
  let visible = false;
  let control: ExternalAgentControlStatus | undefined;
  let managedResultValue: ExternalAgentManagedResult | undefined;
  let pendingDisclosure: ((confirmed: boolean) => void) | undefined;
  let previousFocus: HTMLElement | undefined;
  const consentKey = `spotpatch:external-handoff-consent:${options.sessionId}`;
  const root = createMarkedElement(document, "section");
  root.className = "spotpatch-external-handoff";
  root.hidden = true;
  const heading = createMarkedElement(document, "div");
  heading.className = "spotpatch-external-heading";
  heading.setAttribute("data-spotpatch-agent-identity", "");
  const title = createMarkedElement(document, "strong");
  const refreshButton = createButton(document, "", "spotpatch-external-refresh");
  heading.append(title, refreshButton);
  const description = createMarkedElement(document, "p");
  description.className = "spotpatch-external-description";
  const status = createMarkedElement(document, "p");
  status.className = "spotpatch-external-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const controlRoot = createMarkedElement(document, "div");
  controlRoot.className = "spotpatch-external-control";
  const agentField = createMarkedElement(document, "div");
  agentField.className = "spotpatch-external-control-field";
  const agentLabel = createMarkedElement(document, "label");
  const agentLabelText = createMarkedElement(document, "span");
  const agentValue = createMarkedElement(document, "div");
  agentValue.className = "spotpatch-external-agent-value";
  agentLabel.append(agentLabelText);
  agentField.append(agentLabel, agentValue);
  const modelField = createMarkedElement(document, "div");
  modelField.className = "spotpatch-external-control-field";
  const modelLabel = createMarkedElement(document, "label");
  const modelLabelText = createMarkedElement(document, "span");
  const modelPicker = createSelectPicker(document, options.onViewChange);
  const modelSelect = modelPicker.select;
  modelLabel.htmlFor = modelPicker.trigger.id;
  const modelHint = createMarkedElement(document, "p");
  modelLabel.append(modelLabelText);
  modelField.append(modelLabel, modelPicker.root);
  const controlStatus = createMarkedElement(document, "p");
  controlStatus.className = "spotpatch-external-control-status";
  controlStatus.setAttribute("role", "status");
  const controlActions = createMarkedElement(document, "div");
  controlActions.className = "spotpatch-external-control-actions";
  const connectButton = createButton(document, "");
  const disconnectButton = createButton(document, "");
  const revokeButton = createButton(document, "");
  const cancelManagedButton = createButton(document, "");
  controlActions.append(
    connectButton,
    disconnectButton,
    revokeButton,
    cancelManagedButton,
  );
  const managedResult = createMarkedElement(document, "details");
  managedResult.className = "spotpatch-external-result";
  managedResult.hidden = true;
  const managedResultTitle = createMarkedElement(document, "summary");
  const managedResultSummary = createMarkedElement(document, "p");
  const managedResultDiff = createMarkedElement(document, "pre");
  managedResult.append(managedResultTitle, managedResultSummary, managedResultDiff);
  controlRoot.append(
    agentField,
    modelField,
    modelHint,
    controlStatus,
    controlActions,
    managedResult,
  );
  const resolveButton = createButton(document, "", "spotpatch-external-resolve");
  resolveButton.hidden = true;
  const settings = createMarkedElement(document, "details");
  settings.className = "spotpatch-external-settings";
  const settingsTitle = createMarkedElement(document, "summary");
  const settingsHelp = createMarkedElement(document, "p");
  settings.append(settingsTitle, settingsHelp);
  root.append(heading, description, controlRoot, status, resolveButton, settings);

  const sendButton = createButton(document, "", "spotpatch-primary");
  sendButton.hidden = true;
  const disclosure = createMarkedElement(document, "div");
  disclosure.className = "spotpatch-external-disclosure";
  disclosure.hidden = true;
  const disclosureCard = createMarkedElement(document, "section");
  disclosureCard.className = "spotpatch-external-disclosure-card";
  disclosureCard.tabIndex = -1;
  disclosureCard.setAttribute("role", "alertdialog");
  disclosureCard.setAttribute("aria-modal", "true");
  const disclosureTitle = createMarkedElement(document, "h3");
  const disclosureIntro = createMarkedElement(document, "p");
  const disclosureFiles = createMarkedElement(document, "p");
  disclosureFiles.className = "spotpatch-external-files";
  const disclosureData = createMarkedElement(document, "p");
  const disclosureInbox = createMarkedElement(document, "p");
  const disclosureProvider = createMarkedElement(document, "p");
  const disclosureNoGuarantee = createMarkedElement(document, "p");
  const disclosureActions = createMarkedElement(document, "div");
  disclosureActions.className = "spotpatch-external-disclosure-actions";
  const cancelButton = createButton(document, "");
  const confirmButton = createButton(document, "", "spotpatch-primary");
  disclosureActions.append(cancelButton, confirmButton);
  disclosureCard.append(
    disclosureTitle,
    disclosureIntro,
    disclosureFiles,
    disclosureData,
    disclosureInbox,
    disclosureProvider,
    disclosureNoGuarantee,
    disclosureActions,
  );
  disclosure.append(disclosureCard);
  root.append(disclosure);

  const hasConsent = (): boolean => {
    try {
      return document.defaultView?.sessionStorage.getItem(consentKey) === "confirmed";
    } catch {
      return false;
    }
  };
  const rememberConsent = (): void => {
    try {
      document.defaultView?.sessionStorage.setItem(consentKey, "confirmed");
    } catch {
      // A blocked storage API only means the disclosure is shown again next time.
    }
  };
  const modelPending = (): boolean =>
    control?.mode === "managed" &&
    modelSelect.value !== "" &&
    modelSelect.value !== control.requestedModel;
  const modelChangeBlocksSend = (): boolean =>
    activeAdapter?.canDispatch === true && modelPending();
  const controlPending = (): boolean =>
    controlOperationBusy ||
    control?.connectionState === "diagnosing" ||
    control?.connectionState === "connecting" ||
    control?.connectionState === "disconnecting";
  const refreshActions = (): void => {
    sendButton.textContent = retryable
      ? messages.retry
      : activeAdapter?.canDispatch === true
        ? messages.send
        : messages.inboxSend;
    sendButton.disabled =
      !visible ||
      !brokerReady ||
      !contextReady ||
      operationBusy ||
      modelChangeBlocksSend() ||
      (!retryable && dispatchBlocksSend);
    sendButton.setAttribute("aria-busy", String(operationBusy));
    refreshButton.disabled = !visible || operationBusy;
    resolveButton.hidden = !unknownDelivery;
    resolveButton.disabled = !visible || operationBusy || !unknownDelivery;
  };
  const refreshControlActions = (): void => {
    connectButton.textContent = modelPending()
      ? messages.applyModel
      : messages.connectManaged;
    modelPicker.setDisabled(true);
    if (control === undefined) {
      connectButton.disabled = true;
      disconnectButton.disabled = true;
      revokeButton.disabled = true;
      cancelManagedButton.hidden = true;
      return;
    }
    const state = control.connectionState;
    const operationPending = controlPending();
    modelPicker.setDisabled(
      controlOperationBusy || state === "busy" || !control.models?.length,
    );
    connectButton.disabled =
      operationPending || (state === "ready" && !modelPending()) || state === "busy";
    disconnectButton.disabled = operationPending || state === "disconnected";
    revokeButton.disabled = operationPending || control.grantState !== "valid";
    const phase = control.task?.managedPhase;
    cancelManagedButton.hidden =
      phase === undefined ||
      phase === "completed" ||
      phase === "review-required" ||
      phase === "failed" ||
      phase === "cancelled" ||
      phase === "cleanup-warning";
    cancelManagedButton.disabled = operationPending;
  };
  const settleDisclosure = (confirmed: boolean): void => {
    if (pendingDisclosure === undefined) return;
    const resolve = pendingDisclosure;
    pendingDisclosure = undefined;
    disclosure.hidden = true;
    if (confirmed) rememberConsent();
    previousFocus?.focus({ preventScroll: true });
    previousFocus = undefined;
    resolve(confirmed);
    options.onViewChange();
  };
  const handleDisclosureKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      settleDisclosure(false);
      return;
    }

    if (event.key !== "Tab") return;
    const first = cancelButton;
    const last = confirmButton;
    const rootNode = disclosure.getRootNode();
    const activeElement =
      "activeElement" in rootNode ? rootNode.activeElement : document.activeElement;

    if (event.shiftKey && activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  const applyMessages = (): void => {
    messages = MESSAGES[options.locale()];
    title.textContent = messages.title;
    description.textContent = messages.description;
    refreshButton.textContent = messages.refresh;
    refreshButton.title = messages.refresh;
    settingsTitle.textContent = messages.settingsTitle;
    settingsHelp.textContent = messages.settingsHelp;
    disclosureTitle.textContent = messages.disclosureTitle;
    disclosureData.textContent = messages.disclosureData;
    disclosureInbox.textContent = messages.disclosureInbox;
    disclosureProvider.textContent = messages.disclosureProvider;
    disclosureNoGuarantee.textContent = messages.disclosureNoGuarantee;
    agentLabelText.textContent = messages.agentLabel;
    modelLabelText.textContent = messages.modelLabel;
    modelHint.textContent = messages.modelHint;
    if (modelSelect.options.length === 1 && modelSelect.options[0]?.value === "") {
      modelSelect.options[0].textContent = messages.modelLoading;
    }
    agentValue.textContent = messages.codexManaged;
    connectButton.textContent = messages.connectManaged;
    disconnectButton.textContent = messages.disconnectManaged;
    revokeButton.textContent = messages.revokeManaged;
    cancelManagedButton.textContent = messages.cancelManaged;
    managedResultTitle.textContent = messages.resultTitle;
    if (control !== undefined) {
      controlStatus.textContent = controlStatusText(control, messages, framework);
      disclosureNoGuarantee.textContent =
        control.mode === "managed"
          ? messages.disclosureManagedGuarantee
          : messages.disclosureNoGuarantee;
    }
    if (managedResultValue !== undefined) {
      managedResultSummary.textContent = managedResultText(
        managedResultValue,
        messages,
      );
    }
    cancelButton.textContent = messages.cancel;
    confirmButton.textContent = messages.confirm;
    resolveButton.textContent = messages.resolveUnknown;
    refreshActions();
    refreshControlActions();
  };

  cancelButton.addEventListener("click", () => {
    settleDisclosure(false);
  });
  confirmButton.addEventListener("click", () => {
    settleDisclosure(true);
  });
  disclosure.addEventListener("keydown", handleDisclosureKeydown);
  settings.addEventListener("toggle", options.onViewChange);
  managedResult.addEventListener("toggle", options.onViewChange);
  const handleModelChange = (): void => {
    refreshControlActions();
    refreshActions();
  };
  modelSelect.addEventListener("change", handleModelChange);
  const renderModels = (): void => {
    const previous = modelSelect.value;
    const models = control?.models ?? [];
    modelSelect.replaceChildren(
      ...(models.length ? models : [""]).map((model) => {
        const option = createMarkedElement(document, "option");
        option.value = model;
        option.textContent = model || messages.modelLoading;
        return option;
      }),
    );
    modelSelect.value = models.includes(previous)
      ? previous
      : (control?.requestedModel ?? models[0] ?? "");
    modelPicker.rebuild();
  };
  renderModels();
  const unsubscribeLocale = options.subscribeLocale(applyMessages);
  applyMessages();
  status.textContent = messages.ready;
  controlStatus.textContent =
    options.locale() === "zh-CN"
      ? "正在读取本地连接状态……"
      : "Reading local connection status…";
  refreshActions();
  refreshControlActions();

  const summaryMessage = (summary: ExternalHandoffSummary): string =>
    summary.state === "expired"
      ? messages.expired(summary.revision)
      : summary.state === "superseded"
        ? messages.superseded(summary.revision)
        : summary.pickupCount > 0
          ? messages.pickedUp(
              summary.revision,
              summary.pickupCount,
              summary.pickedUpAt === undefined
                ? undefined
                : formatTime(summary.pickedUpAt, options.locale()),
            )
          : messages.published(
              summary.revision,
              formatTime(summary.expiresAt, options.locale()),
            );

  const applyStatus = (result: ExternalHandoffStatusResult): void => {
    operationBusy = false;
    retryable = false;
    activeAdapter = result.activeAdapter;
    unknownDelivery =
      result.dispatch?.phase === "delivery-unknown" &&
      result.activeAdapter?.state === "blocked";
    dispatchBlocksSend =
      unknownDelivery ||
      (result.activeAdapter !== null && !result.activeAdapter.canDispatch);

    if (result.dispatch !== null) {
      status.dataset.state = result.dispatch.phase;
      status.textContent =
        result.dispatch.phase === "delivery-unknown" && !unknownDelivery
          ? messages.unknownResolved(
              agentName(result.dispatch.adapterKind),
              result.dispatch.revision,
            )
          : dispatchMessage(messages, result.dispatch);
    } else {
      status.dataset.state =
        result.handoff.state === "available" && result.handoff.pickupCount > 0
          ? "picked-up"
          : result.handoff.state;
      status.textContent = summaryMessage(result.handoff);
    }

    refreshActions();
    options.onDispatchChange?.(result.dispatch);
    options.onViewChange();
  };

  return Object.freeze({
    root,
    styles: createStyles(document),
    sendButton,
    refreshButton,
    resolveButton,
    cancelManagedButton,
    connectButton,
    readModel: () => modelSelect.value || undefined,
    disconnectButton,
    revokeButton,

    confirmDisclosure(annotation: SpotAnnotation): Promise<boolean> {
      if (hasConsent()) return Promise.resolve(true);
      if (pendingDisclosure !== undefined) return Promise.resolve(false);
      const paths = disclosurePaths(annotation);
      disclosureIntro.textContent = messages.disclosureIntro(
        annotation.targets.length,
        paths.length,
      );
      disclosureFiles.textContent = paths.length === 0 ? "—" : paths.join("\n");
      disclosure.hidden = false;
      const rootNode = root.getRootNode();
      const activeElement =
        "activeElement" in rootNode ? rootNode.activeElement : document.activeElement;
      previousFocus = activeElement instanceof HTMLElement ? activeElement : undefined;
      options.onViewChange();
      disclosureCard.focus({ preventScroll: true });

      return new Promise<boolean>((resolve) => {
        pendingDisclosure = resolve;
      });
    },

    renderCapability(capability: ExternalHandoffCapability): void {
      brokerReady = capability.brokerReady;
      operationBusy = false;
      retryable = false;
      activeAdapter = capability.activeAdapter;
      unknownDelivery = false;
      dispatchBlocksSend =
        capability.activeAdapter !== null && !capability.activeAdapter.canDispatch;
      status.dataset.state = capability.brokerReady ? "ready" : "error";
      status.textContent = capability.brokerReady
        ? capability.activeAdapter?.canDispatch === true
          ? messages.activeReady(agentName(capability.activeAdapter.kind))
          : capability.dispatch !== null && capability.activeAdapter !== null
            ? dispatchMessage(messages, capability.dispatch)
            : capability.activeWaitCount > 0
              ? messages.readyWaiting(capability.activeWaitCount)
              : messages.ready
        : messages.error("EXTERNAL_HANDOFF_UNAVAILABLE");
      refreshActions();
      options.onDispatchChange?.(capability.dispatch);
      options.onViewChange();
    },

    renderPublishing(): void {
      operationBusy = true;
      retryable = false;
      status.dataset.state = "publishing";
      status.textContent = messages.publishing;
      refreshActions();
      options.onViewChange();
    },

    renderPublishResult(result: ExternalHandoffPublishResult): void {
      applyStatus(
        Object.freeze({
          handoff: result.handoff,
          activeAdapter:
            result.delivery.mode === "active" ? result.delivery.adapter : null,
          dispatch: result.delivery.mode === "active" ? result.delivery.dispatch : null,
        }),
      );
    },

    renderStatus(result: ExternalHandoffStatusResult): void {
      applyStatus(result);
    },

    renderControlStatus(value: ExternalAgentControlStatus): void {
      control = value;
      renderModels();
      controlStatus.textContent = controlStatusText(value, messages, framework);
      controlStatus.dataset.state = value.connectionState;
      disclosureNoGuarantee.textContent =
        value.mode === "managed"
          ? messages.disclosureManagedGuarantee
          : messages.disclosureNoGuarantee;
      refreshControlActions();
      refreshActions();
      options.onControlChange?.(value);
      options.onViewChange();
    },

    renderControlUnavailable(): void {
      control = undefined;
      renderModels();
      controlStatus.dataset.state = "unavailable";
      controlStatus.textContent = messages.controlUnavailable;
      disclosureNoGuarantee.textContent = messages.disclosureNoGuarantee;
      refreshControlActions();
      options.onControlChange?.(undefined);
      refreshActions();
      options.onViewChange();
    },

    renderManagedResult(result: ExternalAgentManagedResult): void {
      managedResultValue = result;
      managedResult.hidden = false;
      managedResult.open = true;
      managedResultSummary.textContent = managedResultText(result, messages);
      managedResultDiff.textContent = result.diff;
      options.onViewChange();
    },

    renderError(code?: ErrorCode, canRetry = false): void {
      operationBusy = false;
      retryable = canRetry;
      if (code === "EXTERNAL_AGENT_BUSY") dispatchBlocksSend = true;
      status.dataset.state = "error";
      status.textContent = canRetry
        ? `${messages.error(code)} ${messages.retry}.`
        : messages.error(code);
      refreshActions();
      options.onDispatchChange?.(null);
      options.onViewChange();
    },

    setBusy(nextBusy: boolean): void {
      operationBusy = nextBusy;
      refreshActions();
    },

    setControlBusy(nextBusy: boolean): void {
      controlOperationBusy = nextBusy;
      refreshControlActions();
      refreshActions();
    },

    setContextReady(ready: boolean): void {
      contextReady = ready;
      refreshActions();
    },

    setSelectionVisible(nextVisible: boolean): void {
      visible = nextVisible;
      root.hidden = !nextVisible;
      sendButton.hidden = !nextVisible;
      if (!nextVisible) settleDisclosure(false);
      refreshActions();
    },

    dispose(): void {
      settleDisclosure(false);
      disclosure.removeEventListener("keydown", handleDisclosureKeydown);
      settings.removeEventListener("toggle", options.onViewChange);
      managedResult.removeEventListener("toggle", options.onViewChange);
      modelSelect.removeEventListener("change", handleModelChange);
      modelPicker.dispose();
      unsubscribeLocale();
    },
  });
}
