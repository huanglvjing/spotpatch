import type {
  AskAnswerResult,
  AskDraftOrigin,
  AskJobEvent,
  AskJobSnapshot,
  AskSourceReference,
  ContextualAskCapability,
  ErrorCode,
} from "@spotpatch/shared/contextual-ask-browser";

import { createSelectPicker, SELECT_PICKER_STYLES } from "./ask-picker.js";
import { createButton, createMarkedElement } from "./dom.js";
import type {
  ContextualAskPanel,
  ContextualAskSelectionPreview,
} from "./contextual-ask-contract.js";
import {
  contextualAskMessages,
  type ContextualAskMessages,
} from "./contextual-ask-localization.js";
import type { FloatingSurfaceProjection } from "./motion-extension-contract.js";

interface CreateContextualAskPanelInput {
  readonly document: Document;
  readonly locale: Parameters<typeof contextualAskMessages>[0] extends never
    ? never
    : () => Parameters<typeof contextualAskMessages>[0];
  readonly subscribeLocale: (listener: () => void) => () => void;
  readonly changeRoot: HTMLElement;
  readonly changeActions: HTMLElement;
  readonly announce: (message: string) => void;
  readonly onModeChange: (
    mode: "ask" | "change",
    title: string,
    subtitle: string,
  ) => void;
  readonly onExecutionChange: (projection?: FloatingSurfaceProjection) => void;
  readonly onViewChange: () => void;
}

/** Later answer items share the last delay so long answers settle quickly. */
const MAXIMUM_STAGGERED_ANSWER_ITEMS = 8;

