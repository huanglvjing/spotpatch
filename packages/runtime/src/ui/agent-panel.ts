import type {
  AgentCapabilitySnapshot,
  AgentJobResult,
  AgentJobSnapshot,
  ErrorCode,
  RuntimeAiConfig,
  RuntimeAiProviderProfile,
} from "@spotpatch/shared";

import { createButton, createMarkedElement } from "./dom.js";
import type { UiLocalizer, UiMessages } from "./localization.js";

export interface AgentSelectionValue {
  readonly modelProfileId: string;
  readonly providerProfileId: string;
}

export interface AgentActivityItem {
  readonly key: string;
  readonly label: string;
  readonly state: "active" | "success" | "failure" | "info";
}

export interface AgentPanel {
  readonly applyButton: HTMLButtonElement;
  readonly cancelButton: HTMLButtonElement;
  readonly consentCheckbox: HTMLInputElement;
  readonly modelSelect: HTMLSelectElement;
  readonly providerSelect: HTMLSelectElement;
  readonly resetButton: HTMLButtonElement;
  readonly revertButton: HTMLButtonElement;
  readonly root: HTMLElement;
  readonly runButton: HTMLButtonElement;
  readonly testButton: HTMLButtonElement;
  readonly consentGranted: () => boolean;
  readonly dispose: () => void;
  readonly readSelection: () => AgentSelectionValue | undefined;
  readonly renderCapability: (
    state: "idle" | "probing" | "ready" | "error",
    message: string,
    capability?: AgentCapabilitySnapshot,
    errorCode?: ErrorCode,
  ) => void;
  readonly renderJob: (
    snapshot: AgentJobSnapshot,
    result: AgentJobResult | undefined,
    activities: readonly AgentActivityItem[],
    errorCode?: ErrorCode,
  ) => void;
  readonly resetJob: () => void;
  readonly setContextReady: (ready: boolean) => void;
  readonly setEditingEnabled: (enabled: boolean) => void;
  readonly setProviderConsent: (granted: boolean) => void;
  readonly setSelectionVisible: (visible: boolean) => void;
}

