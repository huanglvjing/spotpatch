import type {
  AskAnswerResult,
  AskDraftOrigin,
  AskJobEvent,
  AskJobSnapshot,
  AskSourceReference,
  ContextualAskCapability,
  ErrorCode,
} from "@spotpatch/shared/contextual-ask-browser";

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

function createStyles(document: Document): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = `
    .spotpatch-ask-mode { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 14px; padding: 4px; border: 1px solid var(--spotpatch-border-subtle); border-radius: 10px; background: #0a0a0e; }
    .spotpatch-ask-mode button { min-height: 34px; border: 0; border-radius: 7px; color: var(--spotpatch-text-secondary); background: transparent; cursor: pointer; font-size: 12px; font-weight: 700; }
    .spotpatch-ask-mode button[aria-selected="true"] { color: #f7f7ff; background: linear-gradient(135deg, rgb(139 123 255 / 25%), rgb(82 168 255 / 14%)); box-shadow: inset 0 0 0 1px rgb(139 123 255 / 24%); }
    .spotpatch-ask-panel { display: grid; gap: 14px; }
    .spotpatch-ask-field { display: grid; gap: 7px; }
    .spotpatch-ask-field > label, .spotpatch-ask-label { color: #c9cad2; font-size: 11px; font-weight: 680; }
    .spotpatch-ask-question { box-sizing: border-box; width: 100%; min-height: 92px; resize: vertical; border: 1px solid var(--spotpatch-border); border-radius: 10px; padding: 11px 12px; outline: none; color: var(--spotpatch-text); background: var(--spotpatch-bg-input); line-height: 1.55; }
    .spotpatch-ask-question:focus { border-color: rgb(139 123 255 / 68%); box-shadow: 0 0 0 3px rgb(139 123 255 / 12%); }
    .spotpatch-ask-suggestions { display: flex; flex-wrap: wrap; gap: 6px; }
    .spotpatch-ask-suggestions button { border: 1px solid var(--spotpatch-border-subtle); border-radius: 999px; padding: 5px 9px; color: var(--spotpatch-text-secondary); background: rgb(255 255 255 / 2%); cursor: pointer; font-size: 10.5px; }
    .spotpatch-ask-suggestions button:hover { border-color: rgb(139 123 255 / 42%); color: #fff; }
    .spotpatch-ask-executor-picker { display: grid; gap: 5px; min-width: 0; }
    .spotpatch-ask-executor { box-sizing: border-box; display: flex; width: 100%; min-height: 38px; align-items: center; justify-content: space-between; gap: 10px; border: 1px solid var(--spotpatch-border); border-radius: 9px; padding: 0 11px; overflow: hidden; color: var(--spotpatch-text); background: var(--spotpatch-bg-input); cursor: pointer; font: inherit; outline: none; text-align: left; }
    .spotpatch-ask-executor > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .spotpatch-ask-executor[data-expandable="true"]::after { width: 7px; height: 7px; flex: 0 0 auto; border-right: 1.5px solid #8f96a3; border-bottom: 1.5px solid #8f96a3; content: ""; transform: translateY(-2px) rotate(45deg); }
    .spotpatch-ask-executor[aria-expanded="true"]::after { transform: translateY(2px) rotate(225deg); }
    .spotpatch-ask-executor:focus-visible { border-color: rgb(139 123 255 / 68%); box-shadow: 0 0 0 3px rgb(139 123 255 / 12%); }
    .spotpatch-ask-executor:disabled { color: var(--spotpatch-text); background: rgb(255 255 255 / 3%); cursor: default; opacity: 1; }
    .spotpatch-ask-executor[data-empty="true"]:disabled { color: var(--spotpatch-text-muted); }
    .spotpatch-ask-executor-menu { display: grid; gap: 3px; border: 1px solid var(--spotpatch-border); border-radius: 9px; padding: 4px; background: #101116; box-shadow: 0 10px 28px rgb(0 0 0 / 28%); }
    .spotpatch-ask-executor-menu[hidden] { display: none; }
    .spotpatch-ask-executor-option { box-sizing: border-box; min-height: 34px; border: 0; border-radius: 6px; padding: 7px 9px; color: var(--spotpatch-text-secondary); background: transparent; cursor: pointer; font: inherit; text-align: left; }
    .spotpatch-ask-executor-option:hover, .spotpatch-ask-executor-option:focus-visible { color: #fff; background: rgb(139 123 255 / 13%); outline: none; }
    .spotpatch-ask-executor-option[aria-selected="true"] { color: #f4f1ff; background: rgb(139 123 255 / 20%); }
    .spotpatch-ask-executor-native { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; border: 0; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
    .spotpatch-ask-executor-status { margin: 0; border-left: 2px solid var(--spotpatch-warning); padding-left: 8px; color: #d8b66c; font-size: 10.5px; line-height: 1.45; }
    .spotpatch-ask-safety { display: grid; gap: 8px; border: 1px solid rgb(82 168 255 / 16%); border-radius: 10px; padding: 10px 11px; background: rgb(82 168 255 / 4%); }
    .spotpatch-ask-data { display: flex; justify-content: space-between; gap: 10px; color: #aab3c2; font-size: 10.5px; }
    .spotpatch-ask-data strong { color: #9fe3c4; font-weight: 650; white-space: nowrap; }
    .spotpatch-ask-consent { display: grid; grid-template-columns: 16px 1fr; gap: 8px; align-items: start; color: var(--spotpatch-text-secondary); cursor: pointer; font-size: 10.5px; line-height: 1.45; }
    .spotpatch-ask-consent input { margin: 2px 0 0; accent-color: var(--spotpatch-accent); }
    .spotpatch-ask-actions, .spotpatch-ask-answer-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
    .spotpatch-ask-actions button, .spotpatch-ask-answer-actions button { min-height: 34px; border: 1px solid var(--spotpatch-border); border-radius: 8px; padding: 0 12px; color: #d6d6de; background: var(--spotpatch-bg-raised); cursor: pointer; font-size: 11px; font-weight: 680; }
    .spotpatch-ask-actions .spotpatch-primary, .spotpatch-ask-answer-actions .spotpatch-primary { border-color: transparent; color: var(--spotpatch-text-on-accent); background: linear-gradient(135deg, #a99cff, #65b7ff); }
    .spotpatch-ask-actions button:disabled, .spotpatch-ask-answer-actions button:disabled { opacity: .45; cursor: not-allowed; }
    .spotpatch-ask-status { display: grid; gap: 7px; border-left: 2px solid var(--spotpatch-accent); padding: 2px 0 2px 10px; color: #c8c9d2; font-size: 11px; }
    .spotpatch-ask-activity { display: grid; gap: 4px; color: var(--spotpatch-text-muted); font: 500 10px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .spotpatch-ask-error, .spotpatch-ask-stale, .spotpatch-ask-warning { border-radius: 8px; padding: 9px 10px; font-size: 10.5px; }
    .spotpatch-ask-error { color: #fecaca; background: rgb(251 113 133 / 9%); }
    .spotpatch-ask-stale, .spotpatch-ask-warning { color: #f9d68a; background: rgb(245 158 11 / 8%); }
    .spotpatch-ask-answer { display: grid; gap: 12px; border: 1px solid var(--spotpatch-border-subtle); border-radius: 11px; padding: 12px; background: var(--spotpatch-bg); box-shadow: 0 12px 30px rgb(0 0 0 / 18%); }
    .spotpatch-ask-answer h3, .spotpatch-ask-sources h4 { margin: 0; color: var(--spotpatch-text); font-size: 13px; }
    .spotpatch-ask-blocks { display: grid; gap: 10px; color: #d9dae2; font-size: 12px; line-height: 1.65; overflow-wrap: anywhere; }
    .spotpatch-ask-blocks p, .spotpatch-ask-blocks ul { margin: 0; }
    .spotpatch-ask-blocks ul { padding-left: 18px; }
    .spotpatch-ask-blocks pre { max-width: 100%; overflow: auto; margin: 0; border: 1px solid var(--spotpatch-border-subtle); border-radius: 9px; padding: 10px; color: #dbeafe; background: #08090d; font: 500 10.5px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .spotpatch-ask-citations, .spotpatch-ask-source-list { display: flex; flex-wrap: wrap; gap: 5px; }
    .spotpatch-ask-source { max-width: 100%; overflow: hidden; border: 1px solid rgb(82 168 255 / 22%); border-radius: 999px; padding: 4px 8px; color: #b8dcff; background: rgb(82 168 255 / 7%); cursor: pointer; font: 550 9.5px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; text-overflow: ellipsis; white-space: nowrap; }
    .spotpatch-ask-sources { display: grid; gap: 7px; }
    .spotpatch-ask-origin { margin-bottom: 12px; border: 1px solid rgb(139 123 255 / 22%); border-radius: 10px; padding: 10px 11px; color: var(--spotpatch-text-secondary); background: rgb(139 123 255 / 6%); font-size: 10.5px; }
    .spotpatch-ask-origin strong { display: block; margin-bottom: 2px; color: #d9d4ff; font-size: 11px; }
    @media (max-width: 420px) { .spotpatch-ask-data { display: grid; } .spotpatch-ask-actions, .spotpatch-ask-answer-actions { justify-content: stretch; } .spotpatch-ask-actions button, .spotpatch-ask-answer-actions button { flex: 1 1 auto; } }
    @media (prefers-reduced-motion: reduce) { .spotpatch-ask-panel *, .spotpatch-ask-mode * { scroll-behavior: auto !important; transition: none !important; } }
  `;
  return style;
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
  const executorPicker = createMarkedElement(document, "div");
  executorPicker.className = "spotpatch-ask-executor-picker";
  const executorTrigger = createButton(document, "", "spotpatch-ask-executor");
  const executorSelect = createMarkedElement(document, "select");
  const executorId = `spotpatch-ask-executor-${Math.random().toString(36).slice(2)}`;
  const executorMenuId = `${executorId}-menu`;
  executorTrigger.id = executorId;
  executorTrigger.setAttribute("role", "combobox");
  executorTrigger.setAttribute("aria-controls", executorMenuId);
  executorTrigger.setAttribute("aria-expanded", "false");
  const executorText = createMarkedElement(document, "span");
  executorTrigger.append(executorText);
  const executorMenu = createMarkedElement(document, "div");
  executorMenu.id = executorMenuId;
  executorMenu.className = "spotpatch-ask-executor-menu";
  executorMenu.setAttribute("role", "listbox");
  executorMenu.hidden = true;
  executorSelect.className = "spotpatch-ask-executor-native";
  executorSelect.tabIndex = -1;
  executorSelect.setAttribute("aria-hidden", "true");
  executorLabel.htmlFor = executorId;
  const executorStatus = createMarkedElement(document, "p");
  executorStatus.className = "spotpatch-ask-executor-status";
  executorStatus.setAttribute("role", "status");
  executorStatus.hidden = true;
  executorPicker.append(executorTrigger, executorMenu, executorSelect);
  executorField.append(executorLabel, executorPicker, executorStatus);

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
  const submitButton = createButton(document, "", "spotpatch-primary");
  cancelButton.hidden = true;
  actions.append(newQuestionButton, cancelButton, submitButton);

  const answer = createMarkedElement(document, "article");
  answer.className = "spotpatch-ask-answer";
  answer.hidden = true;
  const stale = createMarkedElement(document, "div");
  stale.className = "spotpatch-ask-stale";
  stale.hidden = true;
  const answerTitle = createMarkedElement(document, "h3");
  const warnings = createMarkedElement(document, "div");
  const blocks = createMarkedElement(document, "div");
  blocks.className = "spotpatch-ask-blocks";
  const sourcesSection = createMarkedElement(document, "section");
  sourcesSection.className = "spotpatch-ask-sources";
  const sourcesTitle = createMarkedElement(document, "h4");
  const sourceList = createMarkedElement(document, "div");
  sourceList.className = "spotpatch-ask-source-list";
  sourcesSection.append(sourcesTitle, sourceList);
  const answerActions = createMarkedElement(document, "div");
  answerActions.className = "spotpatch-ask-answer-actions";
  const copyButton = createButton(document, "");
  const convertButton = createButton(document, "", "spotpatch-primary");
  answerActions.append(copyButton, convertButton);
  answer.append(stale, answerTitle, warnings, blocks, sourcesSection, answerActions);

  askPanel.append(questionField, executorField, safety, status, error, actions, answer);
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

  function readyExecutorCount(): number {
    return (
      currentCapability?.executors.filter(
        (candidate) => candidate.state === "ready" && candidate.readOnlyProven,
      ).length ?? 0
    );
  }

  function closeExecutorMenu(focusTrigger = false): void {
    if (executorMenu.hidden) return;
    executorMenu.hidden = true;
    executorTrigger.setAttribute("aria-expanded", "false");
    if (focusTrigger) executorTrigger.focus({ preventScroll: true });
    input.onViewChange();
  }

  function openExecutorMenu(focusSelected = false): void {
    if (executorTrigger.disabled || !executorMenu.hidden) return;
    executorMenu.hidden = false;
    executorTrigger.setAttribute("aria-expanded", "true");
    if (focusSelected) {
      const selected = executorMenu.querySelector<HTMLElement>(
        '.spotpatch-ask-executor-option[aria-selected="true"]',
      );
      const first = executorMenu.firstElementChild;
      const focusTarget = selected ?? (first instanceof HTMLElement ? first : null);
      focusTarget?.focus({ preventScroll: true });
    }
    input.onViewChange();
  }

  function syncExecutorControl(): void {
    const selectedOption = [...executorSelect.options].find(
      (option) => option.value === executorSelect.value,
    );
    executorText.textContent = selectedOption?.textContent ?? messages.noExecutor;
    executorTrigger.dataset.empty = String(executorSelect.value.length === 0);
    for (const option of executorMenu.querySelectorAll<HTMLElement>(
      ".spotpatch-ask-executor-option",
    )) {
      option.setAttribute(
        "aria-selected",
        String(option.dataset.executorId === executorSelect.value),
      );
    }
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
    const readyCount = readyExecutorCount();
    const executorUnavailable =
      busy || currentCapability === undefined || !hasAnyReadyExecutor();
    executorSelect.disabled = executorUnavailable;
    executorTrigger.disabled = executorUnavailable || readyCount < 2;
    executorTrigger.dataset.expandable = String(!executorUnavailable && readyCount > 1);
    if (executorTrigger.disabled) closeExecutorMenu();
    consentCheckbox.disabled = busy || !hasReadyExecutor();
    newQuestionButton.hidden = busy || currentResult === undefined;
    cancelButton.hidden = !busy;
  }

  function applyMode(): void {
    const asking = currentMode === "ask";
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
    questionInput.placeholder = messages.questionPlaceholder;
    suggestions.setAttribute("aria-label", messages.suggestionsLabel);
    executorLabel.textContent = messages.executorLabel;
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
    executorMenu.replaceChildren();
    closeExecutorMenu();
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
        option.textContent = `${executor.label} · ${executor.effectiveModelLabel}`;
        executorSelect.append(option);
        const menuOption = createButton(
          document,
          option.textContent,
          "spotpatch-ask-executor-option",
        );
        menuOption.dataset.executorId = executor.executorId;
        menuOption.setAttribute("role", "option");
        menuOption.addEventListener("click", () => {
          executorSelect.value = executor.executorId;
          syncExecutorControl();
          closeExecutorMenu(true);
          executorSelect.dispatchEvent(new Event("change", { bubbles: true }));
        });
        executorMenu.append(menuOption);
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
    syncExecutorControl();
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
        paragraph.textContent = block.text;
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
          listItem.textContent = item.text;
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
  executorSelect.addEventListener("change", refreshSubmitState);
  executorTrigger.addEventListener("click", () => {
    if (executorMenu.hidden) openExecutorMenu();
    else closeExecutorMenu();
  });
  executorTrigger.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    openExecutorMenu(true);
  });
  executorMenu.addEventListener("keydown", (event) => {
    const options = [
      ...executorMenu.querySelectorAll<HTMLButtonElement>(
        ".spotpatch-ask-executor-option",
      ),
    ];
    if (event.key === "Escape") {
      event.preventDefault();
      closeExecutorMenu(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : event.key === "ArrowDown"
            ? (currentIndex + 1 + options.length) % options.length
            : (currentIndex - 1 + options.length) % options.length;
    options[nextIndex]?.focus({ preventScroll: true });
  });
  executorPicker.addEventListener("focusout", (event) => {
    if (
      !(event.relatedTarget instanceof Node) ||
      !executorPicker.contains(event.relatedTarget)
    ) {
      closeExecutorMenu();
    }
  });
  const closeExecutorMenuOutside = (event: PointerEvent): void => {
    if (!event.composedPath().includes(executorPicker)) closeExecutorMenu();
  };
  document.addEventListener("pointerdown", closeExecutorMenuOutside);
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
      document.removeEventListener("pointerdown", closeExecutorMenuOutside);
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
