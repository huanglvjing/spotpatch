import type {
  ActiveAdapterSummary,
  DispatchSummary,
  ErrorCode,
  ExternalHandoffCapability,
  ExternalHandoffPublishResult,
  ExternalHandoffStatusResult,
  ExternalHandoffSummary,
  SpotAnnotation,
  SpotPatchLocale,
} from "@spotpatch/shared/external-handoff-browser";

import { createButton, createMarkedElement } from "./dom.js";
import type { ExternalHandoffPanel } from "./external-handoff-contract.js";

interface PanelOptions {
  readonly document: Document;
  readonly framework: "vite" | "next";
  readonly locale: () => SpotPatchLocale;
  readonly onViewChange: () => void;
  readonly sessionId: string;
  readonly subscribeLocale: (listener: () => void) => () => void;
}

interface ExternalHandoffMessages {
  readonly activeReady: (agent: string) => string;
  readonly cancel: string;
  readonly confirm: string;
  readonly completed: (agent: string, revision: number) => string;
  readonly description: string;
  readonly dispatched: (agent: string, revision: number) => string;
  readonly dispatching: (agent: string, revision: number) => string;
  readonly disclosureData: string;
  readonly disclosureInbox: string;
  readonly disclosureIntro: (targets: number, files: number) => string;
  readonly disclosureNoGuarantee: string;
  readonly disclosureProvider: string;
  readonly disclosureTitle: string;
  readonly error: (code?: ErrorCode) => string;
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
  readonly resolveUnknown: string;
  readonly retry: string;
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
      "Setup commands are project-scoped dry runs; append --write only after review. Claude active mode also needs the shown Research Preview launch flag. Codex active mode is zero-setup: run its explicit connector command and keep it open.",
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
      "setup 命令均为项目级 dry-run，核对后才追加 --write。Claude 主动模式还需使用下方 Research Preview 启动参数；Codex 主动模式无需 setup，只需显式启动并保持 Connector 命令运行。",
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
    .spotpatch-external-handoff { margin-top: 12px; padding: 12px; border: 1px solid var(--spotpatch-border); border-radius: var(--spotpatch-radius-card); background: rgb(82 168 255 / 5%); }
    .spotpatch-external-handoff[hidden] { display: none; }
    .spotpatch-external-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .spotpatch-external-heading strong { font-size: 12px; font-weight: 680; color: var(--spotpatch-text); }
    .spotpatch-external-description, .spotpatch-external-status, .spotpatch-external-settings p { margin: 6px 0 0; font-size: 11px; line-height: 1.5; color: var(--spotpatch-text-secondary); }
    .spotpatch-external-status { padding-left: 10px; border-left: 2px solid var(--spotpatch-accent-cyan); color: #cbd5e1; }
    .spotpatch-external-status[data-state="error"] { border-color: var(--spotpatch-danger); color: #fecdd3; }
    .spotpatch-external-status[data-state="picked-up"] { border-color: var(--spotpatch-success); color: #a7f3d0; }
    .spotpatch-external-settings { margin-top: 9px; }
    .spotpatch-external-settings summary { cursor: pointer; color: #c4b5fd; font-size: 11px; }
    .spotpatch-external-command { display: block; margin-top: 6px; padding: 6px 8px; overflow: auto; border-radius: 6px; background: var(--spotpatch-bg-input); color: #d8d6ff; font: 10px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; }
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

export function createExternalHandoffPanel(
  document: Document,
  framework: "vite" | "next",
  locale: () => SpotPatchLocale,
  sessionId: string,
  subscribeLocale: (listener: () => void) => () => void,
  onViewChange: () => void,
): ExternalHandoffPanel {
  const options: PanelOptions = {
    document,
    framework,
    locale,
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
  let visible = false;
  let pendingDisclosure: ((confirmed: boolean) => void) | undefined;
  let previousFocus: HTMLElement | undefined;
  const consentKey = `spotpatch:external-handoff-consent:${options.sessionId}`;
  const root = createMarkedElement(document, "section");
  root.className = "spotpatch-external-handoff";
  root.hidden = true;
  const heading = createMarkedElement(document, "div");
  heading.className = "spotpatch-external-heading";
  const title = createMarkedElement(document, "strong");
  const refreshButton = createButton(document, "", "spotpatch-external-refresh");
  heading.append(title, refreshButton);
  const description = createMarkedElement(document, "p");
  description.className = "spotpatch-external-description";
  const status = createMarkedElement(document, "p");
  status.className = "spotpatch-external-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const resolveButton = createButton(document, "", "spotpatch-external-resolve");
  resolveButton.hidden = true;
  const settings = createMarkedElement(document, "details");
  settings.className = "spotpatch-external-settings";
  const settingsTitle = createMarkedElement(document, "summary");
  const settingsHelp = createMarkedElement(document, "p");
  const cliPrefix = `node ./node_modules/@spotpatch/${options.framework}/dist/cli.js`;
  const bridgePrefix = `${cliPrefix} bridge`;
  const commands = [
    `${bridgePrefix} setup --client claude --scope project --mode active`,
    "MCP_PROTOCOL_NEGOTIATION=legacy claude --dangerously-load-development-channels server:spotpatch",
    `${cliPrefix} connect codex --allow-workspace-write`,
    `${bridgePrefix} setup --client cursor --scope project`,
  ].map((value) => {
    const command = createMarkedElement(document, "code");
    command.className = "spotpatch-external-command";
    command.textContent = value;
    return command;
  });
  settings.append(settingsTitle, settingsHelp, ...commands);
  root.append(heading, description, status, resolveButton, settings);

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
      (!retryable && dispatchBlocksSend);
    sendButton.setAttribute("aria-busy", String(operationBusy));
    refreshButton.disabled = !visible || operationBusy;
    resolveButton.hidden = !unknownDelivery;
    resolveButton.disabled = !visible || operationBusy || !unknownDelivery;
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
    cancelButton.textContent = messages.cancel;
    confirmButton.textContent = messages.confirm;
    resolveButton.textContent = messages.resolveUnknown;
    refreshActions();
  };

  cancelButton.addEventListener("click", () => {
    settleDisclosure(false);
  });
  confirmButton.addEventListener("click", () => {
    settleDisclosure(true);
  });
  disclosure.addEventListener("keydown", handleDisclosureKeydown);
  settings.addEventListener("toggle", options.onViewChange);
  const unsubscribeLocale = options.subscribeLocale(applyMessages);
  applyMessages();
  status.textContent = messages.ready;
  refreshActions();

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
    options.onViewChange();
  };

  return Object.freeze({
    root,
    styles: createStyles(document),
    sendButton,
    refreshButton,
    resolveButton,

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

    renderError(code?: ErrorCode, canRetry = false): void {
      operationBusy = false;
      retryable = canRetry;
      if (code === "EXTERNAL_AGENT_BUSY") dispatchBlocksSend = true;
      status.dataset.state = "error";
      status.textContent = canRetry
        ? `${messages.error(code)} ${messages.retry}.`
        : messages.error(code);
      refreshActions();
      options.onViewChange();
    },

    setBusy(nextBusy: boolean): void {
      operationBusy = nextBusy;
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
      unsubscribeLocale();
    },
  });
}