export const AGENT_PANEL_STYLES = `
  .spotpatch-agent {
    margin-top: 14px;
    overflow: hidden;
    border: 1px solid var(--spotpatch-border-subtle);
    border-radius: var(--spotpatch-radius-card);
    background: rgb(255 255 255 / 2.5%);
  }
  .spotpatch-agent-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px;
    border-bottom: 1px solid rgb(255 255 255 / 7%);
  }
  .spotpatch-agent-title { color: #eef0f5; font-size: 16px; font-weight: 680; }
  .spotpatch-agent-badge {
    border: 1px solid rgb(129 112 247 / 24%);
    border-radius: 999px;
    padding: 3px 7px;
    color: #c5cafa;
    background: rgb(109 93 246 / 9%);
    font-size: 11px;
    font-weight: 650;
  }
  .spotpatch-agent-setup { padding: 18px; }
  .spotpatch-agent-selectors { display: grid; grid-template-columns: 1fr; gap: 15px; }
  .spotpatch-agent-selectors label { min-width: 0; color: var(--spotpatch-text-secondary); font-size: 14px; font-weight: 580; }
  .spotpatch-agent select {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    min-height: 46px;
    margin-top: 7px;
    border: 1px solid var(--spotpatch-border);
    border-radius: 10px;
    padding: 8px 30px 8px 10px;
    color: #e8ebf2;
    color-scheme: dark;
    background: var(--spotpatch-bg-raised);
    font-size: 15px;
    outline: none;
  }
  .spotpatch-agent select option { color: #e8ebf2; background: #10151e; }
  .spotpatch-agent select:focus-visible,
  .spotpatch-consent input:focus-visible {
    outline: 2px solid #8b7cf7;
    outline-offset: 2px;
  }
  .spotpatch-consent {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin-top: 16px;
    color: var(--spotpatch-text-secondary);
    cursor: pointer;
    font-size: 14px;
    line-height: 1.6;
  }
  .spotpatch-consent input { width: 16px; height: 16px; flex: none; margin: 3px 0 0; accent-color: var(--spotpatch-accent); }
  .spotpatch-agent-capability {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 14px 0 0;
    color: #929bab;
    font-size: 13px;
  }
  .spotpatch-agent-capability::before {
    width: 6px;
    height: 6px;
    flex: none;
    border-radius: 999px;
    background: #64748b;
    content: "";
  }
  .spotpatch-agent-capability[data-state="probing"]::before { background: var(--spotpatch-warning); }
  .spotpatch-agent-capability[data-state="ready"] { color: #a7f3d0; }
  .spotpatch-agent-capability[data-state="ready"]::before { background: var(--spotpatch-success); }
  .spotpatch-agent-capability[data-state="error"] { color: #fecaca; }
  .spotpatch-agent-capability[data-state="error"]::before { background: var(--spotpatch-danger); }
  .spotpatch-agent-job { padding: 16px; }
  .spotpatch-agent-job-meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .spotpatch-agent-model { min-width: 0; overflow: hidden; color: #d6dafe; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
  .spotpatch-agent-status {
    flex: none;
    border-radius: 999px;
    padding: 3px 7px;
    color: #bae6fd;
    background: rgb(14 116 144 / 20%);
    font-size: 11px;
    font-weight: 650;
  }
  .spotpatch-agent-phase { margin: 12px 0 0; color: #e2e5ec; font-size: 13px; line-height: 1.55; }
  .spotpatch-agent-error {
    margin: 9px 0 0;
    border: 1px solid rgb(251 113 133 / 22%);
    border-radius: 9px;
    padding: 9px 10px;
    color: #fecaca;
    background: rgb(127 29 29 / 14%);
    font-size: 12px;
  }
  .spotpatch-agent-activity { display: grid; gap: 5px; margin: 9px 0 0; padding: 0; list-style: none; }
  .spotpatch-agent-activity li { display: flex; gap: 8px; color: #929bab; font: 11.5px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .spotpatch-agent-activity li::before { color: #64748b; content: "•"; }
  .spotpatch-agent-activity li[data-state="active"]::before { color: #fbbf24; }
  .spotpatch-agent-activity li[data-state="success"]::before { color: #34d399; }
  .spotpatch-agent-activity li[data-state="failure"]::before { color: #fb7185; }
  .spotpatch-agent-result { margin-top: 11px; border-top: 1px solid rgb(148 163 184 / 10%); padding-top: 10px; }
  .spotpatch-agent-summary { margin: 0; color: #dce1eb; font-size: 13px; line-height: 1.6; white-space: pre-wrap; }
  .spotpatch-agent-files { display: grid; gap: 4px; margin: 9px 0 0; padding: 0; list-style: none; }
  .spotpatch-agent-files li { color: #bbc2f7; font: 11.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
  .spotpatch-agent-checks { display: grid; gap: 5px; margin-top: 9px; }
  .spotpatch-agent-checks details { border: 1px solid rgb(148 163 184 / 12%); border-radius: 8px; background: rgb(2 6 23 / 30%); }
  .spotpatch-agent-checks summary { padding: 9px 10px; color: #cbd0db; cursor: pointer; font-size: 11.5px; }
  .spotpatch-agent-checks pre { max-height: 140px; margin: 0; overflow: auto; border-top: 1px solid rgb(255 255 255 / 7%); padding: 10px; color: #929bab; font: 11px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; }
  .spotpatch-agent-diff {
    max-height: 300px;
    margin: 9px 0 0;
    overflow: auto;
    border: 1px solid rgb(129 140 248 / 18%);
    border-radius: 9px;
    padding: 8px;
    color: #cbd5e1;
    background: rgb(2 6 23 / 66%);
    font: 11.5px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
    overflow-wrap: normal;
    white-space: pre;
    user-select: text;
  }
`;

function addOption(
  document: Document,
  select: HTMLSelectElement,
  value: string,
  label: string,
): void {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.append(option);
}

