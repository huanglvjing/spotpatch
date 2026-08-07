import type {
  AgentCapabilitySnapshot,
  AgentJobResult,
  AgentJobSnapshot,
  ErrorCode,
  RuntimeAiConfig,
  SpotPatchLocale,
  SpotPatchLocalePreference,
} from "@spotpatch/shared";
import {
  MAX_ANNOTATION_INSTRUCTION_CHARACTERS,
  MAX_TARGET_INSTRUCTION_CHARACTERS,
} from "@spotpatch/shared";

import type { ElementRect } from "../picker/geometry.js";
import type { RuntimeStatus } from "../state/runtime-state.js";
import {
  AGENT_PANEL_STYLES,
  createAgentPanel,
  type AgentActivityItem,
  type AgentSelectionValue,
} from "./agent-panel.js";
import { createBrandMark } from "./brand-mark.js";
import { calculateDialogPlacement } from "./dialog-placement.js";
import { createButton, createMarkedElement } from "./dom.js";
import {
  createUiLocalizer,
  type UiLocalizer,
  type UiMessages,
} from "./localization.js";
import { UI_MARKER_ATTRIBUTE, UI_Z_INDEX } from "./ui-constants.js";

export interface SelectionTargetView {
  readonly active: boolean;
  readonly id: string;
  readonly instruction: string;
  readonly label: string;
  readonly source: string;
  readonly status: "loading" | "ready" | "warning";
}

export interface SelectionHighlightView {
  readonly active: boolean;
  readonly id: string;
  readonly label: string;
  readonly rect: ElementRect;
}

