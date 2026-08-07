import type {
  AgentCapabilitySnapshot,
  AgentJobResult,
  AgentJobSnapshot,
  RuntimeAiConfig,
} from "@spotpatch/shared";

import type { ElementRect } from "../picker/geometry.js";
import type { RuntimeStatus } from "../state/runtime-state.js";
import {
  AGENT_PANEL_STYLES,
  createAgentPanel,
  type AgentActivityItem,
  type AgentSelectionValue,
} from "./agent-panel.js";
import { calculateDialogPlacement } from "./dialog-placement.js";
import { createButton, createMarkedElement } from "./dom.js";
import { UI_MARKER_ATTRIBUTE, UI_Z_INDEX } from "./ui-constants.js";

export interface RuntimeView {
  readonly agentApplyButton: HTMLButtonElement;
  readonly agentCancelButton: HTMLButtonElement;
  readonly agentConsentCheckbox: HTMLInputElement;
  readonly agentModelSelect: HTMLSelectElement;
  readonly agentProviderSelect: HTMLSelectElement;
  readonly agentResetButton: HTMLButtonElement;
  readonly agentRevertButton: HTMLButtonElement;
  readonly agentRunButton: HTMLButtonElement;
  readonly agentTestButton: HTMLButtonElement;
  readonly backButton: HTMLButtonElement;
  readonly closeButton: HTMLButtonElement;
  readonly copyButton: HTMLButtonElement;
  readonly host: HTMLElement;
  readonly noteInput: HTMLTextAreaElement;
  readonly openEditorButton: HTMLButtonElement;
  readonly previewButton: HTMLButtonElement;
  readonly reselectButton: HTMLButtonElement;
  readonly triggerButton: HTMLButtonElement;
  readonly announce: (message: string) => void;
  readonly dispose: () => void;
  readonly focusNote: () => void;
  readonly focusPrompt: () => void;
  readonly hideHighlight: () => void;
  readonly hideSelection: () => void;
  readonly agentConsentGranted: () => boolean;
  readonly readAgentSelection: () => AgentSelectionValue | undefined;
  readonly readNote: () => string;
  readonly renderAgentCapability: (
    state: "idle" | "probing" | "ready" | "error",
    message: string,
    capability?: AgentCapabilitySnapshot,
  ) => void;
  readonly renderAgentJob: (
    snapshot: AgentJobSnapshot,
    result: AgentJobResult | undefined,
    activities: readonly AgentActivityItem[],
    errorMessage?: string,
  ) => void;
  readonly renderStatus: (status: RuntimeStatus) => void;
  readonly resetAgentJob: () => void;
  readonly setAgentEditingEnabled: (enabled: boolean) => void;
  readonly setAgentProviderConsent: (granted: boolean) => void;
  readonly setPreviewEnabled: (enabled: boolean) => void;
  readonly showHighlight: (rect: ElementRect, label: string) => void;
  readonly showPreview: (prompt: string) => void;
  readonly showSelection: (
    summary: string,
    canOpenEditor: boolean,
    canPreview: boolean,
  ) => void;
  readonly updateSelection: (
    summary: string,
    canOpenEditor: boolean,
    canPreview: boolean,
  ) => void;
}

const DIALOG_FALLBACK_WIDTH = 460;
const DIALOG_FALLBACK_HEIGHT = Object.freeze({
  previewing: 560,
  selected: 620,
}) satisfies Readonly<Record<"previewing" | "selected", number>>;

