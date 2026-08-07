import type {
  AgentCapabilitySnapshot,
  AgentJobResult,
  AgentJobSnapshot,
  RuntimeAiConfig,
  RuntimeAiProviderProfile,
} from "@spotpatch/shared";

import { createButton, createMarkedElement } from "./dom.js";

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
  readonly readSelection: () => AgentSelectionValue | undefined;
  readonly renderCapability: (
    state: "idle" | "probing" | "ready" | "error",
    message: string,
    capability?: AgentCapabilitySnapshot,
  ) => void;
  readonly renderJob: (
    snapshot: AgentJobSnapshot,
    result: AgentJobResult | undefined,
    activities: readonly AgentActivityItem[],
    errorMessage?: string,
  ) => void;
  readonly resetJob: () => void;
  readonly setContextReady: (ready: boolean) => void;
  readonly setEditingEnabled: (enabled: boolean) => void;
  readonly setProviderConsent: (granted: boolean) => void;
  readonly setSelectionVisible: (visible: boolean) => void;
}

export const AGENT_PANEL_STYLES = `
  .spotpatch-agent {
    margin-top: 12px;
    overflow: hidden;
    border: 1px solid rgb(103 232 249 / 16%);
    border-radius: 14px;
    background:
      radial-gradient(circle at 100% 0%, rgb(34 211 238 / 8%), transparent 42%),
      rgb(8 15 31 / 58%);
  }
  .spotpatch-agent-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border-bottom: 1px solid rgb(148 163 184 / 10%);
  }
  .spotpatch-agent-title { color: #e0f2fe; font-size: 11.5px; font-weight: 720; }
  .spotpatch-agent-badge {
    border: 1px solid rgb(34 211 238 / 24%);
    border-radius: 999px;
    padding: 3px 7px;
    color: #67e8f9;
    background: rgb(8 145 178 / 10%);
    font: 650 9px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: .07em;
    text-transform: uppercase;
  }
  .spotpatch-agent-setup { padding: 11px 12px 12px; }
  .spotpatch-agent-selectors { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .spotpatch-agent-selectors label { min-width: 0; color: #94a3b8; font-size: 9.5px; }
  .spotpatch-agent select {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    margin-top: 4px;
    border: 1px solid rgb(129 140 248 / 22%);
    border-radius: 9px;
    padding: 7px 24px 7px 8px;
    color: #e2e8f0;
    background: #0f172a;
    font-size: 10.5px;
    outline: none;
  }
  .spotpatch-agent select:focus-visible,
  .spotpatch-consent input:focus-visible {
    outline: 2px solid #67e8f9;
    outline-offset: 2px;
  }
  .spotpatch-consent {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-top: 10px;
    color: #94a3b8;
    cursor: pointer;
    font-size: 9.5px;
    line-height: 1.45;
  }
  .spotpatch-consent input { flex: none; margin: 2px 0 0; accent-color: #6366f1; }
  .spotpatch-agent-capability {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 10px 0 0;
    color: #94a3b8;
    font-size: 9.5px;
  }
  .spotpatch-agent-capability::before {
    width: 6px;
    height: 6px;
    flex: none;
    border-radius: 999px;
    background: #64748b;
    content: "";
  }
  .spotpatch-agent-capability[data-state="probing"]::before { background: #fbbf24; box-shadow: 0 0 9px rgb(251 191 36 / 55%); }
  .spotpatch-agent-capability[data-state="ready"] { color: #a7f3d0; }
  .spotpatch-agent-capability[data-state="ready"]::before { background: #34d399; box-shadow: 0 0 9px rgb(52 211 153 / 62%); }
  .spotpatch-agent-capability[data-state="error"] { color: #fecaca; }
  .spotpatch-agent-capability[data-state="error"]::before { background: #fb7185; box-shadow: 0 0 9px rgb(251 113 133 / 55%); }
  .spotpatch-agent-job { padding: 11px 12px 12px; }
  .spotpatch-agent-job-meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .spotpatch-agent-model { min-width: 0; overflow: hidden; color: #c7d2fe; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .spotpatch-agent-status {
    flex: none;
    border-radius: 999px;
    padding: 3px 7px;
    color: #bae6fd;
    background: rgb(14 116 144 / 20%);
    font: 650 8.5px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
    text-transform: uppercase;
  }
  .spotpatch-agent-phase { margin: 8px 0 0; color: #e2e8f0; font-size: 10.5px; }
  .spotpatch-agent-error {
    margin: 9px 0 0;
    border: 1px solid rgb(251 113 133 / 22%);
    border-radius: 9px;
    padding: 7px 8px;
    color: #fecaca;
    background: rgb(127 29 29 / 14%);
    font-size: 9.5px;
  }
  .spotpatch-agent-activity { display: grid; gap: 5px; margin: 9px 0 0; padding: 0; list-style: none; }
  .spotpatch-agent-activity li { display: flex; gap: 7px; color: #94a3b8; font: 9px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .spotpatch-agent-activity li::before { color: #64748b; content: "•"; }
  .spotpatch-agent-activity li[data-state="active"]::before { color: #fbbf24; }
  .spotpatch-agent-activity li[data-state="success"]::before { color: #34d399; }
  .spotpatch-agent-activity li[data-state="failure"]::before { color: #fb7185; }
  .spotpatch-agent-result { margin-top: 11px; border-top: 1px solid rgb(148 163 184 / 10%); padding-top: 10px; }
  .spotpatch-agent-summary { margin: 0; color: #dbeafe; font-size: 10.5px; line-height: 1.5; white-space: pre-wrap; }
  .spotpatch-agent-files { display: grid; gap: 4px; margin: 9px 0 0; padding: 0; list-style: none; }
  .spotpatch-agent-files li { color: #a5b4fc; font: 9px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
  .spotpatch-agent-checks { display: grid; gap: 5px; margin-top: 9px; }
  .spotpatch-agent-checks details { border: 1px solid rgb(148 163 184 / 12%); border-radius: 8px; background: rgb(2 6 23 / 30%); }
  .spotpatch-agent-checks summary { padding: 6px 8px; color: #cbd5e1; cursor: pointer; font-size: 9px; }
  .spotpatch-agent-checks pre { max-height: 100px; margin: 0; overflow: auto; border-top: 1px solid rgb(148 163 184 / 10%); padding: 7px 8px; color: #94a3b8; font: 8.5px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; }
  .spotpatch-agent-diff {
    max-height: 230px;
    margin: 9px 0 0;
    overflow: auto;
    border: 1px solid rgb(129 140 248 / 18%);
    border-radius: 9px;
    padding: 8px;
    color: #cbd5e1;
    background: rgb(2 6 23 / 66%);
    font: 8.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
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

function statusLabel(status: AgentJobSnapshot["status"]): string {
  return status.replaceAll("-", " ");
}

export function createAgentPanel(document: Document, ai: RuntimeAiConfig): AgentPanel {
  const root = createMarkedElement(document, "section");
  root.className = "spotpatch-agent";
  root.hidden = !ai.enabled;
  const header = createMarkedElement(document, "div");
  header.className = "spotpatch-agent-head";
  const title = createMarkedElement(document, "span");
  title.className = "spotpatch-agent-title";
  title.textContent = "AI code agent";
  const badge = createMarkedElement(document, "span");
  badge.className = "spotpatch-agent-badge";
  badge.textContent = ai.enabled && ai.applyMode === "auto" ? "Auto gated" : "Review";
  header.append(title, badge);

  const setup = createMarkedElement(document, "div");
  setup.className = "spotpatch-agent-setup";
  const selectors = createMarkedElement(document, "div");
  selectors.className = "spotpatch-agent-selectors";
  const providerLabel = createMarkedElement(document, "label");
  providerLabel.textContent = "Provider";
  const providerSelect = createMarkedElement(document, "select");
  providerSelect.setAttribute("aria-label", "AI provider");
  providerLabel.append(providerSelect);
  const modelLabel = createMarkedElement(document, "label");
  modelLabel.textContent = "Model";
  const modelSelect = createMarkedElement(document, "select");
  modelSelect.setAttribute("aria-label", "AI model");
  modelLabel.append(modelSelect);
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
  capability.textContent = "Connection not tested";
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
  diff.setAttribute("aria-label", "Proposed source diff");
  resultPanel.append(resultSummary, files, checks, diff);
  job.append(jobMeta, phase, error, activity, resultPanel);
  root.append(header, setup, job);

  const testButton = createButton(document, "Test connection");
  const runButton = createButton(document, "Verify & run", "spotpatch-run");
  const cancelButton = createButton(document, "Cancel agent");
  const applyButton = createButton(document, "Apply changes", "spotpatch-primary");
  const revertButton = createButton(document, "Revert changes");
  const resetButton = createButton(document, "Revise request");

  const providers = ai.enabled ? ai.providers : [];
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  let contextReady = false;
  let editingEnabled = true;
  let selectionVisible = false;
  let jobPresented = false;
  let capabilityProbing = false;
  let capabilityReady = false;

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
      consentText.textContent = "Provider configuration is unavailable.";
      return;
    }

    for (const model of provider.models) {
      addOption(document, modelSelect, model.id, model.label);
    }

    modelSelect.value = provider.defaultModel;
    consentText.textContent = `I understand selected context and allowed source may be sent to ${provider.label}; its data policy is my responsibility.`;
  };

  const refreshActions = (): void => {
    const setupVisible = ai.enabled && selectionVisible && !jobPresented;
    runButton.textContent = capabilityProbing
      ? "Verifying…"
      : capabilityReady
        ? "Run AI"
        : "Verify & run";
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

  populateModels();
  providerSelect.addEventListener("change", () => {
    populateModels();
    consentCheckbox.checked = false;
    capability.dataset.state = "idle";
    capability.textContent = "Connection not tested";
    capabilityReady = false;
    refreshActions();
  });
  modelSelect.addEventListener("change", () => {
    capability.dataset.state = "idle";
    capability.textContent = "Connection not tested";
    capabilityReady = false;
    refreshActions();
  });
  consentCheckbox.addEventListener("change", refreshActions);
  refreshActions();

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
    ) {
      capabilityProbing = state === "probing";
      capabilityReady =
        state === "ready" && capabilitySnapshot?.state === "agent-ready";
      capability.dataset.state = state;
      capability.textContent =
        capabilitySnapshot?.state === "agent-ready"
          ? `${message} · tools + streaming ready`
          : message;
      refreshActions();
    },

    renderJob(
      snapshot: AgentJobSnapshot,
      result: AgentJobResult | undefined,
      activities: readonly AgentActivityItem[],
      errorMessage?: string,
    ) {
      jobPresented = true;
      setup.hidden = true;
      job.hidden = false;
      providerSelect.disabled = true;
      modelSelect.disabled = true;
      consentCheckbox.disabled = true;
      jobModel.textContent = `${snapshot.providerLabel} · ${snapshot.modelLabel}`;
      jobStatus.textContent = statusLabel(snapshot.status);
      phase.textContent = snapshot.phaseMessage;
      error.hidden = errorMessage === undefined;
      error.textContent = errorMessage ?? "";
      activity.replaceChildren();

      for (const item of activities.slice(-8)) {
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
        output.textContent = check.output.length === 0 ? "No output." : check.output;
        details.append(checkTitle, output);
        checks.append(details);
      }

      testButton.hidden = true;
      runButton.hidden = true;
      cancelButton.hidden = !selectionVisible || !snapshot.canCancel;
      cancelButton.textContent =
        snapshot.status === "awaiting-review" ? "Discard changes" : "Cancel agent";
      applyButton.hidden = !selectionVisible || !snapshot.canApply;
      revertButton.hidden = !selectionVisible || !snapshot.canRevert;
      resetButton.hidden =
        !selectionVisible ||
        !["completed", "cancelled", "reverted", "failed"].includes(snapshot.status);
    },

    resetJob() {
      jobPresented = false;
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
  });
}
