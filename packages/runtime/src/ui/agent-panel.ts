import type {
  AgentCapabilitySnapshot,
  AgentJobResult,
  AgentJobSnapshot,
  AgentWorkspaceHealthSnapshot,
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
  readonly workspaceConsentCheckbox: HTMLInputElement;
  readonly modelSelect: HTMLSelectElement;
  readonly providerSelect: HTMLSelectElement;
  readonly resetButton: HTMLButtonElement;
  readonly revertButton: HTMLButtonElement;
  readonly root: HTMLElement;
  readonly runButton: HTMLButtonElement;
  readonly testButton: HTMLButtonElement;
  readonly consentGranted: () => boolean;
  readonly workspaceConsentGranted: () => boolean;
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
  readonly renderWorkspaceHealth: (
    state: "idle" | "checking" | "ready" | "consent-required" | "blocked",
    snapshot?: AgentWorkspaceHealthSnapshot,
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
    margin-top: 10px;
    overflow: hidden;
    border: 1px solid var(--spotpatch-border-subtle);
    border-radius: var(--spotpatch-radius-card);
    background: rgb(255 255 255 / 2.5%);
  }
  .spotpatch-agent-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 12px;
    border-bottom: 1px solid rgb(255 255 255 / 7%);
  }
  .spotpatch-agent-title { color: #eef0f5; font-size: 13px; font-weight: 650; }
  .spotpatch-agent-badge {
    border: 1px solid rgb(129 112 247 / 24%);
    border-radius: 999px;
    padding: 3px 7px;
    color: #c5cafa;
    background: rgb(109 93 246 / 9%);
    font-size: 10px;
    font-weight: 650;
  }
  .spotpatch-agent-setup { padding: 12px; }
  .spotpatch-agent-selectors { display: grid; grid-template-columns: 1fr; gap: 10px; }
  .spotpatch-agent-selectors label { min-width: 0; color: var(--spotpatch-text-secondary); font-size: 11.5px; font-weight: 580; }
  .spotpatch-agent select {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    min-height: 34px;
    margin-top: 4px;
    border: 1px solid var(--spotpatch-border);
    border-radius: 8px;
    padding: 7px 32px 7px 9px;
    color: #e8ebf2;
    color-scheme: dark;
    background: linear-gradient(180deg, rgb(255 255 255 / 4%), rgb(255 255 255 / 2%));
    font-size: 12px;
    font-weight: 560;
    line-height: 1.35;
    outline: none;
    transition: 160ms ease;
  }
  .spotpatch-agent select:hover { border-color: rgb(148 163 184 / 38%); background-color: rgb(255 255 255 / 5%); }
  .spotpatch-agent select:focus-visible { border-color: rgb(139 124 247 / 76%); box-shadow: 0 0 0 3px rgb(109 93 246 / 18%); }
  .spotpatch-agent select option { min-height: 42px; color: #e8ebf2; background: #10151e; }
  @supports (appearance: base-select) {
    .spotpatch-agent select,
    ::picker(select) { appearance: base-select; }
    .spotpatch-agent select { padding: 7px 9px; }
    .spotpatch-agent select::picker-icon {
      color: #9da6b5;
      transition: rotate 180ms cubic-bezier(.2, .8, .2, 1);
    }
    .spotpatch-agent select:open::picker-icon { rotate: 180deg; color: #c4b5fd; }
    .spotpatch-agent select::picker(select) {
      top: calc(anchor(bottom) + 7px);
      left: anchor(left);
      width: anchor-size(width);
      max-height: min(280px, 40vh);
      margin: 0;
      overflow: hidden;
      border: 1px solid rgb(139 124 247 / 28%);
      border-radius: 12px;
      padding: 6px;
      background: #10151e;
      box-shadow: 0 18px 50px rgb(0 0 0 / 38%);
      opacity: 0;
      transform: translateY(-5px) scale(.985);
      transition: opacity 150ms ease, transform 180ms cubic-bezier(.2, .8, .2, 1), overlay 180ms allow-discrete, display 180ms allow-discrete;
    }
    ::picker(select):popover-open { opacity: 1; transform: translateY(0) scale(1); }
    @starting-style {
      ::picker(select):popover-open { opacity: 0; transform: translateY(-5px) scale(.985); }
    }
    .spotpatch-agent select option {
      min-height: 42px;
      border-radius: 8px;
      padding: 10px 12px;
      color: #dfe4ee;
      background: transparent;
      cursor: pointer;
    }
    .spotpatch-agent select option:hover,
    .spotpatch-agent select option:focus { color: #fff; background: rgb(109 93 246 / 16%); }
    .spotpatch-agent select option:checked { color: #fff; background: rgb(109 93 246 / 24%); }
    .spotpatch-agent select option::checkmark { color: #8b7cf7; }
  }
  .spotpatch-agent select:focus-visible,
  .spotpatch-consent input:focus-visible {
    outline: 2px solid #8b7cf7;
    outline-offset: 2px;
  }
  .spotpatch-consent {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-top: 10px;
    color: var(--spotpatch-text-secondary);
    cursor: pointer;
    font-size: 11.5px;
    line-height: 1.5;
  }
  .spotpatch-consent input { width: 14px; height: 14px; flex: none; margin: 2px 0 0; accent-color: var(--spotpatch-accent); }
  .spotpatch-workspace-consent {
    margin-top: 9px;
    border: 1px solid rgb(251 191 36 / 18%);
    border-radius: 10px;
    padding: 9px 10px;
    background: rgb(120 53 15 / 9%);
  }
  .spotpatch-workspace-consent strong { display: block; color: #fde68a; font-size: 11.5px; font-weight: 620; }
  .spotpatch-workspace-consent small { display: block; margin-top: 2px; color: #aeb6c4; font-size: 10.5px; line-height: 1.45; }
  .spotpatch-agent-health-list { display: grid; gap: 6px; margin-top: 10px; }
  .spotpatch-agent-workspace,
  .spotpatch-agent-capability {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    color: #929bab;
    font-size: 11px;
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
  .spotpatch-agent-workspace::before {
    width: 6px;
    height: 6px;
    flex: none;
    border-radius: 999px;
    background: #64748b;
    content: "";
  }
  .spotpatch-agent-workspace[data-state="checking"]::before { background: var(--spotpatch-warning); }
  .spotpatch-agent-workspace[data-state="ready"] { color: #a7f3d0; }
  .spotpatch-agent-workspace[data-state="ready"]::before { background: var(--spotpatch-success); }
  .spotpatch-agent-workspace[data-state="consent-required"] { color: #fde68a; }
  .spotpatch-agent-workspace[data-state="consent-required"]::before { background: #fbbf24; }
  .spotpatch-agent-workspace[data-state="blocked"] { color: #fecaca; }
  .spotpatch-agent-workspace[data-state="blocked"]::before { background: var(--spotpatch-danger); }
  .spotpatch-agent-job { padding: 12px; }
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
  const workspaceConsent = createMarkedElement(document, "label");
  workspaceConsent.className = "spotpatch-consent spotpatch-workspace-consent";
  workspaceConsent.hidden = true;
  const workspaceConsentCheckbox = createMarkedElement(document, "input");
  workspaceConsentCheckbox.type = "checkbox";
  const workspaceConsentContent = createMarkedElement(document, "span");
  const workspaceConsentTitle = createMarkedElement(document, "strong");
  const workspaceConsentHelp = createMarkedElement(document, "small");
  workspaceConsentContent.append(workspaceConsentTitle, workspaceConsentHelp);
  workspaceConsent.append(workspaceConsentCheckbox, workspaceConsentContent);
  const healthList = createMarkedElement(document, "div");
  healthList.className = "spotpatch-agent-health-list";
  const workspace = createMarkedElement(document, "p");
  workspace.className = "spotpatch-agent-workspace";
  workspace.dataset.state = "idle";
  const capability = createMarkedElement(document, "p");
  capability.className = "spotpatch-agent-capability";
  capability.dataset.state = "idle";
  healthList.append(workspace, capability);
  setup.append(selectors, consent, workspaceConsent, healthList);

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
  let latestWorkspaceState:
    "idle" | "checking" | "ready" | "consent-required" | "blocked" = "idle";
  let latestWorkspaceSnapshot: AgentWorkspaceHealthSnapshot | undefined;
  let latestWorkspaceErrorCode: ErrorCode | undefined;

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
      latestWorkspaceState === "idle" ||
      latestWorkspaceState === "checking" ||
      latestWorkspaceState === "blocked" ||
      (latestWorkspaceState === "consent-required" &&
        !workspaceConsentCheckbox.checked) ||
      selectedProvider() === undefined ||
      modelSelect.value.length === 0;

    if (!jobPresented || !selectionVisible) {
      cancelButton.hidden = true;
      applyButton.hidden = true;
      revertButton.hidden = true;
      resetButton.hidden = true;
    }
  };

  const renderWorkspaceMessage = (): void => {
    if (latestWorkspaceState === "idle") {
      workspace.textContent = messages.agent.workspaceNotChecked;
    } else if (latestWorkspaceState === "checking") {
      workspace.textContent = messages.agent.checkingWorkspace;
    } else if (latestWorkspaceState === "ready") {
      workspace.textContent = messages.agent.workspaceReady;
    } else if (latestWorkspaceState === "consent-required") {
      const changes = latestWorkspaceSnapshot?.changes;
      workspace.textContent = messages.agent.workspaceDirty(
        changes?.staged ?? 0,
        changes?.unstaged ?? 0,
        changes?.untracked ?? 0,
      );
    } else {
      workspace.textContent =
        latestWorkspaceErrorCode === undefined
          ? messages.errors.INTERNAL_ERROR
          : messages.errors[latestWorkspaceErrorCode];
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
  workspaceConsentCheckbox.addEventListener("change", refreshActions);
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
    workspaceConsentTitle.textContent = messages.agent.includeLocalChanges;
    workspaceConsentHelp.textContent = messages.agent.includeLocalChangesHelp;
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

    renderWorkspaceMessage();
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
    workspaceConsentCheckbox,
    testButton,
    runButton,
    cancelButton,
    applyButton,
    revertButton,
    resetButton,

    consentGranted(): boolean {
      return consentCheckbox.checked;
    },

    workspaceConsentGranted(): boolean {
      return workspaceConsentCheckbox.checked;
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

    renderWorkspaceHealth(
      state: "idle" | "checking" | "ready" | "consent-required" | "blocked",
      snapshot?: AgentWorkspaceHealthSnapshot,
      errorCode?: ErrorCode,
    ) {
      latestWorkspaceState = state;
      latestWorkspaceSnapshot = snapshot;
      latestWorkspaceErrorCode = errorCode ?? snapshot?.errorCode;
      workspace.dataset.state = state;
      if (state !== "checking") {
        workspaceConsent.hidden = state !== "consent-required";
      }

      if (state === "idle" || state === "ready" || state === "blocked") {
        workspaceConsentCheckbox.checked = false;
      }

      renderWorkspaceMessage();
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
      workspaceConsentCheckbox.disabled = true;
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
      workspaceConsentCheckbox.disabled = false;
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
      workspaceConsentCheckbox.disabled = !enabled || jobPresented;
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
      workspaceConsentCheckbox.removeEventListener("change", refreshActions);
    },
  });
}