function createStyles(document: Document): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = `
    ${SELECT_PICKER_STYLES}
    .spotpatch-ask-mode { position: relative; isolation: isolate; display: grid; grid-template-columns: 1fr 1fr; gap: 3px; margin-bottom: 14px; padding: 3px; border: 1px solid var(--spotpatch-border-subtle); border-radius: var(--spotpatch-radius-md); background: var(--spotpatch-bg-input); }
    .spotpatch-ask-mode::before { position: absolute; z-index: -1; top: 3px; bottom: 3px; left: 3px; width: calc(50% - 4.5px); border-radius: var(--spotpatch-radius-sm); background: var(--spotpatch-bg-active); box-shadow: var(--spotpatch-shadow-inset), 0 0 0 1px var(--spotpatch-border); content: ""; transition: transform var(--spotpatch-duration-slow) var(--spotpatch-ease-out); }
    .spotpatch-ask-mode[data-mode="change"]::before { transform: translateX(calc(100% + 3px)); }
    .spotpatch-ask-mode button { min-height: 32px; border: 0; border-radius: var(--spotpatch-radius-sm); color: var(--spotpatch-text-secondary); background: transparent; cursor: pointer; font-size: 12.5px; font-weight: 600; transition: color var(--spotpatch-duration-base) ease; }
    .spotpatch-ask-mode button:hover, .spotpatch-ask-mode button[aria-selected="true"] { color: var(--spotpatch-text); }
    .spotpatch-ask-panel { display: grid; gap: 14px; }
    .spotpatch-ask-panel[data-phase="answered"] > :is(.spotpatch-ask-field, .spotpatch-ask-safety) { display: none; }
    .spotpatch-ask-field { display: grid; gap: 7px; min-width: 0; }
    .spotpatch-ask-field > label, .spotpatch-ask-label { color: var(--spotpatch-text-secondary); font-size: 11.5px; font-weight: 600; }
    .spotpatch-ask-question { box-sizing: border-box; width: 100%; min-height: 92px; resize: vertical; border: 1px solid var(--spotpatch-border); border-radius: var(--spotpatch-radius-md); padding: 10px 12px; outline: none; color: var(--spotpatch-text); background: var(--spotpatch-bg-input); font-size: 13px; line-height: 1.55; transition: border-color var(--spotpatch-duration-fast) ease, box-shadow var(--spotpatch-duration-fast) ease; }
    .spotpatch-ask-question::placeholder { color: var(--spotpatch-text-muted); }
    .spotpatch-ask-question:focus { border-color: var(--spotpatch-accent-line); box-shadow: 0 0 0 3px var(--spotpatch-accent-tint); }
    .spotpatch-ask-suggestions { display: flex; flex-wrap: wrap; gap: 6px; }
    .spotpatch-ask-suggestions button { border: 1px dashed var(--spotpatch-accent-line); border-radius: var(--spotpatch-radius-pill); padding: 4px 10px; color: var(--spotpatch-accent-soft); background: transparent; cursor: pointer; font-size: 11.5px; transition: background var(--spotpatch-duration-fast) ease; }
    .spotpatch-ask-suggestions button:hover { background: var(--spotpatch-accent-tint); }
    .spotpatch-ask-executor-status { margin: 0; border-left: 2px solid var(--spotpatch-warning); padding-left: 8px; color: var(--spotpatch-warning-text); font-size: 11.5px; line-height: 1.45; }
    .spotpatch-ask-safety { display: grid; gap: 8px; border: 1px solid var(--spotpatch-cyan-line); border-radius: var(--spotpatch-radius-md); padding: 10px 12px; background: var(--spotpatch-cyan-tint); }
    .spotpatch-ask-data { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 10px; color: var(--spotpatch-text-secondary); font-size: 11.5px; }
    .spotpatch-ask-data strong { color: var(--spotpatch-success-text); font-weight: 600; white-space: nowrap; }
    .spotpatch-ask-consent { display: grid; grid-template-columns: 16px 1fr; gap: 8px; align-items: start; color: var(--spotpatch-text-secondary); cursor: pointer; font-size: 11.5px; line-height: 1.45; }
    .spotpatch-ask-consent input { margin: 2px 0 0; accent-color: var(--spotpatch-accent); }
    .spotpatch-ask-actions { position: sticky; bottom: 0; z-index: 1; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; padding: 10px 0 2px; background: var(--spotpatch-bg); box-shadow: 0 -14px 14px -6px var(--spotpatch-bg); }
    .spotpatch-ask-actions button { min-height: 36px; border: 1px solid var(--spotpatch-border); border-radius: var(--spotpatch-radius-md); padding: 0 12px; color: var(--spotpatch-text); background: var(--spotpatch-bg-raised); cursor: pointer; font-size: 12.5px; font-weight: 600; transition: border-color var(--spotpatch-duration-fast) ease, background var(--spotpatch-duration-fast) ease; }
    .spotpatch-ask-actions button:hover:not(:disabled) { border-color: var(--spotpatch-border-strong); background: var(--spotpatch-bg-active); }
    .spotpatch-ask-actions .spotpatch-primary { border-color: transparent; color: var(--spotpatch-text-on-accent); background: var(--spotpatch-primary-fill); box-shadow: var(--spotpatch-shadow-accent), var(--spotpatch-shadow-inset); }
    .spotpatch-ask-actions .spotpatch-primary:hover:not(:disabled) { border-color: transparent; background: var(--spotpatch-primary-fill); filter: brightness(1.1); }
    .spotpatch-ask-actions button:disabled { box-shadow: none; cursor: not-allowed; opacity: .4; }
    .spotpatch-ask-status { display: grid; gap: 7px; border-left: 2px solid var(--spotpatch-accent); padding: 2px 0 2px 10px; color: var(--spotpatch-text-secondary); font-size: 12px; animation: spotpatch-enter var(--spotpatch-duration-slow) var(--spotpatch-ease-out) both; }
    .spotpatch-ask-activity { display: grid; gap: 4px; color: var(--spotpatch-text-muted); font: 500 11px/1.45 var(--spotpatch-font-mono); }
    .spotpatch-ask-error, .spotpatch-ask-stale, .spotpatch-ask-warning { border-radius: var(--spotpatch-radius-sm); padding: 9px 10px; font-size: 11.5px; }
    .spotpatch-ask-error { color: var(--spotpatch-danger-text); background: var(--spotpatch-danger-tint); }
    .spotpatch-ask-stale, .spotpatch-ask-warning { color: var(--spotpatch-warning-text); background: var(--spotpatch-warning-tint); }
    .spotpatch-ask-answer { display: grid; gap: 12px; border: 1px solid var(--spotpatch-border-subtle); border-radius: var(--spotpatch-radius-card); padding: 14px; background: var(--spotpatch-bg-raised); box-shadow: var(--spotpatch-shadow-inset); }
    .spotpatch-ask-answer[data-entering="true"] { animation: spotpatch-enter var(--spotpatch-duration-slow) var(--spotpatch-ease-out) both; }
    .spotpatch-ask-answer[data-entering="true"] [data-ask-order] { --spotpatch-ask-order: 0; animation: spotpatch-enter var(--spotpatch-duration-slow) var(--spotpatch-ease-out) both; animation-delay: calc(140ms + var(--spotpatch-ask-order) * 55ms); }
    .spotpatch-ask-recap { display: grid; gap: 3px; border-left: 2px solid var(--spotpatch-accent-line); padding: 1px 0 1px 10px; }
    .spotpatch-ask-recap span { color: var(--spotpatch-text-muted); font-size: 10.5px; font-weight: 600; letter-spacing: .02em; }
    .spotpatch-ask-recap p { margin: 0; color: var(--spotpatch-text-secondary); font-size: 12.5px; line-height: 1.5; overflow-wrap: anywhere; }
    .spotpatch-ask-answer-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; min-width: 0; }
    .spotpatch-ask-answer-meta { overflow: hidden; color: var(--spotpatch-text-muted); font: 500 10.5px/1.3 var(--spotpatch-font-mono); text-overflow: ellipsis; white-space: nowrap; }
    .spotpatch-ask-answer h3, .spotpatch-ask-sources h4 { margin: 0; font-size: 13px; font-weight: 620; }
    .spotpatch-ask-blocks { display: grid; gap: 10px; font-size: 13px; line-height: 1.65; overflow-wrap: anywhere; }
    .spotpatch-ask-blocks p, .spotpatch-ask-blocks ul { margin: 0; }
    .spotpatch-ask-blocks ul { padding-left: 18px; }
    .spotpatch-ask-inline-code { border: 1px solid var(--spotpatch-border-subtle); border-radius: var(--spotpatch-radius-xs); padding: 1px 5px; color: var(--spotpatch-accent-soft); background: var(--spotpatch-bg-input); font: 500 .88em/1.4 var(--spotpatch-font-mono); }
    .spotpatch-ask-blocks pre { max-width: 100%; overflow: auto; margin: 0; border: 1px solid var(--spotpatch-border-subtle); border-radius: var(--spotpatch-radius-sm); padding: 10px; background: var(--spotpatch-bg-input); font: 500 11px/1.55 var(--spotpatch-font-mono); }
    .spotpatch-ask-citations, .spotpatch-ask-source-list { display: flex; flex-wrap: wrap; gap: 6px; }
    .spotpatch-ask-source { max-width: 100%; overflow: hidden; border: 1px solid var(--spotpatch-cyan-line); border-radius: var(--spotpatch-radius-pill); padding: 4px 9px; color: var(--spotpatch-cyan-text); background: var(--spotpatch-cyan-tint); cursor: pointer; font: 500 10.5px/1.3 var(--spotpatch-font-mono); text-overflow: ellipsis; white-space: nowrap; transition: border-color var(--spotpatch-duration-fast) ease; }
    .spotpatch-ask-source:hover { border-color: var(--spotpatch-accent-cyan); }
    .spotpatch-ask-sources { display: grid; gap: 7px; }
    .spotpatch-ask-origin { margin-bottom: 12px; border: 1px solid var(--spotpatch-accent-line); border-radius: var(--spotpatch-radius-md); padding: 10px 12px; color: var(--spotpatch-text-secondary); background: var(--spotpatch-accent-tint); font-size: 11.5px; }
    .spotpatch-ask-origin strong { display: block; margin-bottom: 2px; color: var(--spotpatch-accent-soft); font-size: 12px; }
    @media (max-width: 420px) { .spotpatch-ask-actions { justify-content: stretch; } .spotpatch-ask-actions button { flex: 1 1 auto; } }
  `;
  return style;
}