function createStyles(document: Document): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = `
    :host {
      all: initial;
      color-scheme: dark;
      color: #f8fafc;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      line-height: 1.45;
      text-rendering: optimizeLegibility;
    }
    [hidden] { display: none !important; }
    button, textarea { font: inherit; }
    .spotpatch-trigger {
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: ${String(UI_Z_INDEX.controls)};
      display: inline-flex;
      align-items: center;
      gap: 9px;
      border: 1px solid rgb(148 163 184 / 35%);
      border-radius: 999px;
      padding: 10px 16px;
      color: #f8fafc;
      background: linear-gradient(135deg, rgb(15 23 42 / 96%), rgb(17 24 39 / 96%));
      box-shadow: 0 12px 36px rgb(15 23 42 / 25%), inset 0 1px rgb(255 255 255 / 8%);
      backdrop-filter: blur(18px);
      cursor: pointer;
      font-weight: 680;
      letter-spacing: -.01em;
      transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
    }
    .spotpatch-trigger::before {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: #818cf8;
      box-shadow: 0 0 0 4px rgb(99 102 241 / 13%), 0 0 16px rgb(129 140 248 / 75%);
      content: "";
    }
    .spotpatch-trigger:hover { transform: translateY(-1px); border-color: rgb(129 140 248 / 70%); }
    .spotpatch-trigger[aria-pressed="true"] {
      border-color: rgb(129 140 248 / 85%);
      background: linear-gradient(135deg, #4338ca, #6366f1);
      box-shadow: 0 14px 42px rgb(79 70 229 / 35%), inset 0 1px rgb(255 255 255 / 16%);
    }
    .spotpatch-trigger[aria-pressed="true"]::before {
      background: #ecfeff;
      box-shadow: 0 0 0 4px rgb(255 255 255 / 16%), 0 0 18px rgb(224 231 255 / 90%);
    }
    .spotpatch-highlight {
      position: fixed;
      top: 0;
      left: 0;
      z-index: ${String(UI_Z_INDEX.highlight)};
      box-sizing: border-box;
      border: 2px solid #6366f1;
      border-radius: 4px;
      background: linear-gradient(135deg, rgb(99 102 241 / 11%), rgb(34 211 238 / 5%));
      box-shadow: inset 0 0 0 1px rgb(224 231 255 / 32%), 0 0 0 1px rgb(99 102 241 / 10%), 0 0 28px rgb(99 102 241 / 16%);
      pointer-events: none;
    }
    .spotpatch-highlight-label {
      position: absolute;
      top: -30px;
      left: -2px;
      max-width: min(380px, 80vw);
      overflow: hidden;
      border: 1px solid rgb(199 210 254 / 35%);
      border-radius: 8px 8px 8px 2px;
      padding: 5px 9px;
      color: #fff;
      background: linear-gradient(135deg, #4f46e5, #6366f1);
      box-shadow: 0 6px 20px rgb(79 70 229 / 28%);
      font: 650 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
      letter-spacing: -.01em;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spotpatch-dialog {
      --spotpatch-anchor-x: 50%;
      --spotpatch-anchor-y: 50%;
      position: fixed;
      top: 16px;
      left: 16px;
      z-index: ${String(UI_Z_INDEX.controls)};
      box-sizing: border-box;
      width: min(460px, calc(100vw - 32px));
      color: #e5e7eb;
      outline: none;
      filter: drop-shadow(0 28px 70px rgb(2 6 23 / 38%));
    }
    .spotpatch-anchor {
      position: absolute;
      z-index: 0;
      width: 14px;
      height: 14px;
      border: 1px solid rgb(129 140 248 / 42%);
      background: #11182d;
      transform: rotate(45deg);
    }
    .spotpatch-dialog[data-placement="above"] .spotpatch-anchor {
      bottom: -6px;
      left: calc(var(--spotpatch-anchor-x) - 7px);
      border-top: 0;
      border-left: 0;
    }
    .spotpatch-dialog[data-placement="below"] .spotpatch-anchor {
      top: -6px;
      left: calc(var(--spotpatch-anchor-x) - 7px);
      border-right: 0;
      border-bottom: 0;
    }
    .spotpatch-dialog[data-placement="left"] .spotpatch-anchor {
      top: calc(var(--spotpatch-anchor-y) - 7px);
      right: -6px;
      border-bottom: 0;
      border-left: 0;
    }
    .spotpatch-dialog[data-placement="right"] .spotpatch-anchor {
      top: calc(var(--spotpatch-anchor-y) - 7px);
      left: -6px;
      border-top: 0;
      border-right: 0;
    }
    .spotpatch-dialog[data-placement="center"] .spotpatch-anchor,
    .spotpatch-dialog[data-placement="viewport"] .spotpatch-anchor { display: none; }
    .spotpatch-shell {
      position: relative;
      z-index: 1;
      display: flex;
      max-height: min(620px, calc(100vh - 32px));
      overflow: hidden;
      flex-direction: column;
      border: 1px solid rgb(129 140 248 / 32%);
      border-radius: 22px;
      background:
        radial-gradient(circle at 12% 0%, rgb(99 102 241 / 20%), transparent 36%),
        radial-gradient(circle at 100% 20%, rgb(34 211 238 / 8%), transparent 30%),
        linear-gradient(145deg, rgb(10 16 33 / 97%), rgb(8 13 27 / 98%));
      box-shadow: inset 0 1px rgb(255 255 255 / 9%), inset 0 0 0 1px rgb(15 23 42 / 55%);
      backdrop-filter: blur(24px) saturate(135%);
    }
    .spotpatch-shell::before {
      position: absolute;
      inset: 0;
      z-index: -1;
      opacity: .18;
      background-image:
        linear-gradient(rgb(129 140 248 / 12%) 1px, transparent 1px),
        linear-gradient(90deg, rgb(129 140 248 / 12%) 1px, transparent 1px);
      background-size: 28px 28px;
      mask-image: linear-gradient(to bottom, #000, transparent 45%);
      pointer-events: none;
      content: "";
    }
    .spotpatch-header {
      position: relative;
      padding: 18px 20px 14px;
      border-bottom: 1px solid rgb(148 163 184 / 13%);
    }
    .spotpatch-brand-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 12px;
    }
    .spotpatch-brand {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: #a5b4fc;
      font: 700 10px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
      letter-spacing: .14em;
      text-transform: uppercase;
    }
    .spotpatch-brand-dot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: #22d3ee;
      box-shadow: 0 0 0 4px rgb(34 211 238 / 10%), 0 0 14px rgb(34 211 238 / 75%);
    }
    .spotpatch-close {
      display: inline-grid;
      width: 28px;
      height: 28px;
      padding: 0;
      place-items: center;
      border: 1px solid rgb(148 163 184 / 20%);
      border-radius: 9px;
      color: #94a3b8;
      background: rgb(15 23 42 / 55%);
      cursor: pointer;
      font-size: 17px;
      line-height: 1;
      transition: border-color 150ms ease, color 150ms ease, background 150ms ease;
    }
    .spotpatch-close:hover { border-color: rgb(129 140 248 / 48%); color: #fff; background: rgb(79 70 229 / 20%); }
    .spotpatch-title {
      margin: 0;
      color: #fff;
      font-size: 19px;
      font-weight: 720;
      letter-spacing: -.025em;
    }
    .spotpatch-subtitle {
      margin: 4px 0 0;
      color: #94a3b8;
      font-size: 12px;
    }
    .spotpatch-target-row {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      margin-top: 13px;
    }
    .spotpatch-target-label {
      min-width: 0;
      overflow: hidden;
      border: 1px solid rgb(129 140 248 / 24%);
      border-radius: 999px;
      padding: 5px 9px;
      color: #c7d2fe;
      background: rgb(79 70 229 / 11%);
      font: 600 10.5px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spotpatch-context-state {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex: none;
      color: #94a3b8;
      font-size: 10.5px;
      white-space: nowrap;
    }
    .spotpatch-context-state::before {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: #fbbf24;
      box-shadow: 0 0 9px rgb(251 191 36 / 55%);
      content: "";
    }
    .spotpatch-context-state[data-state="ready"] { color: #a7f3d0; }
    .spotpatch-context-state[data-state="ready"]::before { background: #34d399; box-shadow: 0 0 9px rgb(52 211 153 / 65%); }
    .spotpatch-context-state[data-state="warning"] { color: #fecaca; }
    .spotpatch-context-state[data-state="warning"]::before { background: #fb7185; box-shadow: 0 0 9px rgb(251 113 133 / 60%); }
    .spotpatch-body {
      min-height: 0;
      overflow: auto;
      padding: 16px 20px 18px;
      scrollbar-color: rgb(100 116 139 / 50%) transparent;
      scrollbar-width: thin;
    }
    .spotpatch-field { display: block; color: #e2e8f0; }
    .spotpatch-field-heading {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
    }
    .spotpatch-field-title { font-size: 12px; font-weight: 680; }
    .spotpatch-field-hint { color: #64748b; font: 500 10px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .spotpatch-field textarea {
      box-sizing: border-box;
      width: 100%;
      min-height: 112px;
      resize: none;
      border: 1px solid rgb(129 140 248 / 28%);
      border-radius: 14px;
      padding: 12px 13px;
      color: #f8fafc;
      caret-color: #67e8f9;
      background: rgb(2 6 23 / 58%);
      box-shadow: inset 0 1px 9px rgb(2 6 23 / 24%);
      line-height: 1.55;
      outline: none;
      transition: border-color 150ms ease, box-shadow 150ms ease, background 150ms ease;
    }
    .spotpatch-field textarea::placeholder { color: #64748b; }
    .spotpatch-field textarea:hover { border-color: rgb(129 140 248 / 45%); }
    .spotpatch-field textarea:focus {
      border-color: rgb(103 232 249 / 68%);
      background: rgb(2 6 23 / 75%);
      box-shadow: 0 0 0 3px rgb(34 211 238 / 9%), 0 0 24px rgb(99 102 241 / 11%);
    }
    .spotpatch-diagnostics {
      margin-top: 12px;
      overflow: hidden;
      border: 1px solid rgb(148 163 184 / 14%);
      border-radius: 12px;
      background: rgb(15 23 42 / 38%);
    }
    .spotpatch-diagnostics > summary {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 9px 11px;
      color: #a5b4fc;
      cursor: pointer;
      font-size: 11px;
      font-weight: 650;
      list-style: none;
      user-select: none;
    }
    .spotpatch-diagnostics > summary::-webkit-details-marker { display: none; }
    .spotpatch-diagnostics > summary::before {
      color: #64748b;
      content: "›";
      font-size: 16px;
      line-height: 1;
      transform: rotate(0deg);
      transition: transform 150ms ease;
    }
    .spotpatch-diagnostics[open] > summary::before { transform: rotate(90deg); }
    .spotpatch-source-peek {
      min-width: 0;
      overflow: hidden;
      margin-left: auto;
      color: #64748b;
      font: 500 9.5px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spotpatch-summary {
      max-height: 116px;
      margin: 0;
      overflow: auto;
      border-top: 1px solid rgb(148 163 184 / 10%);
      padding: 10px 11px 11px;
      color: #94a3b8;
      font: 10.5px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
      user-select: text;
    }
    .spotpatch-prompt {
      max-height: min(410px, 52vh);
      margin: 0;
      overflow: auto;
      border: 1px solid rgb(129 140 248 / 25%);
      border-radius: 14px;
      padding: 13px;
      color: #dbeafe;
      background: rgb(2 6 23 / 72%);
      box-shadow: inset 0 1px 12px rgb(2 6 23 / 28%);
      font: 11px/1.58 ui-monospace, SFMono-Regular, Menlo, monospace;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
      user-select: text;
    }
    .spotpatch-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 13px 20px 16px;
      border-top: 1px solid rgb(148 163 184 / 13%);
      background: rgb(8 13 27 / 68%);
    }
    .spotpatch-actions button {
      display: inline-flex;
      min-height: 36px;
      align-items: center;
      justify-content: center;
      border: 1px solid rgb(148 163 184 / 22%);
      border-radius: 11px;
      padding: 8px 11px;
      color: #dbeafe;
      background: rgb(30 41 59 / 64%);
      cursor: pointer;
      font-size: 11.5px;
      font-weight: 650;
      transition: border-color 150ms ease, box-shadow 150ms ease, color 150ms ease, transform 150ms ease;
    }
    .spotpatch-actions button:hover:not(:disabled) {
      border-color: rgb(129 140 248 / 52%);
      color: #fff;
      transform: translateY(-1px);
    }
    .spotpatch-actions .spotpatch-primary {
      min-width: 142px;
      flex: 1;
      border-color: rgb(129 140 248 / 66%);
      color: #fff;
      background: linear-gradient(135deg, #4f46e5, #6366f1 58%, #2563eb);
      box-shadow: 0 9px 24px rgb(79 70 229 / 24%), inset 0 1px rgb(255 255 255 / 16%);
    }
    .spotpatch-actions .spotpatch-primary::after { margin-left: 8px; content: "↗"; font-size: 12px; }
    .spotpatch-actions button:disabled { cursor: not-allowed; opacity: .38; transform: none; }
    .spotpatch-actions button:focus-visible,
    .spotpatch-close:focus-visible,
    .spotpatch-trigger:focus-visible,
    .spotpatch-field textarea:focus-visible,
    .spotpatch-prompt:focus-visible,
    .spotpatch-diagnostics > summary:focus-visible {
      outline: 2px solid #67e8f9;
      outline-offset: 2px;
    }
    .spotpatch-live {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      clip-path: inset(50%);
      white-space: nowrap;
    }
    @media (prefers-reduced-motion: reduce) {
      .spotpatch-trigger,
      .spotpatch-actions button,
      .spotpatch-diagnostics > summary::before { transition: none; }
    }
    ${AGENT_PANEL_STYLES}
  `;
  return style;
}

