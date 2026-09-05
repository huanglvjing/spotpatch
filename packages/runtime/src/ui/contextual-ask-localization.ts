import type {
  AskAnswerWarningCode,
  AskJobStatus,
  ErrorCode,
} from "@spotpatch/shared/contextual-ask-browser";
import type { SpotPatchLocale } from "@spotpatch/shared";

export interface ContextualAskMessages {
  readonly mode: Readonly<{ ask: string; change: string; label: string }>;
  readonly title: string;
  readonly subtitle: string;
  readonly questionLabel: string;
  readonly questionPlaceholder: string;
  readonly suggestionsLabel: string;
  readonly suggestions: readonly string[];
  readonly executorLabel: string;
  readonly modelLabel: string;
  readonly loadingExecutors: string;
  readonly noExecutor: string;
  readonly unavailable: string;
  readonly consent: string;
  readonly dataSummary: (targets: number, sources: number) => string;
  readonly safety: string;
  readonly submit: string;
  readonly cancel: string;
  readonly newQuestion: string;
  readonly copy: string;
  readonly convert: string;
  readonly answerTitle: string;
  readonly sourcesTitle: string;
  readonly stale: string;
  readonly convertedTitle: string;
  readonly convertedBody: string;
  readonly status: Readonly<Record<AskJobStatus, string>>;
  readonly sourceLabel: (path: string, start: number, end: number) => string;
  readonly readSource: (path: string) => string;
  readonly readFiles: (bucket: string) => string;
  readonly copied: string;
  readonly copyFailed: string;
  readonly sourceOpenFailed: string;
  readonly converted: string;
  readonly error: (code?: ErrorCode) => string;
  readonly warning: (code: AskAnswerWarningCode) => string;
}

const EN: ContextualAskMessages = Object.freeze({
  mode: Object.freeze({ ask: "Ask", change: "Change", label: "Task mode" }),
  title: "Ask about this selection",
  subtitle: "One question, one sourced answer. SpotPatch will not write code.",
  questionLabel: "Question",
  questionPlaceholder: "What does this component do?",
  suggestionsLabel: "Suggested questions",
  suggestions: Object.freeze([
    "What does this component do?",
    "Where does its data come from?",
    "Why is it implemented this way?",
  ]),
  executorLabel: "Read-only executor",
  modelLabel: "Model",
  loadingExecutors: "Checking available executors…",
  noExecutor: "No verified read-only executor is available.",
  unavailable: "unavailable",
  consent:
    "Allow the selected source snapshot to be sent to this provider for this answer.",
  dataSummary: (targets: number, sources: number) =>
    `${String(targets)} selected element${targets === 1 ? "" : "s"} · ${String(sources)} source-backed`,
  safety: "Single turn · read-only · no history",
  submit: "Ask",
  cancel: "Cancel",
  newQuestion: "Start over",
  copy: "Copy answer",
  convert: "Turn into change request",
  answerTitle: "Answer",
  sourcesTitle: "Sources",
  stale: "The selection changed after this answer. Ask again before relying on it.",
  convertedTitle: "From contextual answer",
  convertedBody:
    "The answer and source references remain local and have not started a change.",
  status: Object.freeze({
    queued: "Queued",
    authorizing: "Verifying read-only access",
    running: "Analyzing selected source",
    cancelling: "Cancelling",
    answered: "Answer ready",
    cancelled: "Cancelled",
    failed: "Could not answer",
  }),
  sourceLabel: (path: string, start: number, end: number) =>
    `${path}:${String(start)}${end === start ? "" : `–${String(end)}`}`,
  readSource: (path: string) => `Reading ${path}`,
  readFiles: (bucket: string) => `Reading ${bucket} files`,
  copied: "Answer copied.",
  copyFailed: "The answer could not be copied.",
  sourceOpenFailed: "The source could not be opened.",
  converted: "Switched to Change with the answer attached as local context.",
  error: (code?: ErrorCode) => {
    const errors: Partial<Record<ErrorCode, string>> = {
      INVALID_TOKEN: "The local SpotPatch session expired. Refresh the page.",
      ORIGIN_NOT_ALLOWED:
        "The local request failed its same-origin security check. Refresh or restart the dev server.",
      ASK_DISABLED: "Contextual Ask is disabled.",
      ASK_SELECTION_REQUIRED: "Select at least one element first.",
      ASK_SELECTION_STALE:
        "The selected source changed. Refresh the selection and ask again.",
      ASK_QUESTION_INVALID: "Enter one valid question.",
      ASK_EXECUTOR_UNAVAILABLE: "The selected read-only executor is unavailable.",
      ASK_TIMEOUT:
        "The read-only executor took too long to answer. Try the question again.",
      ASK_CONSENT_REQUIRED: "Confirm provider data access for this answer.",
      ASK_BUSY: "Another workspace task is active. Try again when it finishes.",
      ASK_CANCELLED: "The question was cancelled.",
      ASK_RESULT_EXPIRED: "This answer has expired. Ask again.",
      ASK_WRITE_ATTEMPTED: "The executor attempted a write and was stopped.",
      ASK_ANSWER_INVALID: "The executor returned an invalid sourced answer.",
      ASK_PROTOCOL_INCOMPATIBLE: "The executor protocol is incompatible.",
      ASK_LIMIT_EXCEEDED: "The selected context is too large.",
      ASK_SOURCE_SCOPE_DENIED: "A requested source was outside the granted snapshot.",
    };
    return code === undefined
      ? "SpotPatch could not complete this question."
      : (errors[code] ?? "SpotPatch could not complete this question.");
  },
  warning: (code: AskAnswerWarningCode) =>
    code === "insufficient-evidence"
      ? "The selected source did not contain enough evidence for a complete answer."
      : "Some source references were omitted because they could not be verified.",
});