export function createAgentPanel(
  document: Document,
  ai: RuntimeAiConfig,
  localizer: UiLocalizer,
): AgentPanel {
  let messages: UiMessages = localizer.messages();
  const root = createMarkedElement(document, "section");
  root.className = "spotpatch-agent";
  root.hidden = !ai.enabled;
  const header = createMarkedElement(document, "div");
  header.className = "spotpatch-agent-head";
  const title = createMarkedElement(document, "span");
  title.className = "spotpatch-agent-title";
  const badge = createMarkedElement(document, "span");
  badge.className = "spotpatch-agent-badge";
  header.append(title, badge);

  const setup = createMarkedElement(document, "div");
  setup.className = "spotpatch-agent-setup";
  const selectors = createMarkedElement(document, "div");
  selectors.className = "spotpatch-agent-selectors";
  const providerLabel = createMarkedElement(document, "label");
  const providerText = createMarkedElement(document, "span");
  const providerSelect = createMarkedElement(document, "select");
  providerLabel.append(providerText, providerSelect);
  const modelLabel = createMarkedElement(document, "label");
  const modelText = createMarkedElement(document, "span");
  const modelSelect = createMarkedElement(document, "select");
  modelLabel.append(modelText, modelSelect);
  selectors.append(providerLabel, modelLabel);
  const consent = createMarkedElement(document, "label");
  consent.className = "spotpatch-consent";
  const consentCheckbox = createMarkedElement(document, "input");
  consentCheckbox.type = "checkbox";
  const consentText = createMarkedElement(document, "span");
  consent.append(consentCheckbox, consentText);
  const capability = createMarkedElement(document, "p");
  capability.className = "spotpatch-agent-capability";
  capability.dataset.state = "idle";
  setup.append(selectors, consent, capability);

  const job = createMarkedElement(document, "div");
  job.className = "spotpatch-agent-job";
  job.hidden = true;
  const jobMeta = createMarkedElement(document, "div");
  jobMeta.className = "spotpatch-agent-job-meta";
  const jobModel = createMarkedElement(document, "span");
  jobModel.className = "spotpatch-agent-model";
  const jobStatus = createMarkedElement(document, "span");
  jobStatus.className = "spotpatch-agent-status";
  jobMeta.append(jobModel, jobStatus);
  const phase = createMarkedElement(document, "p");
  phase.className = "spotpatch-agent-phase";
  const error = createMarkedElement(document, "p");
  error.className = "spotpatch-agent-error";
  error.hidden = true;
  const activity = createMarkedElement(document, "ul");
  activity.className = "spotpatch-agent-activity";
  const resultPanel = createMarkedElement(document, "div");
  resultPanel.className = "spotpatch-agent-result";
  resultPanel.hidden = true;
  const resultSummary = createMarkedElement(document, "p");
  resultSummary.className = "spotpatch-agent-summary";
  const files = createMarkedElement(document, "ul");
  files.className = "spotpatch-agent-files";
  const checks = createMarkedElement(document, "div");
  checks.className = "spotpatch-agent-checks";
  const diff = createMarkedElement(document, "pre");
  diff.className = "spotpatch-agent-diff";
  diff.tabIndex = 0;
  diff.setAttribute("aria-label", messages.agent.diffAriaLabel);
  resultPanel.append(resultSummary, files, checks, diff);
  job.append(jobMeta, phase, error, activity, resultPanel);
  root.append(header, setup, job);

  const testButton = createButton(document, messages.agent.testConnection);
  const runButton = createButton(
    document,
    messages.agent.verifyAndRun,
    "spotpatch-run",
  );
  const cancelButton = createButton(document, messages.agent.cancel);
  const applyButton = createButton(document, messages.agent.apply, "spotpatch-primary");
  const revertButton = createButton(document, messages.agent.revert);
  const resetButton = createButton(document, messages.agent.revise);

  const providers = ai.enabled ? ai.providers : [];
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  let contextReady = false;
  let editingEnabled = true;
  let selectionVisible = false;
  let jobPresented = false;
  let capabilityProbing = false;
  let capabilityReady = false;
  let latestSnapshot: AgentJobSnapshot | undefined;
  let latestResult: AgentJobResult | undefined;
  let latestActivities: readonly AgentActivityItem[] = [];
  let latestErrorCode: ErrorCode | undefined;
  let latestCapabilityState: "idle" | "probing" | "ready" | "error" = "idle";
  let latestCapabilityMessage = messages.agent.connectionNotTested;
  let latestCapabilityErrorCode: ErrorCode | undefined;

  for (const provider of providers) {
    addOption(document, providerSelect, provider.id, provider.label);
  }

  if (ai.enabled) {
    providerSelect.value = ai.defaultProvider;
  }

  const selectedProvider = (): RuntimeAiProviderProfile | undefined =>
    providerById.get(providerSelect.value);

  const populateModels = (): void => {
    const provider = selectedProvider();
    modelSelect.replaceChildren();

    if (provider === undefined) {
      consentText.textContent = messages.agent.providerUnavailable;
      return;
    }

    for (const model of provider.models) {
      addOption(document, modelSelect, model.id, model.label);
    }

    modelSelect.value = provider.defaultModel;
    consentText.textContent = messages.agent.consent(provider.label);
  };

  const refreshActions = (): void => {
    const setupVisible = ai.enabled && selectionVisible && !jobPresented;
    runButton.textContent = capabilityProbing
      ? messages.agent.verifying
      : capabilityReady
        ? messages.agent.run
        : messages.agent.verifyAndRun;
    runButton.classList.toggle("spotpatch-primary", capabilityReady);
    testButton.hidden = !setupVisible;
    runButton.hidden = !setupVisible;
    testButton.disabled =
      !editingEnabled || capabilityProbing || selectedProvider() === undefined;
    runButton.disabled =
      !editingEnabled ||
      capabilityProbing ||
      !contextReady ||
      !consentCheckbox.checked ||
      selectedProvider() === undefined ||
      modelSelect.value.length === 0;

    if (!jobPresented || !selectionVisible) {
      cancelButton.hidden = true;
      applyButton.hidden = true;
      revertButton.hidden = true;
      resetButton.hidden = true;
    }
  };

  function handleProviderChange(): void {
    populateModels();
    consentCheckbox.checked = false;
    capability.dataset.state = "idle";
    capability.textContent = messages.agent.connectionNotTested;
    latestCapabilityState = "idle";
    latestCapabilityMessage = messages.agent.connectionNotTested;
    latestCapabilityErrorCode = undefined;
    capabilityReady = false;
    refreshActions();
  }
  function handleModelChange(): void {
    capability.dataset.state = "idle";
    capability.textContent = messages.agent.connectionNotTested;
    latestCapabilityState = "idle";
    latestCapabilityMessage = messages.agent.connectionNotTested;
    latestCapabilityErrorCode = undefined;
    capabilityReady = false;
    refreshActions();
  }
  populateModels();
  providerSelect.addEventListener("change", handleProviderChange);
  modelSelect.addEventListener("change", handleModelChange);
  consentCheckbox.addEventListener("change", refreshActions);
  function renderCurrentJob(): void {
    if (latestSnapshot === undefined) {
      return;
    }

    const snapshot = latestSnapshot;
    const result = latestResult;
    jobModel.textContent = `${snapshot.providerLabel} · ${snapshot.modelLabel}`;
    jobStatus.textContent = messages.agent.status(snapshot.status);
    phase.textContent = snapshot.phaseMessage;
    const jobErrorCode = latestErrorCode ?? snapshot.errorCode;
    error.hidden = jobErrorCode === undefined;
    error.textContent = jobErrorCode === undefined ? "" : messages.errors[jobErrorCode];
    activity.replaceChildren();

    for (const item of latestActivities.slice(-8)) {
      const row = createMarkedElement(document, "li");
      row.dataset.state = item.state;
      row.textContent = item.label;
      activity.append(row);
    }

    resultPanel.hidden = result === undefined;
    resultSummary.textContent = result?.summary ?? "";
    files.replaceChildren();
    checks.replaceChildren();
    diff.textContent = result?.diff ?? "";

    for (const file of result?.files ?? []) {
      const row = createMarkedElement(document, "li");
      row.textContent = `${file.kind} ${file.relativePath} (+${String(file.additions)} / -${String(file.deletions)})`;
      files.append(row);
    }

    for (const check of result?.checks ?? []) {
      const details = createMarkedElement(document, "details");
      const checkTitle = createMarkedElement(document, "summary");
      checkTitle.textContent = `${check.label}: ${check.status} · ${String(check.durationMs)} ms`;
      const output = createMarkedElement(document, "pre");
      output.textContent =
        check.output.length === 0 ? messages.agent.noOutput : check.output;
      details.append(checkTitle, output);
      checks.append(details);
    }

    testButton.hidden = true;
    runButton.hidden = true;
    cancelButton.hidden = !selectionVisible || !snapshot.canCancel;
    cancelButton.textContent =
      snapshot.status === "awaiting-review"
        ? messages.agent.discard
        : messages.agent.cancel;
    applyButton.hidden = !selectionVisible || !snapshot.canApply;
    revertButton.hidden = !selectionVisible || !snapshot.canRevert;
    resetButton.hidden =
      !selectionVisible ||
      !["completed", "cancelled", "reverted", "failed"].includes(snapshot.status);
  }

  function applyMessages(): void {
    messages = localizer.messages();
    title.textContent = messages.agent.title;
    badge.textContent =
      ai.enabled && ai.applyMode === "auto"
        ? messages.agent.autoGated
        : messages.agent.review;
    providerText.textContent = messages.agent.provider;
    modelText.textContent = messages.agent.model;
    providerSelect.setAttribute("aria-label", messages.agent.providerAriaLabel);
    modelSelect.setAttribute("aria-label", messages.agent.modelAriaLabel);
    diff.setAttribute("aria-label", messages.agent.diffAriaLabel);
    testButton.textContent = messages.agent.testConnection;
    applyButton.textContent = messages.agent.apply;
    revertButton.textContent = messages.agent.revert;
    resetButton.textContent = messages.agent.revise;
    const provider = selectedProvider();
    consentText.textContent =
      provider === undefined
        ? messages.agent.providerUnavailable
        : messages.agent.consent(provider.label);

    if (latestCapabilityState === "idle") {
      capability.textContent = messages.agent.connectionNotTested;
    } else if (latestCapabilityState === "probing") {
      capability.textContent = messages.agent.testingCapability;
    } else if (latestCapabilityState === "ready") {
      capability.textContent = `${messages.agent.capabilityVerified} · ${messages.agent.toolsReady}`;
    } else if (latestCapabilityErrorCode !== undefined) {
      capability.textContent = messages.errors[latestCapabilityErrorCode];
    } else if (selectedProvider() === undefined) {
      capability.textContent = messages.agent.providerUnavailable;
    } else {
      capability.textContent = latestCapabilityMessage;
    }

    refreshActions();
    renderCurrentJob();
  }

  const unsubscribeLocale = localizer.subscribe(applyMessages);
  applyMessages();

  return Object.freeze({
    root,
    providerSelect,
    modelSelect,
    consentCheckbox,
    testButton,
    runButton,
    cancelButton,
    applyButton,
    revertButton,
    resetButton,

    consentGranted(): boolean {
      return consentCheckbox.checked;
    },

    readSelection(): AgentSelectionValue | undefined {
      const provider = selectedProvider();
      const model = provider?.models.find(
        (candidate) => candidate.id === modelSelect.value,
      );

      return provider === undefined || model === undefined
        ? undefined
        : Object.freeze({
            providerProfileId: provider.id,
            modelProfileId: model.id,
          });
    },

    renderCapability(
      state: "idle" | "probing" | "ready" | "error",
      message: string,
      capabilitySnapshot?: AgentCapabilitySnapshot,
      errorCode?: ErrorCode,
    ) {
      latestCapabilityState = state;
      latestCapabilityMessage = message;
      latestCapabilityErrorCode = errorCode;
      capabilityProbing = state === "probing";
      capabilityReady =
        state === "ready" && capabilitySnapshot?.state === "agent-ready";
      capability.dataset.state = state;
      capability.textContent =
        capabilitySnapshot?.state === "agent-ready"
          ? `${message} · ${messages.agent.toolsReady}`
          : message;
      refreshActions();
    },

    renderJob(
      snapshot: AgentJobSnapshot,
      result: AgentJobResult | undefined,
      activities: readonly AgentActivityItem[],
      errorCode?: ErrorCode,
    ) {
      jobPresented = true;
      setup.hidden = true;
      job.hidden = false;
      providerSelect.disabled = true;
      modelSelect.disabled = true;
      consentCheckbox.disabled = true;
      latestSnapshot = snapshot;
      latestResult = result;
      latestActivities = activities;
      latestErrorCode = errorCode;
      renderCurrentJob();
    },

    resetJob() {
      jobPresented = false;
      latestSnapshot = undefined;
      latestResult = undefined;
      latestActivities = [];
      latestErrorCode = undefined;
      setup.hidden = false;
      job.hidden = true;
      providerSelect.disabled = false;
      modelSelect.disabled = false;
      consentCheckbox.disabled = false;
      activity.replaceChildren();
      files.replaceChildren();
      checks.replaceChildren();
      diff.textContent = "";
      error.textContent = "";
      error.hidden = true;
      refreshActions();
    },

    setContextReady(ready: boolean) {
      contextReady = ready;
      refreshActions();
    },

    setEditingEnabled(enabled: boolean) {
      editingEnabled = enabled;
      providerSelect.disabled = !enabled || jobPresented;
      modelSelect.disabled = !enabled || jobPresented;
      consentCheckbox.disabled = !enabled || jobPresented;
      refreshActions();
    },

    setProviderConsent(granted: boolean) {
      consentCheckbox.checked = granted;
      refreshActions();
    },

    setSelectionVisible(visible: boolean) {
      selectionVisible = visible;
      refreshActions();

      if (!visible) {
        cancelButton.hidden = true;
        applyButton.hidden = true;
        revertButton.hidden = true;
        resetButton.hidden = true;
      }
    },

    dispose() {
      unsubscribeLocale();
      providerSelect.removeEventListener("change", handleProviderChange);
      modelSelect.removeEventListener("change", handleModelChange);
      consentCheckbox.removeEventListener("change", refreshActions);
    },
  });
}