function summaryLine(summary: string, prefix: string): string | undefined {
  const line = summary
    .split("\n")
    .find((candidate) => candidate.startsWith(`${prefix}: `));
  return line?.slice(prefix.length + 2).trim();
}

export function createRuntimeView(
  document: Document,
  shortcut: string,
  ai: RuntimeAiConfig = Object.freeze({ enabled: false }),
): RuntimeView {
  const host = document.createElement("spotpatch-root");
  host.setAttribute(UI_MARKER_ATTRIBUTE, "");
  const shadowRoot = host.attachShadow({ mode: "open" });
  const triggerButton = createButton(document, "Select element", "spotpatch-trigger");
  triggerButton.title = `Toggle SpotPatch (${shortcut})`;
  triggerButton.setAttribute("aria-pressed", "false");

  const highlight = createMarkedElement(document, "div");
  highlight.className = "spotpatch-highlight";
  highlight.hidden = true;
  const highlightLabel = createMarkedElement(document, "span");
  highlightLabel.className = "spotpatch-highlight-label";
  highlight.append(highlightLabel);

  const dialog = createMarkedElement(document, "section");
  dialog.className = "spotpatch-dialog";
  dialog.hidden = true;
  dialog.tabIndex = -1;
  dialog.dataset.placement = "viewport";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-labelledby", "spotpatch-selection-title");
  const anchor = createMarkedElement(document, "span");
  anchor.className = "spotpatch-anchor";
  anchor.setAttribute("aria-hidden", "true");
  const shell = createMarkedElement(document, "div");
  shell.className = "spotpatch-shell";

  const header = createMarkedElement(document, "header");
  header.className = "spotpatch-header";
  const brandRow = createMarkedElement(document, "div");
  brandRow.className = "spotpatch-brand-row";
  const brand = createMarkedElement(document, "span");
  brand.className = "spotpatch-brand";
  const brandDot = createMarkedElement(document, "span");
  brandDot.className = "spotpatch-brand-dot";
  brandDot.setAttribute("aria-hidden", "true");
  const brandText = createMarkedElement(document, "span");
  brandText.textContent = "SpotPatch // Live context";
  brand.append(brandDot, brandText);
  const closeButton = createButton(document, "×", "spotpatch-close");
  closeButton.setAttribute("aria-label", "Close SpotPatch");
  closeButton.title = "Close";
  brandRow.append(brand, closeButton);
  const title = createMarkedElement(document, "h2");
  title.id = "spotpatch-selection-title";
  title.className = "spotpatch-title";
  title.textContent = "Describe the change";
  const subtitle = createMarkedElement(document, "p");
  subtitle.className = "spotpatch-subtitle";
  subtitle.textContent = "Your selection is locked. Add the instruction for AI below.";
  const targetRow = createMarkedElement(document, "div");
  targetRow.className = "spotpatch-target-row";
  const targetLabel = createMarkedElement(document, "span");
  targetLabel.className = "spotpatch-target-label";
  targetLabel.textContent = "Selected element";
  const contextState = createMarkedElement(document, "span");
  contextState.className = "spotpatch-context-state";
  contextState.dataset.state = "loading";
  contextState.textContent = "Collecting context";
  targetRow.append(targetLabel, contextState);
  header.append(brandRow, title, subtitle, targetRow);

  const body = createMarkedElement(document, "div");
  body.className = "spotpatch-body";
  const selectionPanel = createMarkedElement(document, "div");
  selectionPanel.className = "spotpatch-selection-panel";
  const noteLabel = createMarkedElement(document, "label");
  noteLabel.className = "spotpatch-field";
  noteLabel.htmlFor = "spotpatch-change-note";
  const fieldHeading = createMarkedElement(document, "span");
  fieldHeading.className = "spotpatch-field-heading";
  const fieldTitle = createMarkedElement(document, "span");
  fieldTitle.className = "spotpatch-field-title";
  fieldTitle.textContent = "What should change?";
  const fieldHint = createMarkedElement(document, "span");
  fieldHint.className = "spotpatch-field-hint";
  fieldHint.textContent = "Ready for input";
  fieldHeading.append(fieldTitle, fieldHint);
  const noteInput = createMarkedElement(document, "textarea");
  noteInput.id = "spotpatch-change-note";
  noteInput.rows = 5;
  noteInput.placeholder = "Describe the problem, desired result, and any constraints…";
  noteLabel.append(fieldHeading, noteInput);
  const diagnostics = createMarkedElement(document, "details");
  diagnostics.className = "spotpatch-diagnostics";
  const diagnosticsLabel = createMarkedElement(document, "summary");
  diagnosticsLabel.textContent = "Captured context";
  const sourcePeek = createMarkedElement(document, "span");
  sourcePeek.className = "spotpatch-source-peek";
  sourcePeek.textContent = "Resolving source…";
  diagnosticsLabel.append(sourcePeek);
  const summary = createMarkedElement(document, "pre");
  summary.className = "spotpatch-summary";
  diagnostics.append(diagnosticsLabel, summary);
  const agentPanel = createAgentPanel(document, ai);
  selectionPanel.append(noteLabel, diagnostics, agentPanel.root);

  const previewPanel = createMarkedElement(document, "div");
  previewPanel.className = "spotpatch-preview-panel";
  previewPanel.hidden = true;
  const promptOutput = createMarkedElement(document, "pre");
  promptOutput.className = "spotpatch-prompt";
  promptOutput.tabIndex = 0;
  promptOutput.setAttribute("aria-label", "Generated prompt");
  previewPanel.append(promptOutput);
  body.append(selectionPanel, previewPanel);

  const actions = createMarkedElement(document, "footer");
  actions.className = "spotpatch-actions";
  const reselectButton = createButton(document, "Reselect");
  const openEditorButton = createButton(document, "Open in VS Code");
  const previewButton = createButton(document, "Preview prompt", "spotpatch-primary");
  const copyButton = createButton(document, "Copy prompt", "spotpatch-primary");
  const backButton = createButton(document, "Back to edit");
  actions.append(
    agentPanel.runButton,
    previewButton,
    agentPanel.testButton,
    agentPanel.cancelButton,
    agentPanel.applyButton,
    agentPanel.revertButton,
    agentPanel.resetButton,
    openEditorButton,
    reselectButton,
    copyButton,
    backButton,
  );
  shell.append(header, body, actions);
  dialog.append(anchor, shell);

  const liveRegion = createMarkedElement(document, "div");
  liveRegion.className = "spotpatch-live";
  liveRegion.setAttribute("aria-live", "polite");
  liveRegion.setAttribute("aria-atomic", "true");

  shadowRoot.append(
    createStyles(document),
    highlight,
    dialog,
    triggerButton,
    liveRegion,
  );
  document.documentElement.append(host);

  let currentRect: ElementRect | undefined;
  let currentStatus: RuntimeStatus = "idle";
  let currentCanOpenEditor = false;
  let currentCanPreview = false;

  function placeDialog(): void {
    if (dialog.hidden || currentRect === undefined) {
      return;
    }

    const view = document.defaultView;
    const viewportWidth = view?.innerWidth ?? document.documentElement.clientWidth;
    const viewportHeight = view?.innerHeight ?? document.documentElement.clientHeight;
    const measured = dialog.getBoundingClientRect();
    const status = currentStatus === "previewing" ? "previewing" : "selected";
    const dialogWidth =
      measured.width > 0
        ? measured.width
        : Math.min(DIALOG_FALLBACK_WIDTH, viewportWidth - 32);
    const dialogHeight =
      measured.height > 0
        ? measured.height
        : Math.min(DIALOG_FALLBACK_HEIGHT[status], viewportHeight - 32);
    const placement = calculateDialogPlacement({
      target: currentRect,
      dialogWidth,
      dialogHeight,
      viewportWidth,
      viewportHeight,
    });

    dialog.style.left = `${String(placement.left)}px`;
    dialog.style.top = `${String(placement.top)}px`;
    dialog.style.setProperty("--spotpatch-anchor-x", `${String(placement.anchorX)}px`);
    dialog.style.setProperty("--spotpatch-anchor-y", `${String(placement.anchorY)}px`);
    dialog.dataset.placement = placement.mode;
  }

  function updateContextOverview(summaryText: string): void {
    const source = summaryLine(summaryText, "Source");
    sourcePeek.textContent = source ?? "No exact source marker";

    if (
      summaryText.includes("Browser context: ready") &&
      !summaryText.includes("API: loading")
    ) {
      contextState.dataset.state = "ready";
      contextState.textContent = "Context ready";
    } else if (
      summaryText.includes("Browser context: failed") ||
      summaryText.includes("API: failed")
    ) {
      contextState.dataset.state = "warning";
      contextState.textContent = "Partial context";
    } else {
      contextState.dataset.state = "loading";
      contextState.textContent = "Collecting context";
    }
  }

  function updateSelection(
    summaryText: string,
    canOpenEditor: boolean,
    canPreview: boolean,
  ): void {
    currentCanOpenEditor = canOpenEditor;
    currentCanPreview = canPreview;
    summary.textContent = summaryText;
    openEditorButton.disabled = !canOpenEditor;
    previewButton.disabled = !canPreview;
    agentPanel.setContextReady(canPreview);
    updateContextOverview(summaryText);
    placeDialog();
  }

  function renderPanelStatus(status: RuntimeStatus): void {
    currentStatus = status;
    const selected = status === "selected";
    const previewing = status === "previewing";
    selectionPanel.hidden = !selected;
    previewPanel.hidden = !previewing;
    reselectButton.hidden = !selected;
    openEditorButton.hidden = !selected;
    previewButton.hidden = !selected;
    agentPanel.setSelectionVisible(selected);
    copyButton.hidden = !previewing;
    backButton.hidden = !previewing;
    title.textContent = previewing ? "Prompt ready" : "Describe the change";
    subtitle.textContent = previewing
      ? "Review the generated context before sending it to your AI coding agent."
      : "Your selection is locked. Add the instruction for AI below.";
    placeDialog();
  }

  diagnostics.addEventListener("toggle", placeDialog);

  return Object.freeze({
    host,
    triggerButton,
    noteInput,
    reselectButton,
    openEditorButton,
    previewButton,
    copyButton,
    backButton,
    closeButton,
    agentProviderSelect: agentPanel.providerSelect,
    agentModelSelect: agentPanel.modelSelect,
    agentConsentCheckbox: agentPanel.consentCheckbox,
    agentTestButton: agentPanel.testButton,
    agentRunButton: agentPanel.runButton,
    agentCancelButton: agentPanel.cancelButton,
    agentApplyButton: agentPanel.applyButton,
    agentRevertButton: agentPanel.revertButton,
    agentResetButton: agentPanel.resetButton,

    renderStatus(status: RuntimeStatus): void {
      const inspecting = status === "inspecting";
      triggerButton.setAttribute("aria-pressed", String(inspecting));
      triggerButton.textContent = inspecting ? "Stop selecting" : "Select element";
      renderPanelStatus(status);
    },

    showHighlight(rect: ElementRect, label: string): void {
      currentRect = rect;
      highlight.hidden = false;
      highlight.style.transform = `translate(${String(rect.x)}px, ${String(rect.y)}px)`;
      highlight.style.width = `${String(rect.width)}px`;
      highlight.style.height = `${String(rect.height)}px`;
      highlightLabel.textContent = label;
      targetLabel.textContent = label;
      placeDialog();
    },

    hideHighlight(): void {
      currentRect = undefined;
      highlight.hidden = true;
      highlightLabel.textContent = "";
      targetLabel.textContent = "Selected element";
    },

    showSelection(
      summaryText: string,
      canOpenEditor: boolean,
      canPreview: boolean,
    ): void {
      updateSelection(summaryText, canOpenEditor, canPreview);
      dialog.hidden = false;
      placeDialog();
    },

    updateSelection,

    setPreviewEnabled(enabled: boolean): void {
      currentCanPreview = enabled;
      previewButton.disabled = !enabled;
      agentPanel.setContextReady(enabled);
    },

    hideSelection(): void {
      dialog.hidden = true;
      summary.textContent = "";
      noteInput.value = "";
      promptOutput.textContent = "";
      sourcePeek.textContent = "Resolving source…";
      contextState.dataset.state = "loading";
      contextState.textContent = "Collecting context";
      openEditorButton.disabled = true;
      previewButton.disabled = true;
      currentCanOpenEditor = false;
      currentCanPreview = false;
      agentPanel.setContextReady(false);
      agentPanel.setSelectionVisible(false);
      agentPanel.setEditingEnabled(true);
      agentPanel.resetJob();
    },

    showPreview(prompt: string): void {
      promptOutput.textContent = prompt;
      placeDialog();
    },

    readNote(): string {
      return noteInput.value;
    },

    readAgentSelection(): AgentSelectionValue | undefined {
      return agentPanel.readSelection();
    },

    agentConsentGranted(): boolean {
      return agentPanel.consentGranted();
    },

    setAgentProviderConsent(granted: boolean): void {
      agentPanel.setProviderConsent(granted);
    },

    setAgentEditingEnabled(enabled: boolean): void {
      noteInput.disabled = !enabled;
      reselectButton.disabled = !enabled;
      openEditorButton.disabled = !enabled || !currentCanOpenEditor;
      previewButton.disabled = !enabled || !currentCanPreview;
      agentPanel.setEditingEnabled(enabled);
      placeDialog();
    },

    renderAgentCapability(
      state: "idle" | "probing" | "ready" | "error",
      message: string,
      capabilitySnapshot?: AgentCapabilitySnapshot,
    ): void {
      agentPanel.renderCapability(state, message, capabilitySnapshot);
      const agentReady =
        state === "ready" && capabilitySnapshot?.state === "agent-ready";
      previewButton.classList.toggle("spotpatch-primary", !agentReady);
      placeDialog();
    },

    renderAgentJob(
      snapshot: AgentJobSnapshot,
      result: AgentJobResult | undefined,
      activities: readonly AgentActivityItem[],
      errorMessage?: string,
    ): void {
      agentPanel.renderJob(snapshot, result, activities, errorMessage);
      placeDialog();
    },

    resetAgentJob(): void {
      agentPanel.resetJob();
      noteInput.disabled = false;
      placeDialog();
    },

    focusNote(): void {
      noteInput.focus({ preventScroll: true });
    },

    focusPrompt(): void {
      promptOutput.focus({ preventScroll: true });
    },

    announce(message: string): void {
      liveRegion.textContent = "";
      liveRegion.textContent = message;
    },

    dispose(): void {
      diagnostics.removeEventListener("toggle", placeDialog);
      host.remove();
    },
  });
}