const INLINE_CODE = /`([^`\n]+)`/gu;

/** Renders `code` spans as text-only elements; nothing is parsed as HTML. */
function appendInlineText(document: Document, root: HTMLElement, text: string): void {
  let offset = 0;
  for (const match of text.matchAll(INLINE_CODE)) {
    root.append(text.slice(offset, match.index));
    const code = createMarkedElement(document, "code");
    code.className = "spotpatch-ask-inline-code";
    code.textContent = match[1] ?? "";
    root.append(code);
    offset = match.index + match[0].length;
  }
  root.append(text.slice(offset));
}

function appendSourceChips(
  document: Document,
  root: HTMLElement,
  sourceIds: readonly string[],
  sources: ReadonlyMap<string, AskSourceReference>,
  messages: ContextualAskMessages,
): void {
  if (sourceIds.length === 0) return;
  const chips = createMarkedElement(document, "div");
  chips.className = "spotpatch-ask-citations";
  for (const sourceId of sourceIds) {
    const source = sources.get(sourceId);
    if (source === undefined) continue;
    const chip = createButton(
      document,
      messages.sourceLabel(source.relativePath, source.startLine, source.endLine),
      "spotpatch-ask-source",
    );
    chip.dataset.askSourceId = source.sourceId;
    chip.title = source.label;
    chips.append(chip);
  }
  root.append(chips);
}

export function createContextualAskPanel(
  input: CreateContextualAskPanelInput,
): ContextualAskPanel {
  const { document } = input;
  let messages = contextualAskMessages(input.locale());
  let currentMode: "ask" | "change" = "change";
  let currentCapability: ContextualAskCapability | undefined;
  let currentResult: AskAnswerResult | undefined;
  let currentJob: AskJobSnapshot | undefined;
  let reportedMode: "ask" | "change" | undefined;
  let reportedTitle = "";
  let reportedSubtitle = "";
  let currentPreview: ContextualAskSelectionPreview = Object.freeze({
    contextReady: false,
    targetCount: 0,
    sourceCount: 0,
  });
  let busy = false;
  let renderedJobId: string | undefined;

  const root = createMarkedElement(document, "section");
  const modeSwitch = createMarkedElement(document, "div");
  modeSwitch.className = "spotpatch-ask-mode";
  modeSwitch.setAttribute("role", "tablist");
  const askTab = createButton(document, "");
  const changeTab = createButton(document, "");
  askTab.setAttribute("role", "tab");
  changeTab.setAttribute("role", "tab");
  modeSwitch.append(askTab, changeTab);

  const origin = createMarkedElement(document, "aside");
  origin.className = "spotpatch-ask-origin";
  origin.hidden = true;
  const originTitle = createMarkedElement(document, "strong");
  const originBody = createMarkedElement(document, "span");
  origin.append(originTitle, originBody);

  const askPanel = createMarkedElement(document, "div");
  askPanel.className = "spotpatch-ask-panel";
  const questionField = createMarkedElement(document, "div");
  questionField.className = "spotpatch-ask-field";
  const questionLabel = createMarkedElement(document, "label");
  const questionId = `spotpatch-ask-question-${Math.random().toString(36).slice(2)}`;
  questionLabel.htmlFor = questionId;
  const questionInput = createMarkedElement(document, "textarea");
  questionInput.id = questionId;
  questionInput.className = "spotpatch-ask-question";
  questionInput.maxLength = 4_000;
  const suggestions = createMarkedElement(document, "div");
  suggestions.className = "spotpatch-ask-suggestions";
  suggestions.setAttribute("aria-label", "");
  questionField.append(questionLabel, questionInput, suggestions);

  const executorField = createMarkedElement(document, "div");
  executorField.className = "spotpatch-ask-field";
  const executorLabel = createMarkedElement(document, "label");
  const executorPicker = createSelectPicker(document, input.onViewChange);
  const executorSelect = executorPicker.select;
  executorLabel.htmlFor = executorPicker.trigger.id;
  const modelField = createMarkedElement(document, "div");
  modelField.className = "spotpatch-ask-field";
  const modelLabel = createMarkedElement(document, "label");
  const modelPicker = createSelectPicker(document, input.onViewChange);
  modelLabel.htmlFor = modelPicker.trigger.id;
  modelField.append(modelLabel, modelPicker.root);
  let modelExecutorId: string | undefined;
  const executorStatus = createMarkedElement(document, "p");
  executorStatus.className = "spotpatch-ask-executor-status";
  executorStatus.setAttribute("role", "status");
  executorStatus.hidden = true;
  executorField.append(executorLabel, executorPicker.root, executorStatus);

  const safety = createMarkedElement(document, "div");
  safety.className = "spotpatch-ask-safety";
  const dataSummary = createMarkedElement(document, "div");
  dataSummary.className = "spotpatch-ask-data";
  const dataText = createMarkedElement(document, "span");
  const safetyText = createMarkedElement(document, "strong");
  dataSummary.append(dataText, safetyText);
  const consentLabel = createMarkedElement(document, "label");
  consentLabel.className = "spotpatch-ask-consent";
  const consentCheckbox = createMarkedElement(document, "input");
  consentCheckbox.type = "checkbox";
  const consentText = createMarkedElement(document, "span");
  consentLabel.append(consentCheckbox, consentText);
  safety.append(dataSummary, consentLabel);

  const status = createMarkedElement(document, "div");
  status.className = "spotpatch-ask-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;
  const statusText = createMarkedElement(document, "strong");
  const activities = createMarkedElement(document, "div");
  activities.className = "spotpatch-ask-activity";
  status.append(statusText, activities);
  const error = createMarkedElement(document, "div");
  error.className = "spotpatch-ask-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  const actions = createMarkedElement(document, "div");
  actions.className = "spotpatch-ask-actions";
  const newQuestionButton = createButton(document, "");
  const cancelButton = createButton(document, "");
  const copyButton = createButton(document, "");
  const convertButton = createButton(document, "", "spotpatch-primary");
  const submitButton = createButton(document, "", "spotpatch-primary");
  cancelButton.hidden = true;
  actions.append(
    newQuestionButton,
    cancelButton,
    copyButton,
    convertButton,
    submitButton,
  );

  const answer = createMarkedElement(document, "article");
  answer.className = "spotpatch-ask-answer";
  answer.hidden = true;
  const stale = createMarkedElement(document, "div");
  stale.className = "spotpatch-ask-stale";
  stale.hidden = true;
  const recap = createMarkedElement(document, "div");
  recap.className = "spotpatch-ask-recap";
  const recapLabel = createMarkedElement(document, "span");
  const recapText = createMarkedElement(document, "p");
  recap.append(recapLabel, recapText);
  const answerHead = createMarkedElement(document, "div");
  answerHead.className = "spotpatch-ask-answer-head";
  const answerTitle = createMarkedElement(document, "h3");
  const answerMeta = createMarkedElement(document, "span");
  answerMeta.className = "spotpatch-ask-answer-meta";
  answerHead.append(answerTitle, answerMeta);
  const warnings = createMarkedElement(document, "div");
  const blocks = createMarkedElement(document, "div");
  blocks.className = "spotpatch-ask-blocks";
  const sourcesSection = createMarkedElement(document, "section");
  sourcesSection.className = "spotpatch-ask-sources";
  const sourcesTitle = createMarkedElement(document, "h4");
  const sourceList = createMarkedElement(document, "div");
  sourceList.className = "spotpatch-ask-source-list";
  sourcesSection.append(sourcesTitle, sourceList);
  answer.append(stale, recap, answerHead, warnings, blocks, sourcesSection);

  // Outcomes lead (the body scrolls back to the top when the planner
  // returns from the execution island); actions stay pinned last.
  askPanel.append(
    error,
    answer,
    questionField,
    executorField,
    modelField,
    safety,
    status,
    actions,
  );
  root.append(modeSwitch, origin, askPanel);

  function hasReadyExecutor(): boolean {
    const selected = currentCapability?.executors.find(
      (candidate) => candidate.executorId === executorSelect.value,
    );
    return selected?.state === "ready" && selected.readOnlyProven;
  }

  function hasAnyReadyExecutor(): boolean {
    return (
      currentCapability?.executors.some(
        (candidate) => candidate.state === "ready" && candidate.readOnlyProven,
      ) === true
    );
  }

  function renderModels(): void {
    const executor = currentCapability?.executors.find(
      (item) => item.executorId === executorSelect.value,
    );
    const previous =
      modelExecutorId === executor?.executorId ? modelPicker.select.value : undefined;
    modelExecutorId = executor?.executorId;
    const models = executor?.models;
    modelField.hidden = models === undefined;
    modelPicker.select.replaceChildren();
    for (const model of models ?? []) {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      modelPicker.select.append(option);
    }
    modelPicker.select.value =
      models?.find((model) => model === previous) ??
      models?.find((model) => model === executor?.requestedModelLabel) ??
      models?.[0] ??
      "";
    modelPicker.rebuild();
  }

  function refreshSubmitState(): void {
    submitButton.disabled =
      busy ||
      questionInput.value.trim().length === 0 ||
      !hasReadyExecutor() ||
      !consentCheckbox.checked ||
      currentPreview.targetCount === 0;
    if (!currentPreview.contextReady) submitButton.disabled = true;
    questionInput.disabled = busy;
    const executorUnavailable =
      busy || currentCapability === undefined || !hasAnyReadyExecutor();
    executorPicker.setDisabled(executorUnavailable);
    modelPicker.setDisabled(busy || !hasReadyExecutor());
    consentCheckbox.disabled = busy || !hasReadyExecutor();
    const answered = !busy && currentResult !== undefined;
    askPanel.dataset.phase = busy ? "running" : answered ? "answered" : "compose";
    newQuestionButton.hidden = !answered;
    copyButton.hidden = !answered;
    convertButton.hidden = !answered;
    submitButton.hidden = answered;
    cancelButton.hidden = !busy;
  }

  function applyMode(): void {
    const asking = currentMode === "ask";
    modeSwitch.dataset.mode = currentMode;
    askTab.setAttribute("aria-selected", String(asking));
    changeTab.setAttribute("aria-selected", String(!asking));
    askPanel.hidden = !asking;
    input.changeRoot.hidden = asking;
    input.changeActions.hidden = asking;
    origin.hidden = asking || origin.dataset.active !== "true";
    if (
      reportedMode !== currentMode ||
      reportedTitle !== messages.title ||
      reportedSubtitle !== messages.subtitle
    ) {
      reportedMode = currentMode;
      reportedTitle = messages.title;
      reportedSubtitle = messages.subtitle;
      input.onModeChange(currentMode, messages.title, messages.subtitle);
    }
    input.onViewChange();
  }

  function renderSuggestions(): void {
    suggestions.replaceChildren();
    for (const suggestion of messages.suggestions) {
      const button = createButton(document, suggestion);
      button.type = "button";
      button.addEventListener("click", () => {
        questionInput.value = suggestion;
        refreshSubmitState();
        questionInput.focus();
      });
      suggestions.append(button);
    }
  }

  function applyMessages(): void {
    messages = contextualAskMessages(input.locale());
    modeSwitch.setAttribute("aria-label", messages.mode.label);
    askTab.textContent = messages.mode.ask;
    changeTab.textContent = messages.mode.change;
    questionLabel.textContent = messages.questionLabel;
    recapLabel.textContent = messages.questionLabel;
    questionInput.placeholder = messages.questionPlaceholder;
    suggestions.setAttribute("aria-label", messages.suggestionsLabel);
    executorLabel.textContent = messages.executorLabel;
    modelLabel.textContent = messages.modelLabel;
    executorPicker.root
      .querySelector("[role=listbox]")
      ?.setAttribute("aria-label", messages.executorLabel);
    modelPicker.root
      .querySelector("[role=listbox]")
      ?.setAttribute("aria-label", messages.modelLabel);
    consentText.textContent = messages.consent;
    safetyText.textContent = messages.safety;
    submitButton.textContent = messages.submit;
    cancelButton.textContent = messages.cancel;
    newQuestionButton.textContent = messages.newQuestion;
    copyButton.textContent = messages.copy;
    convertButton.textContent = messages.convert;
    answerTitle.textContent = messages.answerTitle;
    sourcesTitle.textContent = messages.sourcesTitle;
    stale.textContent = messages.stale;
    originTitle.textContent = messages.convertedTitle;
    originBody.textContent = messages.convertedBody;
    dataText.textContent = messages.dataSummary(
      currentPreview.targetCount,
      currentPreview.sourceCount,
    );
    renderSuggestions();
    renderCapability(currentCapability);
    if (currentResult !== undefined) renderAnswer(currentResult, !stale.hidden);
  }

  function renderCapability(capability?: ContextualAskCapability): void {
    currentCapability = capability;
    const previous = executorSelect.value;
    executorSelect.replaceChildren();
    executorPicker.close();
    executorStatus.hidden = true;
    executorStatus.textContent = "";
    if (capability === undefined) {
      const option = document.createElement("option");
      option.textContent = messages.loadingExecutors;
      option.value = "";
      executorSelect.append(option);
    } else if (!capability.enabled || capability.executors.length === 0) {
      const option = document.createElement("option");
      option.textContent = messages.noExecutor;
      option.value = "";
      executorSelect.append(option);
    } else {
      const readyExecutors = capability.executors.filter(
        (executor) => executor.state === "ready" && executor.readOnlyProven,
      );
      const unavailableExecutors = capability.executors.filter(
        (executor) => executor.state !== "ready" || !executor.readOnlyProven,
      );
      for (const executor of readyExecutors) {
        const option = document.createElement("option");
        option.value = executor.executorId;
        option.textContent =
          executor.models === undefined
            ? `${executor.label} · ${executor.effectiveModelLabel}`
            : executor.label;
        executorSelect.append(option);
      }
      if (readyExecutors.length === 0) {
        const option = document.createElement("option");
        option.textContent = messages.noExecutor;
        option.value = "";
        executorSelect.append(option);
      }
      executorSelect.value = readyExecutors.some(
        (executor) => executor.executorId === previous,
      )
        ? previous
        : (readyExecutors[0]?.executorId ?? "");
      if (unavailableExecutors.length > 0) {
        executorStatus.textContent = unavailableExecutors
          .map((executor) => `${executor.label}: ${messages.error(executor.errorCode)}`)
          .join(" ");
        executorStatus.hidden = false;
      }
    }
    executorPicker.rebuild();
    renderModels();
    refreshSubmitState();
  }

  function renderJob(snapshot: AskJobSnapshot): void {
    currentJob = snapshot;
    status.hidden = false;
    error.hidden = true;
    statusText.textContent = messages.status[snapshot.status];
    if (["answered", "cancelled", "failed"].includes(snapshot.status)) {
      busy = false;
      input.onExecutionChange();
    } else {
      input.onExecutionChange({
        scene: "running",
        tone: "running",
        headline: messages.status[snapshot.status],
        expandedHeadline: messages.status[snapshot.status],
        action: messages.safety,
        expandedAction: messages.safety,
        meta: `${snapshot.executor.label} · ${snapshot.executor.modelLabel}`,
        recentActivities: Object.freeze([]),
        startedAt: snapshot.createdAt,
      });
    }
    refreshSubmitState();
  }

  function renderEvent(event: AskJobEvent): void {
    if (event.type === "snapshot") {
      renderJob(event.snapshot);
      return;
    }
    if (event.type === "phase") statusText.textContent = messages.status[event.status];
    if (event.type === "read-activity" && event.state === "started") {
      const line = createMarkedElement(document, "span");
      line.textContent =
        event.activity.kind === "source"
          ? messages.readSource(event.activity.relativePath)
          : messages.readFiles(event.activity.bucket);
      activities.append(line);
      while (activities.childElementCount > 5) activities.firstElementChild?.remove();
      if (currentJob !== undefined) {
        const activityLabel = line.textContent;
        input.onExecutionChange({
          scene: "running",
          tone: "running",
          headline: messages.status.running,
          expandedHeadline: messages.status.running,
          action: activityLabel,
          expandedAction: activityLabel,
          meta: `${currentJob.executor.label} · ${currentJob.executor.modelLabel}`,
          activity: {
            key: `ask:${String(event.sequence)}`,
            kind: "read",
            label: activityLabel,
            state: "active",
          },
          recentActivities: Object.freeze([]),
          startedAt: currentJob.createdAt,
        });
      }
    }
  }

  function renderAnswer(result: AskAnswerResult, isStale: boolean): void {
    currentResult = result;
    currentJob = undefined;
    input.onExecutionChange();
    const sourceMap = new Map(
      result.sources.map((source) => [source.sourceId, source]),
    );
    blocks.replaceChildren();
    warnings.replaceChildren();
    sourceList.replaceChildren();
    stale.hidden = !isStale;
    for (const warning of result.warnings) {
      const warningNode = createMarkedElement(document, "div");
      warningNode.className = "spotpatch-ask-warning";
      warningNode.textContent = messages.warning(warning.code);
      warnings.append(warningNode);
    }
    for (const block of result.blocks) {
      if (block.kind === "paragraph") {
        const paragraph = createMarkedElement(document, "p");
        appendInlineText(document, paragraph, block.text);
        blocks.append(paragraph);
        appendSourceChips(document, blocks, block.sourceIds, sourceMap, messages);
      } else if (block.kind === "code") {
        const pre = createMarkedElement(document, "pre");
        const code = createMarkedElement(document, "code");
        if (block.language !== undefined) code.dataset.language = block.language;
        code.textContent = block.code;
        pre.append(code);
        blocks.append(pre);
        appendSourceChips(document, blocks, block.sourceIds, sourceMap, messages);
      } else {
        const list = createMarkedElement(document, "ul");
        for (const item of block.items) {
          const listItem = createMarkedElement(document, "li");
          appendInlineText(document, listItem, item.text);
          appendSourceChips(document, listItem, item.sourceIds, sourceMap, messages);
          list.append(listItem);
        }
        blocks.append(list);
      }
    }
    for (const source of result.sources) {
      const button = createButton(
        document,
        messages.sourceLabel(source.relativePath, source.startLine, source.endLine),
        "spotpatch-ask-source",
      );
      button.dataset.askSourceId = source.sourceId;
      button.title = source.label;
      sourceList.append(button);
    }
    sourcesSection.hidden = result.sources.length === 0;
    warnings.hidden = result.warnings.length === 0;
    const question = questionInput.value.trim();
    recapText.textContent = question;
    recap.hidden = question.length === 0;
    answerMeta.textContent = `${result.executor.label} · ${result.executor.modelLabel}`;
    // A new answer cascades in; re-renders of the same answer (locale, stale)
    // update in place.
    answer.dataset.entering = String(result.jobId !== renderedJobId);
    renderedJobId = result.jobId;
    const sequence = [
      recap,
      answerHead,
      ...warnings.querySelectorAll<HTMLElement>(":scope > *"),
      ...blocks.querySelectorAll<HTMLElement>(":scope > *"),
      sourcesSection,
    ];
    for (const [order, element] of sequence.entries()) {
      element.dataset.askOrder = "";
      element.style.setProperty(
        "--spotpatch-ask-order",
        String(Math.min(order, MAXIMUM_STAGGERED_ANSWER_ITEMS)),
      );
    }
    answer.hidden = false;
    status.hidden = true;
    busy = false;
    refreshSubmitState();
    input.onViewChange();
  }

  function answerPlainText(): string {
    if (currentResult === undefined) return "";
    const body = currentResult.blocks
      .flatMap((block) =>
        block.kind === "paragraph"
          ? [block.text]
          : block.kind === "code"
            ? [block.code]
            : block.items.map((item) => `- ${item.text}`),
      )
      .join("\n\n");
    const sourceText = currentResult.sources
      .map((source) =>
        messages.sourceLabel(source.relativePath, source.startLine, source.endLine),
      )
      .join("\n");
    return sourceText.length === 0
      ? body
      : `${body}\n\n${messages.sourcesTitle}\n${sourceText}`;
  }

  function clear(): void {
    currentResult = undefined;
    currentJob = undefined;
    input.onExecutionChange();
    questionInput.value = "";
    answer.hidden = true;
    status.hidden = true;
    error.hidden = true;
    activities.replaceChildren();
    stale.hidden = true;
    busy = false;
    refreshSubmitState();
    input.onViewChange();
  }

  askTab.addEventListener("click", () => {
    currentMode = "ask";
    applyMode();
    questionInput.focus({ preventScroll: true });
  });
  changeTab.addEventListener("click", () => {
    currentMode = "change";
    applyMode();
  });
  questionInput.addEventListener("input", refreshSubmitState);
  executorSelect.addEventListener("change", () => {
    renderModels();
    refreshSubmitState();
    input.onViewChange();
  });
  consentCheckbox.addEventListener("change", refreshSubmitState);
  const unsubscribeLocale = input.subscribeLocale(applyMessages);
  applyMessages();
  applyMode();

  return Object.freeze({
    root,
    styles: createStyles(document),
    questionInput,
    executorSelect,
    consentCheckbox,
    submitButton,
    cancelButton,
    newQuestionButton,
    copyButton,
    convertButton,
    clear,
    dispose: () => {
      unsubscribeLocale();
      executorPicker.dispose();
      modelPicker.dispose();
    },
    focusQuestion: () => {
      questionInput.focus({ preventScroll: true });
    },
    mode: () => currentMode,
    notify(event: "copied" | "copy-failed" | "converted" | "source-open-failed"): void {
      const message =
        event === "copied"
          ? messages.copied
          : event === "copy-failed"
            ? messages.copyFailed
            : event === "converted"
              ? messages.converted
              : messages.sourceOpenFailed;
      input.announce(message);
    },
    readConsent: () => consentCheckbox.checked,
    readExecutorId: () => executorSelect.value || undefined,
    readModel: () => modelPicker.select.value || undefined,
    readQuestion: () => questionInput.value.trim(),
    renderAnswer,
    renderCapability,
    renderError(code?: ErrorCode): void {
      currentJob = undefined;
      input.onExecutionChange();
      error.textContent = messages.error(code);
      error.hidden = false;
      status.hidden = true;
      busy = false;
      refreshSubmitState();
      input.onViewChange();
    },
    renderEvent,
    renderJob,
    selectedSourceId(target: EventTarget | null): string | undefined {
      return target instanceof Element
        ? target.closest<HTMLElement>("[data-ask-source-id]")?.dataset.askSourceId
        : undefined;
    },
    setBusy(nextBusy: boolean): void {
      busy = nextBusy;
      if (nextBusy) {
        status.hidden = false;
        error.hidden = true;
        answer.hidden = true;
        activities.replaceChildren();
      }
      refreshSubmitState();
    },
    setConsent(granted: boolean): void {
      consentCheckbox.checked = granted;
      refreshSubmitState();
    },
    setMode(mode: "ask" | "change"): void {
      currentMode = mode;
      applyMode();
    },
    setOrigin(nextOrigin?: AskDraftOrigin): void {
      origin.dataset.active = String(nextOrigin !== undefined);
      origin.hidden = currentMode === "ask" || nextOrigin === undefined;
      input.onViewChange();
    },
    setSelectionPreview(preview: ContextualAskSelectionPreview): void {
      currentPreview = preview;
      dataText.textContent = messages.dataSummary(
        preview.targetCount,
        preview.sourceCount,
      );
      refreshSubmitState();
    },
    setSelectionVisible(visible: boolean): void {
      root.hidden = !visible;
      if (visible) applyMode();
    },
    sourceById: (sourceId: string) =>
      currentResult?.sources.find((source) => source.sourceId === sourceId),
    answerPlainText,
  });
}