export interface RuntimeView {
  readonly addTargetButton: HTMLButtonElement;
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
  readonly openEditorButton: HTMLButtonElement;
  readonly previewButton: HTMLButtonElement;
  readonly reselectButton: HTMLButtonElement;
  readonly triggerButton: HTMLButtonElement;
  readonly targetList: HTMLElement;
  readonly announce: (message: string) => void;
  readonly dispose: () => void;
  readonly focusTargetInstruction: (targetId?: string) => void;
  readonly focusPrompt: () => void;
  readonly hideHighlight: () => void;
  readonly hideSelectionHighlights: () => void;
  readonly hideSelection: () => void;
  readonly hideSelectionTemporarily: () => void;
  readonly agentConsentGranted: () => boolean;
  readonly readAgentSelection: () => AgentSelectionValue | undefined;
  readonly locale: () => SpotPatchLocale;
  readonly messages: () => UiMessages;
  readonly subscribeLocale: (listener: () => void) => () => void;
  readonly renderAgentCapability: (
    state: "idle" | "probing" | "ready" | "error",
    message: string,
    capability?: AgentCapabilitySnapshot,
    errorCode?: ErrorCode,
  ) => void;
  readonly renderAgentJob: (
    snapshot: AgentJobSnapshot,
    result: AgentJobResult | undefined,
    activities: readonly AgentActivityItem[],
    errorCode?: ErrorCode,
  ) => void;
  readonly renderStatus: (status: RuntimeStatus) => void;
  readonly resetAgentJob: () => void;
  readonly setAgentEditingEnabled: (enabled: boolean) => void;
  readonly setAgentProviderConsent: (granted: boolean) => void;
  readonly setPreviewEnabled: (enabled: boolean) => void;
  readonly updateTargetInstruction: (targetId: string, instruction: string) => void;
  readonly renderTargets: (
    targets: readonly SelectionTargetView[],
    maximum: number,
  ) => void;
  readonly showHighlight: (rect: ElementRect, label: string) => void;
  readonly showSelectionHighlights: (
    targets: readonly SelectionHighlightView[],
  ) => void;
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

const DIALOG_FALLBACK_WIDTH = 560;
const DIALOG_FALLBACK_HEIGHT = Object.freeze({
  previewing: 640,
  selected: 720,
}) satisfies Readonly<Record<"previewing" | "selected", number>>;

function createStyles(document: Document): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = `
    :host {
      all: initial;
      --spotpatch-bg: #11141a;
      --spotpatch-bg-raised: #191d25;
      --spotpatch-bg-input: #0c0f14;
      --spotpatch-border: #303641;
      --spotpatch-border-subtle: #262c35;
      --spotpatch-text: #f4f6fb;
      --spotpatch-text-secondary: #a4adbd;
      --spotpatch-text-muted: #7f899a;
      --spotpatch-accent: #7060ee;
      --spotpatch-accent-strong: #604ee8;
      --spotpatch-accent-cyan: #27b8cf;
      --spotpatch-danger: #fb7185;
      --spotpatch-success: #34d399;
      --spotpatch-warning: #f59e0b;
      --spotpatch-radius-panel: 24px;
      --spotpatch-radius-card: 15px;
      --spotpatch-shadow-panel: 0 28px 72px rgb(0 0 0 / 38%);
      color-scheme: dark;
      color: var(--spotpatch-text);
      font-family: Inter, "SF Pro Display", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      font-size: 14px;
      line-height: 1.5;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
    }
    [hidden] { display: none !important; }
    button, textarea, select { font: inherit; }
    button { -webkit-tap-highlight-color: transparent; }
    .spotpatch-trigger {
      position: fixed;
      right: 24px;
      bottom: 24px;
      z-index: ${String(UI_Z_INDEX.controls)};
      display: inline-flex;
      align-items: center;
      gap: 10px;
      min-height: 44px;
      border: 1px solid rgb(255 255 255 / 12%);
      border-radius: 999px;
      padding: 10px 17px;
      color: #f8fafc;
      background: #171b23;
      box-shadow: 0 12px 34px rgb(0 0 0 / 25%), inset 0 1px rgb(255 255 255 / 5%);
      cursor: pointer;
      font-size: 14px;
      font-weight: 650;
      transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
    }
    .spotpatch-trigger::before {
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: var(--spotpatch-accent);
      box-shadow: 0 0 0 4px rgb(99 102 241 / 10%);
      content: "";
    }
    .spotpatch-trigger:hover { transform: translateY(-1px); border-color: rgb(129 140 248 / 52%); }
    .spotpatch-trigger[aria-pressed="true"] {
      border-color: rgb(124 58 237 / 55%);
      background: #24203b;
      box-shadow: 0 14px 42px rgb(76 29 149 / 24%), inset 0 1px rgb(255 255 255 / 10%);
    }
    .spotpatch-highlight {
      position: fixed;
      top: 0;
      left: 0;
      z-index: ${String(UI_Z_INDEX.highlight)};
      box-sizing: border-box;
      border: 2px solid var(--spotpatch-accent);
      border-radius: 6px;
      background: rgb(109 93 246 / 8%);
      box-shadow: inset 0 0 0 1px rgb(255 255 255 / 22%), 0 0 0 1px rgb(109 93 246 / 10%);
      pointer-events: none;
    }
    .spotpatch-highlight-label {
      position: absolute;
      top: -30px;
      left: -2px;
      max-width: min(380px, 80vw);
      overflow: hidden;
      border: 1px solid rgb(255 255 255 / 14%);
      border-radius: 8px 8px 8px 3px;
      padding: 6px 10px;
      color: #fff;
      background: #5546dc;
      box-shadow: 0 8px 20px rgb(49 46 129 / 22%);
      font: 650 12px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spotpatch-selection-highlights {
      position: fixed;
      inset: 0;
      z-index: ${String(UI_Z_INDEX.highlight)};
      pointer-events: none;
    }
    .spotpatch-selection-highlight {
      position: fixed;
      top: 0;
      left: 0;
      box-sizing: border-box;
      border: 2px solid var(--spotpatch-accent-cyan);
      border-radius: 6px;
      background: rgb(8 182 214 / 5%);
      box-shadow: inset 0 0 0 1px rgb(255 255 255 / 16%);
    }
    .spotpatch-selection-highlight[data-active="true"] {
      border-color: #7768f7;
      background: rgb(109 93 246 / 8%);
      box-shadow: inset 0 0 0 1px rgb(255 255 255 / 20%);
    }
    .spotpatch-selection-highlight > span {
      position: absolute;
      top: -24px;
      left: -2px;
      max-width: min(300px, 70vw);
      overflow: hidden;
      border-radius: 7px 7px 7px 2px;
      padding: 4px 8px;
      color: #ecfeff;
      background: rgb(14 67 82 / 96%);
      font: 650 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spotpatch-selection-highlight[data-active="true"] > span {
      background: #5546dc;
    }
    .spotpatch-dialog {
      --spotpatch-anchor-x: 50%;
      --spotpatch-anchor-y: 50%;
      position: fixed;
      top: 16px;
      left: 16px;
      z-index: ${String(UI_Z_INDEX.controls)};
      box-sizing: border-box;
      width: min(560px, calc(100vw - 32px));
      color: #edf0f7;
      outline: none;
      filter: drop-shadow(var(--spotpatch-shadow-panel));
    }
    .spotpatch-anchor {
      position: absolute;
      z-index: 0;
      width: 14px;
      height: 14px;
      border: 1px solid rgb(255 255 255 / 12%);
      background: var(--spotpatch-bg);
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
      max-height: min(720px, calc(100vh - 32px));
      overflow: hidden;
      flex-direction: column;
      border: 1px solid var(--spotpatch-border);
      border-radius: var(--spotpatch-radius-panel);
      background: var(--spotpatch-bg);
      box-shadow: inset 0 1px rgb(255 255 255 / 7%), inset 0 0 0 1px rgb(2 6 23 / 40%);
    }
    .spotpatch-header {
      position: relative;
      padding: 20px 22px 18px;
      border-bottom: 1px solid rgb(255 255 255 / 8%);
    }
    .spotpatch-brand-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 18px;
    }
    .spotpatch-brand {
      display: inline-flex;
      align-items: center;
      gap: 11px;
      min-width: 0;
      color: #f8fafc;
    }
    .spotpatch-brand-mark {
      width: 34px;
      height: 34px;
      flex: none;
      filter: drop-shadow(0 6px 12px rgb(76 29 149 / 22%));
    }
    .spotpatch-brand-copy { display: grid; min-width: 0; gap: 1px; }
    .spotpatch-brand-name {
      color: #fff;
      font-size: 15px;
      font-weight: 720;
      letter-spacing: -.01em;
    }
    .spotpatch-brand-context {
      color: #8e98aa;
      font-size: 11px;
      font-weight: 560;
      letter-spacing: .02em;
    }
    .spotpatch-header-controls {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      flex: none;
    }
    .spotpatch-locale {
      min-width: 38px;
      height: 30px;
      border: 1px solid rgb(255 255 255 / 11%);
      border-radius: 9px;
      padding: 0 9px;
      color: #c5cad5;
      background: rgb(255 255 255 / 4%);
      cursor: pointer;
      font-size: 12px;
      font-weight: 650;
    }
    .spotpatch-close {
      display: inline-grid;
      width: 30px;
      height: 30px;
      padding: 0;
      place-items: center;
      border: 1px solid rgb(255 255 255 / 11%);
      border-radius: 9px;
      color: #9da5b4;
      background: rgb(255 255 255 / 4%);
      cursor: pointer;
      font-size: 17px;
      line-height: 1;
      transition: border-color 150ms ease, color 150ms ease, background 150ms ease;
    }
    .spotpatch-close:hover,
    .spotpatch-locale:hover { border-color: rgb(129 112 247 / 45%); color: #fff; background: rgb(109 93 246 / 10%); }
    .spotpatch-title {
      margin: 0;
      color: #fff;
      font-size: 24px;
      font-weight: 730;
      letter-spacing: -.025em;
    }
    .spotpatch-subtitle {
      max-width: 470px;
      margin: 6px 0 0;
      color: #9ca5b5;
      font-size: 15px;
      line-height: 1.55;
    }
    .spotpatch-target-row {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      margin-top: 16px;
    }
    .spotpatch-target-label {
      min-width: 0;
      overflow: hidden;
      border: 1px solid rgb(129 112 247 / 24%);
      border-radius: 999px;
      padding: 6px 10px;
      color: #cdd2ff;
      background: rgb(109 93 246 / 10%);
      font: 600 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spotpatch-context-state {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex: none;
      color: #a5adba;
      font-size: 12px;
      white-space: nowrap;
    }
    .spotpatch-context-state::before {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: #f59e0b;
      content: "";
    }
    .spotpatch-context-state[data-state="ready"] { color: #9fe3c4; }
    .spotpatch-context-state[data-state="ready"]::before { background: #34d399; }
    .spotpatch-context-state[data-state="warning"] { color: #fecaca; }
    .spotpatch-context-state[data-state="warning"]::before { background: #fb7185; }
    .spotpatch-body {
      min-height: 0;
      overflow: auto;
      padding: 20px 22px 22px;
      scrollbar-color: rgb(100 116 139 / 50%) transparent;
      scrollbar-width: thin;
    }
    .spotpatch-targets {
      margin: 0;
    }
    .spotpatch-targets-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 7px;
      color: #eef0f5;
      font-size: 14px;
      font-weight: 680;
    }
    .spotpatch-targets-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }
    .spotpatch-target-complete { color: var(--spotpatch-text-secondary); font-size: 12px; font-weight: 560; }
    .spotpatch-target-budget {
      color: var(--spotpatch-text-muted);
      font: 550 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .spotpatch-target-budget[data-state="over"] { color: #fda4af; }
    .spotpatch-target-count {
      border-radius: 999px;
      padding: 3px 8px;
      color: #b8bffd;
      background: rgb(109 93 246 / 11%);
      font: 650 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .spotpatch-target-list {
      display: grid;
      gap: 12px;
      max-height: min(390px, 48vh);
      overflow: auto;
      padding-right: 2px;
    }
    .spotpatch-target-item {
      overflow: hidden;
      border: 1px solid var(--spotpatch-border-subtle);
      border-radius: var(--spotpatch-radius-card);
      background: rgb(255 255 255 / 2.7%);
      transition: border-color 150ms ease, background 150ms ease;
    }
    .spotpatch-target-item[data-active="true"] {
      border-color: rgb(125 106 248 / 42%);
      background: rgb(109 93 246 / 6%);
      box-shadow: inset 3px 0 var(--spotpatch-accent-strong);
    }
    .spotpatch-target-summary {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 34px;
      align-items: stretch;
      gap: 4px;
      padding: 5px;
    }
    .spotpatch-target-select {
      display: grid;
      grid-template-columns: 34px minmax(0, 1fr) auto;
      align-items: center;
      gap: 11px;
      min-width: 0;
      border: 0;
      border-radius: 11px;
      padding: 10px 11px;
      color: inherit;
      background: transparent;
      cursor: pointer;
      text-align: left;
    }
    .spotpatch-target-select:hover { background: rgb(255 255 255 / 3.5%); }
    .spotpatch-target-index {
      display: inline-grid;
      width: 30px;
      height: 30px;
      place-items: center;
      border: 1px solid rgb(68 202 224 / 25%);
      border-radius: 9px;
      color: #9ce7f0;
      background: rgb(8 145 178 / 10%);
      font: 700 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .spotpatch-target-copy { min-width: 0; }
    .spotpatch-target-name,
    .spotpatch-target-source {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spotpatch-target-name { color: #f2f4f8; font-size: 16px; font-weight: 680; }
    .spotpatch-target-source { margin-top: 5px; color: var(--spotpatch-text-muted); font: 500 13px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .spotpatch-target-state {
      border-radius: 999px;
      padding: 4px 8px;
      color: #a7f3d0;
      background: rgb(16 185 129 / 9%);
      font-size: 11px;
      font-weight: 650;
      white-space: nowrap;
    }
    .spotpatch-target-state[data-complete="false"] { color: #f5c97a; background: rgb(245 158 11 / 9%); }
    .spotpatch-target-remove {
      display: inline-grid;
      width: 34px;
      height: 100%;
      min-height: 40px;
      padding: 0;
      place-items: center;
      border: 1px solid transparent;
      border-radius: 10px;
      color: #7f899a;
      background: transparent;
      cursor: pointer;
    }
    .spotpatch-target-remove:hover:not(:disabled) { border-color: rgb(251 113 133 / 24%); color: #fda4af; background: rgb(127 29 29 / 12%); }
    .spotpatch-target-editor {
      border-top: 1px solid rgb(255 255 255 / 7%);
      padding: 18px;
    }
    .spotpatch-target-editor-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 9px;
    }
    .spotpatch-target-editor-label { color: #dfe3ea; font-size: 15px; font-weight: 650; }
    .spotpatch-target-editor-count { color: var(--spotpatch-text-muted); font: 500 11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .spotpatch-target-editor textarea {
      box-sizing: border-box;
      width: 100%;
      min-height: 126px;
      resize: vertical;
      border: 1px solid var(--spotpatch-border);
      border-radius: 12px;
      padding: 14px 15px;
      color: #f8fafc;
      caret-color: #8b7cf7;
      background: var(--spotpatch-bg-input);
      font-size: 15px;
      line-height: 1.65;
      outline: none;
      transition: border-color 150ms ease, box-shadow 150ms ease, background 150ms ease;
    }
    .spotpatch-target-editor textarea::placeholder { color: #687284; }
    .spotpatch-target-editor textarea:hover { border-color: rgb(139 124 247 / 34%); }
    .spotpatch-target-editor textarea:focus {
      border-color: rgb(139 124 247 / 68%);
      background: rgb(3 7 18 / 65%);
      box-shadow: 0 0 0 3px rgb(109 93 246 / 10%);
    }
    .spotpatch-diagnostics {
      margin-top: 14px;
      overflow: hidden;
      border: 1px solid rgb(255 255 255 / 8%);
      border-radius: 13px;
      background: rgb(255 255 255 / 2.5%);
    }
    .spotpatch-diagnostics > summary {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 11px 13px;
      color: #bfc5d0;
      cursor: pointer;
      font-size: 12px;
      font-weight: 650;
      list-style: none;
      user-select: none;
    }
    .spotpatch-diagnostics > summary::-webkit-details-marker { display: none; }
    .spotpatch-diagnostics > summary::before {
      color: #778193;
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
      font: 500 10.5px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spotpatch-summary {
      max-height: 170px;
      margin: 0;
      overflow: auto;
      border-top: 1px solid rgb(255 255 255 / 7%);
      padding: 12px 13px 13px;
      color: #9ca5b5;
      font: 11.5px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
      user-select: text;
    }
    .spotpatch-prompt {
      max-height: min(500px, 60vh);
      margin: 0;
      overflow: auto;
      border: 1px solid rgb(255 255 255 / 9%);
      border-radius: 14px;
      padding: 13px;
      color: #d8ddeb;
      background: rgb(3 7 18 / 55%);
      font: 12px/1.65 ui-monospace, SFMono-Regular, Menlo, monospace;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
      user-select: text;
    }
    .spotpatch-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 9px;
      padding: 14px 22px 18px;
      border-top: 1px solid rgb(255 255 255 / 8%);
      background: rgb(8 12 22 / 82%);
    }
    .spotpatch-actions button {
      display: inline-flex;
      min-height: 40px;
      align-items: center;
      justify-content: center;
      border: 1px solid rgb(255 255 255 / 10%);
      border-radius: 11px;
      padding: 9px 13px;
      color: #d8ddeb;
      background: rgb(255 255 255 / 4%);
      cursor: pointer;
      font-size: 13px;
      font-weight: 650;
      transition: border-color 150ms ease, box-shadow 150ms ease, color 150ms ease, transform 150ms ease;
    }
    .spotpatch-actions button:hover:not(:disabled) {
      border-color: rgb(139 124 247 / 45%);
      color: #fff;
      transform: translateY(-1px);
    }
    .spotpatch-actions .spotpatch-primary {
      min-width: 154px;
      flex: 1;
      border-color: rgb(139 124 247 / 58%);
      color: #fff;
      background: var(--spotpatch-accent-strong);
      box-shadow: 0 9px 24px rgb(55 48 163 / 20%), inset 0 1px rgb(255 255 255 / 14%);
    }
    .spotpatch-actions .spotpatch-primary::after { margin-left: 8px; content: "↗"; font-size: 12px; }
    .spotpatch-actions button:disabled { cursor: not-allowed; opacity: .4; transform: none; }
    .spotpatch-actions button:focus-visible,
    .spotpatch-target-remove:focus-visible,
    .spotpatch-close:focus-visible,
    .spotpatch-trigger:focus-visible,
    .spotpatch-target-select:focus-visible,
    .spotpatch-target-editor textarea:focus-visible,
    .spotpatch-locale:focus-visible,
    .spotpatch-prompt:focus-visible,
    .spotpatch-diagnostics > summary:focus-visible {
      outline: 2px solid #8b7cf7;
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
    @media (max-width: 520px) {
      .spotpatch-dialog { top: 8px; left: 8px; width: calc(100vw - 16px); }
      .spotpatch-shell { max-height: calc(100vh - 16px); border-radius: 18px; }
      .spotpatch-header, .spotpatch-body { padding-left: 16px; padding-right: 16px; }
      .spotpatch-actions { padding-left: 16px; padding-right: 16px; }
      .spotpatch-target-select { grid-template-columns: 32px minmax(0, 1fr); }
      .spotpatch-target-state { display: none; }
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
  localePreference: SpotPatchLocalePreference = "auto",
): RuntimeView {
  const localizer: UiLocalizer = createUiLocalizer(document, localePreference);
  let messages = localizer.messages();
  const host = document.createElement("spotpatch-root");
  host.setAttribute(UI_MARKER_ATTRIBUTE, "");
  const shadowRoot = host.attachShadow({ mode: "open" });
  const triggerButton = createButton(
    document,
    messages.trigger.select,
    "spotpatch-trigger",
  );
  triggerButton.title = messages.trigger.title(shortcut);
  triggerButton.setAttribute("aria-pressed", "false");

  const highlight = createMarkedElement(document, "div");
  highlight.className = "spotpatch-highlight";
  highlight.hidden = true;
  const highlightLabel = createMarkedElement(document, "span");
  highlightLabel.className = "spotpatch-highlight-label";
  highlight.append(highlightLabel);
  const selectionHighlights = createMarkedElement(document, "div");
  selectionHighlights.className = "spotpatch-selection-highlights";
  selectionHighlights.setAttribute("aria-hidden", "true");

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
  const brand = createMarkedElement(document, "div");
  brand.className = "spotpatch-brand";
  const brandCopy = createMarkedElement(document, "span");
  brandCopy.className = "spotpatch-brand-copy";
  const brandName = createMarkedElement(document, "span");
  brandName.className = "spotpatch-brand-name";
  const brandContext = createMarkedElement(document, "span");
  brandContext.className = "spotpatch-brand-context";
  brandCopy.append(brandName, brandContext);
  brand.append(createBrandMark(document), brandCopy);
  const headerControls = createMarkedElement(document, "span");
  headerControls.className = "spotpatch-header-controls";
  const localeButton = createButton(document, "", "spotpatch-locale");
  const closeButton = createButton(document, "×", "spotpatch-close");
  headerControls.append(localeButton, closeButton);
  brandRow.append(brand, headerControls);
  const title = createMarkedElement(document, "h2");
  title.id = "spotpatch-selection-title";
  title.className = "spotpatch-title";
  const subtitle = createMarkedElement(document, "p");
  subtitle.className = "spotpatch-subtitle";
  const targetRow = createMarkedElement(document, "div");
  targetRow.className = "spotpatch-target-row";
  const targetLabel = createMarkedElement(document, "span");
  targetLabel.className = "spotpatch-target-label";
  const contextState = createMarkedElement(document, "span");
  contextState.className = "spotpatch-context-state";
  contextState.dataset.state = "loading";
  contextState.textContent = messages.context.collecting;
  targetRow.append(targetLabel, contextState);
  header.append(brandRow, title, subtitle, targetRow);

  const body = createMarkedElement(document, "div");
  body.className = "spotpatch-body";
  const selectionPanel = createMarkedElement(document, "div");
  selectionPanel.className = "spotpatch-selection-panel";
  const targetsPanel = createMarkedElement(document, "section");
  targetsPanel.className = "spotpatch-targets";
  const targetsHeading = createMarkedElement(document, "div");
  targetsHeading.className = "spotpatch-targets-heading";
  const targetsTitle = createMarkedElement(document, "span");
  const targetsMeta = createMarkedElement(document, "span");
  targetsMeta.className = "spotpatch-targets-meta";
  const targetComplete = createMarkedElement(document, "span");
  targetComplete.className = "spotpatch-target-complete";
  const targetBudget = createMarkedElement(document, "span");
  targetBudget.className = "spotpatch-target-budget";
  targetBudget.setAttribute("aria-live", "polite");
  const targetCount = createMarkedElement(document, "span");
  targetCount.className = "spotpatch-target-count";
  targetsMeta.append(targetComplete, targetBudget);
  targetsHeading.append(targetsTitle, targetCount);
  const targetList = createMarkedElement(document, "div");
  targetList.className = "spotpatch-target-list";
  targetsPanel.append(targetsHeading, targetsMeta, targetList);
  const diagnostics = createMarkedElement(document, "details");
  diagnostics.className = "spotpatch-diagnostics";
  const diagnosticsLabel = createMarkedElement(document, "summary");
  const diagnosticsTitle = createMarkedElement(document, "span");
  const sourcePeek = createMarkedElement(document, "span");
  sourcePeek.className = "spotpatch-source-peek";
  sourcePeek.textContent = messages.diagnostics.resolving;
  diagnosticsLabel.append(diagnosticsTitle, sourcePeek);
  const summary = createMarkedElement(document, "pre");
  summary.className = "spotpatch-summary";
  diagnostics.append(diagnosticsLabel, summary);
  const agentPanel = createAgentPanel(document, ai, localizer);
  selectionPanel.append(targetsPanel, diagnostics, agentPanel.root);

  const previewPanel = createMarkedElement(document, "div");
  previewPanel.className = "spotpatch-preview-panel";
  previewPanel.hidden = true;
  const promptOutput = createMarkedElement(document, "pre");
  promptOutput.className = "spotpatch-prompt";
  promptOutput.tabIndex = 0;
  promptOutput.setAttribute("aria-label", messages.diagnostics.promptAriaLabel);
  previewPanel.append(promptOutput);
  body.append(selectionPanel, previewPanel);

  const actions = createMarkedElement(document, "footer");
  actions.className = "spotpatch-actions";
  const addTargetButton = createButton(document, messages.actions.addElement);
  const reselectButton = createButton(document, messages.actions.reselect);
  const openEditorButton = createButton(document, messages.actions.openEditor);
  const previewButton = createButton(
    document,
    messages.actions.preview,
    "spotpatch-primary",
  );
  const copyButton = createButton(document, messages.actions.copy, "spotpatch-primary");
  const backButton = createButton(document, messages.actions.back);
  actions.append(
    agentPanel.runButton,
    previewButton,
    agentPanel.testButton,
    agentPanel.cancelButton,
    agentPanel.applyButton,
    agentPanel.revertButton,
    agentPanel.resetButton,
    addTargetButton,
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
    selectionHighlights,
    highlight,
    dialog,
    triggerButton,
    liveRegion,
  );
  document.documentElement.append(host);

  let currentRect: ElementRect | undefined;
  let activeSelectionRect: ElementRect | undefined;
  let currentStatus: RuntimeStatus = "idle";
  let currentCanOpenEditor = false;
  let currentCanPreview = false;
  let currentSummaryText = "";
  let editingEnabled = true;
  let currentTargets: readonly SelectionTargetView[] = [];
  let currentMaximum = 0;

  function statusText(target: SelectionTargetView): string {
    if (target.status === "ready") {
      return messages.targets.statusReady;
    }

    return target.status === "warning"
      ? messages.targets.statusPartial
      : messages.targets.statusCollecting;
  }

  function instructionInput(targetId?: string): HTMLTextAreaElement | undefined {
    const inputs = targetList.querySelectorAll<HTMLTextAreaElement>(
      "textarea[data-target-instruction-id]",
    );
    return Array.from(inputs).find(
      (input) =>
        targetId === undefined || input.dataset.targetInstructionId === targetId,
    );
  }

  function renderTargets(
    targets: readonly SelectionTargetView[],
    maximum: number,
  ): void {
    const focusedInstruction = shadowRoot.activeElement?.closest<HTMLTextAreaElement>(
      "textarea[data-target-instruction-id]",
    );
    const focusedTargetId = focusedInstruction?.dataset.targetInstructionId;
    const selectionStart = focusedInstruction?.selectionStart;
    const selectionEnd = focusedInstruction?.selectionEnd;
    currentTargets = targets.map((target) => Object.freeze({ ...target }));
    currentMaximum = maximum;
    targetList.replaceChildren();
    const completeCount = targets.filter(
      (target) => target.instruction.trim().length > 0,
    ).length;
    const instructionCharacters = targets.reduce(
      (total, target) => total + target.instruction.trim().length,
      0,
    );
    targetCount.textContent = messages.targets.count(targets.length, maximum);
    targetComplete.textContent = messages.targets.complete(
      completeCount,
      targets.length,
    );
    const instructionLimitExceeded =
      instructionCharacters > MAX_ANNOTATION_INSTRUCTION_CHARACTERS;
    targetBudget.dataset.state = instructionLimitExceeded ? "over" : "ready";
    targetBudget.textContent = instructionLimitExceeded
      ? messages.targets.instructionBudgetExceeded(
          instructionCharacters,
          MAX_ANNOTATION_INSTRUCTION_CHARACTERS,
        )
      : messages.targets.instructionBudget(
          instructionCharacters,
          MAX_ANNOTATION_INSTRUCTION_CHARACTERS,
        );
    addTargetButton.disabled = !editingEnabled || targets.length >= maximum;
    addTargetButton.title =
      targets.length >= maximum
        ? messages.targets.limitTitle(maximum)
        : messages.targets.addTitle;
    targetLabel.textContent =
      targets.length === 1
        ? (targets[0]?.label ?? messages.context.selectedElement)
        : messages.context.selectedCount(targets.length);

    for (const [index, target] of targets.entries()) {
      const item = createMarkedElement(document, "div");
      item.className = "spotpatch-target-item";
      item.dataset.active = String(target.active);
      item.dataset.status = target.status;
      item.dataset.targetId = target.id;
      const targetSummary = createMarkedElement(document, "div");
      targetSummary.className = "spotpatch-target-summary";
      const select = createButton(document, "", "spotpatch-target-select");
      select.dataset.activateTargetId = target.id;
      select.setAttribute("aria-label", messages.targets.activate(index + 1));
      select.setAttribute("aria-expanded", String(target.active));
      const number = createMarkedElement(document, "span");
      number.className = "spotpatch-target-index";
      number.textContent = String(index + 1);
      const copy = createMarkedElement(document, "span");
      copy.className = "spotpatch-target-copy";
      const name = createMarkedElement(document, "span");
      name.className = "spotpatch-target-name";
      name.textContent = target.label;
      const source = createMarkedElement(document, "span");
      source.className = "spotpatch-target-source";
      source.textContent = `${statusText(target)} · ${target.source}`;
      copy.append(name, source);
      const instructionComplete = target.instruction.trim().length > 0;
      const state = createMarkedElement(document, "span");
      state.className = "spotpatch-target-state";
      state.dataset.complete = String(instructionComplete);
      state.textContent = instructionComplete
        ? messages.targets.instructionReady
        : messages.targets.instructionMissing;
      select.append(number, copy, state);
      const remove = createButton(document, "×", "spotpatch-target-remove");
      remove.dataset.removeTargetId = target.id;
      remove.disabled = !editingEnabled;
      remove.setAttribute("aria-label", messages.targets.remove(index + 1));
      remove.title = messages.targets.removeTitle;
      targetSummary.append(select, remove);
      item.append(targetSummary);

      if (target.active) {
        const editor = createMarkedElement(document, "label");
        editor.className = "spotpatch-target-editor";
        const editorHead = createMarkedElement(document, "span");
        editorHead.className = "spotpatch-target-editor-head";
        const editorLabel = createMarkedElement(document, "span");
        editorLabel.className = "spotpatch-target-editor-label";
        editorLabel.textContent = messages.targets.instructionLabel(target.label);
        const characterCount = createMarkedElement(document, "span");
        characterCount.className = "spotpatch-target-editor-count";
        characterCount.textContent = messages.targets.instructionCount(
          target.instruction.length,
          MAX_TARGET_INSTRUCTION_CHARACTERS,
        );
        editorHead.append(editorLabel, characterCount);
        const input = createMarkedElement(document, "textarea");
        input.rows = 4;
        input.maxLength = MAX_TARGET_INSTRUCTION_CHARACTERS;
        input.value = target.instruction;
        input.placeholder = messages.targets.instructionPlaceholder;
        input.disabled = !editingEnabled;
        input.dataset.targetInstructionId = target.id;
        input.setAttribute(
          "aria-label",
          messages.targets.instructionLabel(target.label),
        );
        editor.append(editorHead, input);
        item.append(editor);
      }

      targetList.append(item);
    }

    if (focusedTargetId !== undefined) {
      const replacement = instructionInput(focusedTargetId);
      replacement?.focus({ preventScroll: true });

      if (selectionStart !== undefined && selectionEnd !== undefined) {
        replacement?.setSelectionRange(selectionStart, selectionEnd);
      }
    }
  }

  function updateTargetInstruction(targetId: string, instruction: string): void {
    currentTargets = currentTargets.map((target) =>
      target.id === targetId ? Object.freeze({ ...target, instruction }) : target,
    );
    const item = Array.from(
      targetList.querySelectorAll<HTMLElement>(".spotpatch-target-item"),
    ).find((candidate) => candidate.dataset.targetId === targetId);

    if (item === undefined) {
      return;
    }

    const complete = instruction.trim().length > 0;
    const state = item.querySelector<HTMLElement>(".spotpatch-target-state");
    const count = item.querySelector<HTMLElement>(".spotpatch-target-editor-count");

    if (state !== null) {
      state.dataset.complete = String(complete);
      state.textContent = complete
        ? messages.targets.instructionReady
        : messages.targets.instructionMissing;
    }

    if (count !== null) {
      count.textContent = messages.targets.instructionCount(
        instruction.length,
        MAX_TARGET_INSTRUCTION_CHARACTERS,
      );
    }

    targetComplete.textContent = messages.targets.complete(
      currentTargets.filter((target) => target.instruction.trim().length > 0).length,
      currentTargets.length,
    );
    const instructionCharacters = currentTargets.reduce(
      (total, target) => total + target.instruction.trim().length,
      0,
    );
    const instructionLimitExceeded =
      instructionCharacters > MAX_ANNOTATION_INSTRUCTION_CHARACTERS;
    targetBudget.dataset.state = instructionLimitExceeded ? "over" : "ready";
    targetBudget.textContent = instructionLimitExceeded
      ? messages.targets.instructionBudgetExceeded(
          instructionCharacters,
          MAX_ANNOTATION_INSTRUCTION_CHARACTERS,
        )
      : messages.targets.instructionBudget(
          instructionCharacters,
          MAX_ANNOTATION_INSTRUCTION_CHARACTERS,
        );
  }

  function showSelectionHighlights(targets: readonly SelectionHighlightView[]): void {
    selectionHighlights.replaceChildren();
    activeSelectionRect = targets.find((target) => target.active)?.rect;
    currentRect = activeSelectionRect;

    for (const [index, target] of targets.entries()) {
      const box = createMarkedElement(document, "div");
      box.className = "spotpatch-selection-highlight";
      box.dataset.targetId = target.id;
      box.dataset.active = String(target.active);
      box.style.transform = `translate(${String(target.rect.x)}px, ${String(target.rect.y)}px)`;
      box.style.width = `${String(target.rect.width)}px`;
      box.style.height = `${String(target.rect.height)}px`;
      const label = createMarkedElement(document, "span");
      label.textContent = `${String(index + 1)} · ${target.label}`;
      box.append(label);
      selectionHighlights.append(box);
    }

    placeDialog();
  }

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
    const summaryMessages = messages.summary;
    const source = summaryLine(summaryText, summaryMessages.source);
    sourcePeek.textContent = source ?? messages.diagnostics.noExactSource;
    const browserReady = `${summaryMessages.browserContext}: ${summaryMessages.collectionStatuses.ready}`;
    const browserLoading = `${summaryMessages.browserContext}: ${summaryMessages.collectionStatuses.loading}`;
    const browserFailed = `${summaryMessages.browserContext}: ${summaryMessages.collectionStatuses.failed}`;
    const apiLoading = `${summaryMessages.api}: ${summaryMessages.apiStatuses.loading}`;
    const apiFailed = `${summaryMessages.api}: ${summaryMessages.apiStatuses.failed}`;

    if (
      summaryText.includes(browserReady) &&
      !summaryText.includes(browserLoading) &&
      !summaryText.includes(apiLoading) &&
      !summaryText.includes(browserFailed) &&
      !summaryText.includes(apiFailed)
    ) {
      contextState.dataset.state = "ready";
      contextState.textContent = messages.context.ready;
    } else if (summaryText.includes(browserFailed) || summaryText.includes(apiFailed)) {
      contextState.dataset.state = "warning";
      contextState.textContent = messages.context.partial;
    } else {
      contextState.dataset.state = "loading";
      contextState.textContent = messages.context.collecting;
    }
  }

  function updateSelection(
    summaryText: string,
    canOpenEditor: boolean,
    canPreview: boolean,
  ): void {
    currentCanOpenEditor = canOpenEditor;
    currentCanPreview = canPreview;
    currentSummaryText = summaryText;
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
    triggerButton.hidden = selected || previewing;
    selectionPanel.hidden = !selected;
    previewPanel.hidden = !previewing;
    reselectButton.hidden = !selected;
    addTargetButton.hidden = !selected;
    openEditorButton.hidden = !selected;
    previewButton.hidden = !selected;
    agentPanel.setSelectionVisible(selected);
    copyButton.hidden = !previewing;
    backButton.hidden = !previewing;
    title.textContent = previewing
      ? messages.dialog.previewTitle
      : messages.dialog.editTitle;
    subtitle.textContent = previewing
      ? messages.dialog.previewSubtitle
      : messages.dialog.editSubtitle;
    placeDialog();
  }

  function applyMessages(): void {
    messages = localizer.messages();
    brandName.textContent = messages.brand.name;
    brandContext.textContent = messages.brand.context;
    localeButton.textContent = messages.alternateLocaleName;
    localeButton.title = messages.switchLocale;
    localeButton.setAttribute("aria-label", messages.switchLocale);
    closeButton.setAttribute("aria-label", messages.dialog.close);
    closeButton.title = messages.dialog.close;
    targetsPanel.setAttribute("aria-label", messages.targets.ariaLabel);
    targetsTitle.textContent = messages.targets.title;
    diagnosticsTitle.textContent = messages.diagnostics.title;
    promptOutput.setAttribute("aria-label", messages.diagnostics.promptAriaLabel);
    addTargetButton.textContent = messages.actions.addElement;
    reselectButton.textContent = messages.actions.reselect;
    openEditorButton.textContent = messages.actions.openEditor;
    previewButton.textContent = messages.actions.preview;
    copyButton.textContent = messages.actions.copy;
    backButton.textContent = messages.actions.back;
    triggerButton.title = messages.trigger.title(shortcut);
    triggerButton.textContent =
      currentStatus === "inspecting" ? messages.trigger.stop : messages.trigger.select;
    renderPanelStatus(currentStatus);

    if (currentTargets.length > 0) {
      renderTargets(currentTargets, currentMaximum);
    } else {
      targetCount.textContent = messages.targets.count(0, currentMaximum);
      targetComplete.textContent = messages.targets.complete(0, 0);
      targetBudget.dataset.state = "ready";
      targetBudget.textContent = messages.targets.instructionBudget(
        0,
        MAX_ANNOTATION_INSTRUCTION_CHARACTERS,
      );
      targetLabel.textContent = messages.context.selectedElement;
    }

    if (currentSummaryText.length > 0) {
      updateContextOverview(currentSummaryText);
    } else {
      sourcePeek.textContent = messages.diagnostics.resolving;
      contextState.textContent = messages.context.collecting;
    }
  }

  diagnostics.addEventListener("toggle", placeDialog);
  localeButton.addEventListener("click", localizer.toggle);
  const unsubscribeLocale = localizer.subscribe(applyMessages);
  applyMessages();

  return Object.freeze({
    host,
    triggerButton,
    addTargetButton,
    targetList,
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
      triggerButton.textContent = inspecting
        ? messages.trigger.stop
        : messages.trigger.select;
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
      currentRect = activeSelectionRect;
      highlight.hidden = true;
      highlightLabel.textContent = "";
      placeDialog();
    },

    showSelectionHighlights,

    hideSelectionHighlights(): void {
      selectionHighlights.replaceChildren();
      activeSelectionRect = undefined;
      currentRect = undefined;
    },

    showSelection(
      summaryText: string,
      canOpenEditor: boolean,
      canPreview: boolean,
    ): void {
      updateSelection(summaryText, canOpenEditor, canPreview);
      triggerButton.hidden = true;
      dialog.hidden = false;
      placeDialog();
    },

    updateSelection,

    renderTargets,

    updateTargetInstruction,

    setPreviewEnabled(enabled: boolean): void {
      currentCanPreview = enabled;
      previewButton.disabled = !enabled;
      agentPanel.setContextReady(enabled);
    },

    hideSelection(): void {
      dialog.hidden = true;
      triggerButton.hidden = false;
      targetList.replaceChildren();
      currentTargets = [];
      currentMaximum = 0;
      currentSummaryText = "";
      targetCount.textContent = messages.targets.count(0, 0);
      targetComplete.textContent = messages.targets.complete(0, 0);
      targetLabel.textContent = messages.context.selectedElement;
      summary.textContent = "";
      promptOutput.textContent = "";
      sourcePeek.textContent = messages.diagnostics.resolving;
      contextState.dataset.state = "loading";
      contextState.textContent = messages.context.collecting;
      openEditorButton.disabled = true;
      previewButton.disabled = true;
      currentCanOpenEditor = false;
      currentCanPreview = false;
      agentPanel.setContextReady(false);
      agentPanel.setSelectionVisible(false);
      agentPanel.setEditingEnabled(true);
      agentPanel.resetJob();
    },

    hideSelectionTemporarily(): void {
      dialog.hidden = true;
      triggerButton.hidden = false;
    },

    showPreview(prompt: string): void {
      promptOutput.textContent = prompt;
      placeDialog();
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
      editingEnabled = enabled;
      addTargetButton.disabled = !enabled;
      reselectButton.disabled = !enabled;
      targetList
        .querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>(
          ".spotpatch-target-remove, .spotpatch-target-select, textarea[data-target-instruction-id]",
        )
        .forEach((control) => {
          control.disabled = !enabled;
        });
      openEditorButton.disabled = !enabled || !currentCanOpenEditor;
      previewButton.disabled = !enabled || !currentCanPreview;
      agentPanel.setEditingEnabled(enabled);
      placeDialog();
    },

    renderAgentCapability(
      state: "idle" | "probing" | "ready" | "error",
      message: string,
      capabilitySnapshot?: AgentCapabilitySnapshot,
      errorCode?: ErrorCode,
    ): void {
      agentPanel.renderCapability(state, message, capabilitySnapshot, errorCode);
      const agentReady =
        state === "ready" && capabilitySnapshot?.state === "agent-ready";
      previewButton.classList.toggle("spotpatch-primary", !agentReady);
      placeDialog();
    },

    renderAgentJob(
      snapshot: AgentJobSnapshot,
      result: AgentJobResult | undefined,
      activities: readonly AgentActivityItem[],
      errorCode?: ErrorCode,
    ): void {
      agentPanel.renderJob(snapshot, result, activities, errorCode);
      placeDialog();
    },

    resetAgentJob(): void {
      agentPanel.resetJob();
      placeDialog();
    },

    focusTargetInstruction(targetId?: string): void {
      instructionInput(targetId)?.focus({ preventScroll: true });
    },

    focusPrompt(): void {
      promptOutput.focus({ preventScroll: true });
    },

    announce(message: string): void {
      liveRegion.textContent = "";
      liveRegion.textContent = message;
    },

    locale: localizer.locale,

    messages: localizer.messages,

    subscribeLocale: localizer.subscribe,

    dispose(): void {
      diagnostics.removeEventListener("toggle", placeDialog);
      localeButton.removeEventListener("click", localizer.toggle);
      unsubscribeLocale();
      agentPanel.dispose();
      host.remove();
    },
  });
}