const ZH: ContextualAskMessages = Object.freeze({
  mode: Object.freeze({ ask: "问答", change: "修改", label: "任务模式" }),
  title: "询问所选元素",
  subtitle: "一次提问，一次带源码引用的回答；SpotPatch 不会写入代码。",
  questionLabel: "问题",
  questionPlaceholder: "这个组件是做什么的？",
  suggestionsLabel: "推荐问题",
  suggestions: Object.freeze([
    "这个组件是做什么的？",
    "它的数据从哪里来？",
    "为什么要这样实现？",
  ]),
  executorLabel: "只读执行器",
  modelLabel: "模型",
  loadingExecutors: "正在检查可用执行器…",
  noExecutor: "目前没有通过只读验证的执行器。",
  unavailable: "不可用",
  consent: "允许本次回答将所选源码快照发送给该提供商。",
  dataSummary: (targets: number, sources: number) =>
    `${String(targets)} 个已选元素 · ${String(sources)} 个具备源码上下文`,
  safety: "单轮 · 只读 · 不保存历史",
  submit: "提问",
  cancel: "取消",
  newQuestion: "重新开始",
  copy: "复制回答",
  convert: "转成修改请求",
  answerTitle: "回答",
  sourcesTitle: "源码引用",
  stale: "回答后选择已发生变化。请重新提问后再采信此回答。",
  convertedTitle: "来自上下文问答",
  convertedBody: "回答与源码引用仅作为本地上下文保留，尚未发起任何修改。",
  status: Object.freeze({
    queued: "已排队",
    authorizing: "正在验证只读权限",
    running: "正在分析所选源码",
    cancelling: "正在取消",
    answered: "回答已就绪",
    cancelled: "已取消",
    failed: "无法回答",
  }),
  sourceLabel: (path: string, start: number, end: number) =>
    `${path}:${String(start)}${end === start ? "" : `–${String(end)}`}`,
  readSource: (path: string) => `正在读取 ${path}`,
  readFiles: (bucket: string) => `正在读取 ${bucket} 个文件`,
  copied: "回答已复制。",
  copyFailed: "无法复制回答。",
  sourceOpenFailed: "无法打开源码。",
  converted: "已切换到修改模式，并把回答作为本地上下文附带。",
  error: (code?: ErrorCode) => {
    const errors: Partial<Record<ErrorCode, string>> = {
      INVALID_TOKEN: "本地 SpotPatch 会话已失效，请刷新页面。",
      ORIGIN_NOT_ALLOWED: "本地请求未通过同源安全校验，请刷新页面或重启开发服务。",
      ASK_DISABLED: "上下文问答未启用。",
      ASK_SELECTION_REQUIRED: "请先选择至少一个元素。",
      ASK_SELECTION_STALE: "所选源码已经变化，请刷新选择后重新提问。",
      ASK_QUESTION_INVALID: "请输入一个有效的问题。",
      ASK_EXECUTOR_UNAVAILABLE: "所选只读执行器当前不可用。",
      ASK_TIMEOUT: "只读执行器未能在限定时间内返回回答，请重新提问。",
      ASK_CONSENT_REQUIRED: "请确认本次回答的提供商数据访问。",
      ASK_BUSY: "工作区正在执行其他任务，请稍后重试。",
      ASK_CANCELLED: "本次提问已取消。",
      ASK_RESULT_EXPIRED: "回答已过期，请重新提问。",
      ASK_WRITE_ATTEMPTED: "执行器尝试写入，已被阻止。",
      ASK_ANSWER_INVALID: "执行器返回的带引用回答无效。",
      ASK_PROTOCOL_INCOMPATIBLE: "执行器协议不兼容。",
      ASK_LIMIT_EXCEEDED: "所选上下文过大。",
      ASK_SOURCE_SCOPE_DENIED: "请求的源码超出了授权快照范围。",
    };
    return code === undefined
      ? "SpotPatch 未能完成本次提问。"
      : (errors[code] ?? "SpotPatch 未能完成本次提问。");
  },
  warning: (code: AskAnswerWarningCode) =>
    code === "insufficient-evidence"
      ? "所选源码不足以支持完整回答。"
      : "部分源码引用因无法验证而被省略。",
});

export function contextualAskMessages(locale: SpotPatchLocale): ContextualAskMessages {
  return locale === "zh-CN" ? ZH : EN;
}
