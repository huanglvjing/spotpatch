import type {
  AgentCapabilitySnapshot,
  AgentJobResult,
  AgentJobSnapshot,
  AgentWorkspaceHealthSnapshot,
  ErrorCode,
  RuntimeAiConfig,
  SpotPatchLocale,
  SpotPatchLocalePreference,
} from "@spotpatch/shared";
import {
  MAX_ANNOTATION_INSTRUCTION_CHARACTERS,
  MAX_TARGET_INSTRUCTION_CHARACTERS,
  SPOTPATCH_REPOSITORY_URL,
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
import {
  getDataFlowExtension,
  type DataFlowPanel,
  type DataFlowViewState,
} from "./data-flow-panel-contract.js";
import { createButton, createMarkedElement } from "./dom.js";
import {
  getExternalHandoffExtension,
  type ExternalHandoffPanel,
} from "./external-handoff-contract.js";
import {
  createUiLocalizer,
  type UiLocalizer,
  type UiMessages,
} from "./localization.js";
import { createFloatingSurfaceSession } from "../state/floating-surface-session.js";
import { createFloatingSurfaceController } from "./floating-surface-controller.js";
import {
  FLOATING_SURFACE_LAYOUT,
  UI_MARKER_ATTRIBUTE,
  UI_Z_INDEX,
} from "./ui-constants.js";

export interface SelectionTargetView {
  readonly active: boolean;
  readonly canOpenEditor: boolean;
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
  readonly agentModeSelect: HTMLSelectElement;
  readonly agentProviderSelect: HTMLSelectElement;
  readonly agentResetButton: HTMLButtonElement;
  readonly agentRevertButton: HTMLButtonElement;
  readonly agentRunButton: HTMLButtonElement;
  readonly agentTestButton: HTMLButtonElement;
  readonly agentWorkspaceConsentCheckbox: HTMLInputElement;
  readonly backButton: HTMLButtonElement;
  readonly closeButton: HTMLButtonElement;
  readonly copyButton: HTMLButtonElement;
  readonly dataFlowRefreshButton: HTMLButtonElement;
  readonly externalHandoffPanel?: ExternalHandoffPanel;
  readonly host: HTMLElement;
  readonly openEditorButton: HTMLButtonElement;
  readonly repositoryLink: HTMLAnchorElement;
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
  readonly agentWorkspaceConsentGranted: () => boolean;
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
  readonly renderAgentWorkspaceHealth: (
    state: "idle" | "checking" | "ready" | "consent-required" | "blocked",
    snapshot?: AgentWorkspaceHealthSnapshot,
    errorCode?: ErrorCode,
  ) => void;
  readonly renderStatus: (status: RuntimeStatus) => void;
  readonly renderEditorStatus: (
    state: "idle" | "opening" | "success" | "error",
  ) => void;
  readonly renderDataFlow: (state: DataFlowViewState) => void;
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

function resolveStyleNonce(document: Document): string | undefined {
  const nonces = new Set(
    [...document.querySelectorAll<HTMLScriptElement>("script[nonce]")]
      .map((script) => script.nonce?.trim() ?? "")
      .filter(Boolean),
  );

  if (nonces.size !== 1) {
    return undefined;
  }

  return nonces.values().next().value;
}

function createStyles(document: Document): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = `
    :host {
      all: initial;
      --spotpatch-bg: #0e0e12;
      --spotpatch-bg-raised: #17171c;
      --spotpatch-bg-active: #1c1c22;
      --spotpatch-bg-input: #0b0b0f;
      --spotpatch-border: #2a2a32;
      --spotpatch-border-subtle: #232329;
      --spotpatch-text: #f2f2f5;
      --spotpatch-text-secondary: #96969f;
      --spotpatch-text-muted: #686872;
      --spotpatch-accent: #8b7bff;
      --spotpatch-accent-strong: #6a5ce8;
      --spotpatch-accent-cyan: #52a8ff;
      --spotpatch-danger: #fb7185;
      --spotpatch-success: #34d399;
      --spotpatch-warning: #f59e0b;
      --spotpatch-text-on-accent: #0b0b12;
      --spotpatch-radius-panel: 16px;
      --spotpatch-radius-card: 10px;
      --spotpatch-shadow-panel: 0 30px 60px -20px rgb(0 0 0 / 70%);
      --spotpatch-motion-fast: 140ms;
      --spotpatch-motion-standard: 220ms;
      --spotpatch-motion-ease: cubic-bezier(.2, .8, .2, 1);
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
      right: ${String(FLOATING_SURFACE_LAYOUT.desktopInset)}px;
      bottom: ${String(FLOATING_SURFACE_LAYOUT.desktopInset)}px;
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
      touch-action: none;
      transition: border-color var(--spotpatch-motion-fast) var(--spotpatch-motion-ease), box-shadow var(--spotpatch-motion-fast) var(--spotpatch-motion-ease), transform var(--spotpatch-motion-fast) var(--spotpatch-motion-ease);
      user-select: none;
      will-change: transform;
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
    .spotpatch-trigger[aria-pressed="true"]::before { animation: spotpatch-island-pulse 1.5s ease-in-out infinite; }
    .spotpatch-trigger[data-dragging="true"] { cursor: grabbing; transform: scale(.98); transition: none; }
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
      position: fixed;
      right: ${String(FLOATING_SURFACE_LAYOUT.desktopInset)}px;
      bottom: ${String(FLOATING_SURFACE_LAYOUT.desktopInset)}px;
      z-index: ${String(UI_Z_INDEX.controls)};
      box-sizing: border-box;
      width: min(${String(FLOATING_SURFACE_LAYOUT.workbenchMaxWidth)}px, calc(100vw - ${String(FLOATING_SURFACE_LAYOUT.desktopInset * 2)}px));
      color: #edf0f7;
      outline: none;
      filter: drop-shadow(var(--spotpatch-shadow-panel));
      transform-origin: var(--spotpatch-surface-origin, right bottom);
      animation: spotpatch-workbench-enter var(--spotpatch-motion-standard) var(--spotpatch-motion-ease);
    }
    .spotpatch-dialog[data-dragging="true"] { transition: none; }
    .spotpatch-shell {
      position: relative;
      z-index: 1;
      display: flex;
      box-sizing: border-box;
      max-height: min(${String(FLOATING_SURFACE_LAYOUT.workbenchMaxHeight)}px, calc(100vh - ${String(FLOATING_SURFACE_LAYOUT.desktopInset * 2)}px));
      overflow: hidden;
      flex-direction: column;
      border: 1px solid var(--spotpatch-border);
      border-radius: var(--spotpatch-radius-panel);
      background: var(--spotpatch-bg);
      box-shadow: inset 0 1px rgb(255 255 255 / 5%), 0 0 60px -32px rgb(139 123 255 / 20%);
    }
    .spotpatch-shell::before {
      position: absolute;
      z-index: 2;
      top: 0;
      right: 20%;
      left: 20%;
      height: 1px;
      background: linear-gradient(90deg, transparent, var(--spotpatch-accent), var(--spotpatch-accent-cyan), transparent);
      content: "";
      opacity: .65;
      pointer-events: none;
    }
    .spotpatch-header {
      position: relative;
      padding: 0 18px 14px;
    }
    .spotpatch-header[data-spotpatch-drag-handle] { cursor: grab; touch-action: none; user-select: none; }
    .spotpatch-header[data-dragging="true"] { cursor: grabbing; }
    .spotpatch-header button,
    .spotpatch-header a { cursor: pointer; user-select: auto; }
    .spotpatch-brand-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin: 0 -18px 18px;
      padding: 14px 18px 13px;
      border-bottom: 1px solid var(--spotpatch-border-subtle);
    }
    .spotpatch-brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      color: #f8fafc;
    }
    .spotpatch-brand-mark {
      width: 30px;
      height: 30px;
      flex: none;
      filter: drop-shadow(0 6px 12px rgb(76 29 149 / 22%));
    }
    .spotpatch-brand-copy { display: grid; min-width: 0; gap: 1px; }
    .spotpatch-brand-name {
      color: #fff;
      font-size: 13.5px;
      font-weight: 680;
      letter-spacing: -.01em;
    }
    .spotpatch-brand-context {
      color: #8e98aa;
      font-size: 10.5px;
      font-weight: 560;
      letter-spacing: .02em;
    }
    .spotpatch-header-controls {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex: none;
    }
    .spotpatch-repository,
    .spotpatch-locale,
    .spotpatch-reset-position,
    .spotpatch-close {
      height: 27px;
      border: 1px solid rgb(255 255 255 / 11%);
      border-radius: 7px;
      background: transparent;
    }
    .spotpatch-repository {
      display: inline-flex;
      align-items: center;
      padding: 0 9px;
      color: var(--spotpatch-text-secondary);
      font-size: 11px;
      font-weight: 680;
      text-decoration: none;
    }
    .spotpatch-locale {
      min-width: 34px;
      padding: 0 8px;
      color: #c5cad5;
      cursor: pointer;
      font-size: 12px;
      font-weight: 650;
    }
    .spotpatch-reset-position {
      display: inline-grid;
      width: 27px;
      padding: 0;
      place-items: center;
      color: #c5cad5;
      cursor: pointer;
      font-size: 15px;
      line-height: 1;
    }
    .spotpatch-close {
      display: inline-grid;
      width: 27px;
      padding: 0;
      place-items: center;
      color: #9da5b4;
      cursor: pointer;
      font-size: 15px;
      line-height: 1;
      transition: border-color 150ms ease, color 150ms ease, background 150ms ease;
    }
    .spotpatch-close:hover,
    .spotpatch-locale:hover,
    .spotpatch-reset-position:hover,
    .spotpatch-repository:hover { border-color: rgb(129 112 247 / 45%); color: #fff; background: rgb(109 93 246 / 10%); }
    .spotpatch-title {
      margin: 0;
      color: #fff;
      font-size: 18px;
      font-weight: 680;
      letter-spacing: -.015em;
    }
    .spotpatch-subtitle {
      max-width: 390px;
      margin: 4px 0 0;
      color: var(--spotpatch-text-secondary);
      font-size: 12.5px;
      line-height: 1.5;
    }
    .spotpatch-target-row {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      margin-top: 14px;
    }
    .spotpatch-target-label {
      min-width: 0;
      overflow: hidden;
      border: 1px solid rgb(129 112 247 / 24%);
      border-radius: 999px;
      padding: 4px 10px;
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
      font-size: 11px;
      white-space: nowrap;
    }
    .spotpatch-context-state::before {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: #f59e0b;
      content: "";
    }
    .spotpatch-context-state[data-state="ready"],
    .spotpatch-editor-feedback[data-state="success"] { color: #9fe3c4; }
    .spotpatch-context-state[data-state="ready"]::before,
    .spotpatch-editor-feedback[data-state="success"]::before { background: #34d399; }
    .spotpatch-context-state[data-state="warning"],
    .spotpatch-editor-feedback[data-state="error"] { color: #fecaca; }
    .spotpatch-context-state[data-state="warning"]::before,
    .spotpatch-editor-feedback[data-state="error"]::before { background: #fb7185; }
    .spotpatch-body {
      min-height: 0;
      overflow: auto;
      padding: 0 18px 14px;
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
      gap: 10px;
      margin-bottom: 8px;
      color: var(--spotpatch-text-secondary);
      font-size: 11px;
      font-weight: 650;
      letter-spacing: .04em;
      text-transform: uppercase;
    }
    .spotpatch-targets-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      letter-spacing: 0;
      text-transform: none;
    }
    .spotpatch-target-complete { color: var(--spotpatch-text-muted); font-size: 11px; font-weight: 560; }
    .spotpatch-target-budget {
      color: var(--spotpatch-text-muted);
      font: 550 10.5px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .spotpatch-target-budget[data-state="ready"] { display: none; }
    .spotpatch-target-budget[data-state="over"] { color: #fda4af; }
    .spotpatch-target-count {
      margin-left: auto;
      border-radius: 999px;
      padding: 3px 8px;
      color: var(--spotpatch-text-muted);
      font: 600 10.5px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .spotpatch-target-progress {
      height: 3px;
      margin-bottom: 13px;
      overflow: hidden;
      border-radius: 999px;
      background: var(--spotpatch-border-subtle);
    }
    .spotpatch-target-progress-fill {
      width: 0;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--spotpatch-accent), var(--spotpatch-accent-cyan));
      transition: width 180ms ease;
    }
    .spotpatch-target-list {
      display: grid;
      gap: 8px;
      max-height: min(340px, 48vh);
      overflow: auto;
      padding-right: 2px;
    }
    .spotpatch-target-item {
      overflow: hidden;
      border: 1px solid var(--spotpatch-border-subtle);
      border-radius: var(--spotpatch-radius-card);
      background: var(--spotpatch-bg-raised);
      transition: border-color 150ms ease, background 150ms ease;
    }
    .spotpatch-target-item[data-active="true"] {
      border-color: rgb(139 123 255 / 34%);
      background: var(--spotpatch-bg-active);
      box-shadow: 0 0 0 3px rgb(139 123 255 / 10%);
    }
    .spotpatch-target-summary {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 28px 28px;
      align-items: stretch;
      gap: 2px;
      padding: 4px;
    }
    .spotpatch-target-select {
      display: grid;
      grid-template-columns: 24px minmax(0, 1fr) auto;
      align-items: center;
      gap: 9px;
      min-width: 0;
      border: 0;
      border-radius: 8px;
      padding: 8px;
      color: inherit;
      background: transparent;
      cursor: pointer;
      text-align: left;
    }
    .spotpatch-target-select:hover { background: rgb(255 255 255 / 3.5%); }
    .spotpatch-target-index {
      display: inline-grid;
      width: 22px;
      height: 22px;
      place-items: center;
      border: 1px solid rgb(68 202 224 / 25%);
      border-radius: 6px;
      color: var(--spotpatch-text-secondary);
      background: var(--spotpatch-bg);
      font: 650 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .spotpatch-target-copy { min-width: 0; }
    .spotpatch-target-name,
    .spotpatch-target-source {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spotpatch-target-name { color: #f2f2f5; font-size: 13px; font-weight: 650; }
    .spotpatch-target-source { margin-top: 1px; color: var(--spotpatch-text-muted); font: 500 10.5px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .spotpatch-target-state {
      border-radius: 999px;
      padding: 3px 8px;
      color: #a7f3d0;
      background: rgb(16 185 129 / 9%);
      font-size: 10.5px;
      font-weight: 650;
      white-space: nowrap;
    }
    .spotpatch-target-state[data-complete="false"] { color: #f5c97a; background: rgb(245 158 11 / 9%); }
    .spotpatch-target-open,
    .spotpatch-target-remove {
      display: inline-grid;
      width: 28px;
      height: 100%;
      min-height: 34px;
      padding: 0;
      place-items: center;
      border: 1px solid transparent;
      border-radius: 7px;
      color: #7f899a;
      background: transparent;
      cursor: pointer;
    }
    .spotpatch-target-open { color: #79d9e7; }
    .spotpatch-target-open:hover:not(:disabled) { border-color: rgb(68 202 224 / 30%); color: #c8f7ff; background: rgb(8 145 178 / 11%); }
    .spotpatch-target-remove:hover:not(:disabled) { border-color: rgb(251 113 133 / 24%); color: #fda4af; background: rgb(127 29 29 / 12%); }
    .spotpatch-target-editor {
      padding: 0 12px 12px;
    }
    .spotpatch-target-editor-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 6px;
    }
    .spotpatch-target-editor-label { color: var(--spotpatch-text-secondary); font-size: 11px; font-weight: 650; }
    .spotpatch-target-editor-count { color: var(--spotpatch-text-muted); font: 500 10.5px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .spotpatch-target-editor textarea {
      box-sizing: border-box;
      width: 100%;
      min-height: 74px;
      resize: vertical;
      border: 1px solid var(--spotpatch-border);
      border-radius: 7px;
      padding: 9px 10px;
      color: #f8fafc;
      caret-color: #8b7cf7;
      background: var(--spotpatch-bg-input);
      font-size: 12.5px;
      line-height: 1.55;
      outline: none;
      transition: border-color 150ms ease, box-shadow 150ms ease, background 150ms ease;
    }
    .spotpatch-target-editor textarea::placeholder { color: #687284; }
    .spotpatch-target-editor textarea:hover { border-color: rgb(139 124 247 / 34%); }
    .spotpatch-target-editor textarea:focus {
      border-color: rgb(139 124 247 / 68%);
      background: rgb(3 7 18 / 65%);
      box-shadow: 0 0 0 2px rgb(109 93 246 / 10%);
    }
    .spotpatch-diagnostics {
      margin-top: 10px;
      overflow: hidden;
      border: 1px solid rgb(255 255 255 / 8%);
      border-radius: 9px;
      background: rgb(255 255 255 / 2.5%);
    }
    .spotpatch-diagnostics > summary {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 9px 11px;
      color: #bfc5d0;
      cursor: pointer;
      font-size: 11px;
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
      padding: 10px 11px 11px;
      color: #9ca5b5;
      font: 10.5px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
      user-select: text;
    }
    .spotpatch-prompt {
      max-height: min(500px, 60vh);
      margin: 0;
      overflow: auto;
      border: 1px solid rgb(255 255 255 / 9%);
      border-radius: 9px;
      padding: 11px;
      color: #d8ddeb;
      background: rgb(3 7 18 / 55%);
      font: 11px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
      user-select: text;
    }
    .spotpatch-actions {
      display: grid;
      gap: 8px;
      padding: 10px 18px 14px;
      border-top: 1px solid rgb(255 255 255 / 8%);
      background: rgb(8 8 12 / 86%);
    }
    .spotpatch-editor-feedback {
      white-space: normal;
    }
    .spotpatch-secondary-actions,
    .spotpatch-primary-actions {
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .spotpatch-secondary-actions { min-height: 30px; }
    .spotpatch-actions button {
      display: inline-flex;
      min-height: 34px;
      align-items: center;
      justify-content: center;
      border: 1px solid rgb(255 255 255 / 10%);
      border-radius: 9px;
      padding: 7px 11px;
      color: var(--spotpatch-text-secondary);
      background: rgb(255 255 255 / 4%);
      cursor: pointer;
      font-size: 12px;
      font-weight: 650;
      transition: border-color 150ms ease, box-shadow 150ms ease, color 150ms ease, transform 150ms ease;
    }
    .spotpatch-actions button:hover:not(:disabled) {
      border-color: rgb(139 124 247 / 45%);
      color: #fff;
      transform: translateY(-1px);
    }
    .spotpatch-actions .spotpatch-primary {
      min-width: 138px;
      flex: 1;
      border-color: transparent;
      color: var(--spotpatch-text-on-accent);
      background: linear-gradient(135deg, var(--spotpatch-accent), var(--spotpatch-accent-strong));
      box-shadow: 0 8px 20px -8px rgb(139 123 255 / 55%);
    }
    .spotpatch-actions .spotpatch-primary:hover:not(:disabled) { color: var(--spotpatch-text-on-accent); filter: brightness(1.08); }
    .spotpatch-actions .spotpatch-primary::after { margin-left: 8px; content: "↗"; font-size: 12px; }
    .spotpatch-actions .spotpatch-secondary-action {
      min-height: 30px;
      border-style: dashed;
      padding: 5px 10px;
      color: var(--spotpatch-text-muted);
      background: transparent;
      font-size: 11px;
    }
    .spotpatch-actions .spotpatch-icon-action {
      width: 34px;
      min-width: 34px;
      padding: 0;
      font-size: 0;
    }
    .spotpatch-actions .spotpatch-icon-action::before {
      color: var(--spotpatch-text-secondary);
      content: attr(data-compact-icon);
      font-size: 18px;
      font-weight: 400;
      line-height: 1;
    }
    .spotpatch-actions button:disabled { cursor: not-allowed; opacity: .4; transform: none; }
    .spotpatch-actions button:focus-visible,
    .spotpatch-repository:focus-visible,
    .spotpatch-target-open:focus-visible,
    .spotpatch-target-remove:focus-visible,
    .spotpatch-close:focus-visible,
    .spotpatch-reset-position:focus-visible,
    .spotpatch-trigger:focus-visible,
    .spotpatch-target-select:focus-visible,
    .spotpatch-target-editor textarea:focus-visible,
    .spotpatch-locale:focus-visible,
    .spotpatch-prompt:focus-visible,
    .spotpatch-diagnostics > summary:focus-visible {
      outline: 2px solid #8b7cf7;
      outline-offset: 2px;
    }
    @keyframes spotpatch-island-pulse {
      0%, 100% { box-shadow: 0 0 0 4px rgb(99 102 241 / 10%); transform: scale(1); }
      50% { box-shadow: 0 0 0 7px rgb(99 102 241 / 4%); transform: scale(1.12); }
    }
    @keyframes spotpatch-workbench-enter {
      from { opacity: 0; transform: scale(.98); }
      to { opacity: 1; transform: scale(1); }
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
      .spotpatch-trigger[aria-pressed="true"]::before,
      .spotpatch-dialog { animation: none; }
    }
    @media (max-width: 520px) {
      .spotpatch-dialog { top: auto !important; right: 8px !important; bottom: 8px !important; left: 8px !important; width: auto; }
      .spotpatch-shell { max-height: calc(100dvh - 16px); border-radius: 14px; }
      .spotpatch-header, .spotpatch-body { padding-left: 14px; padding-right: 14px; }
      .spotpatch-brand-row { margin-right: -14px; margin-left: -14px; padding-right: 14px; padding-left: 14px; }
      .spotpatch-actions { padding-right: 14px; padding-left: 14px; }
      .spotpatch-target-select { grid-template-columns: 24px minmax(0, 1fr); }
      .spotpatch-target-state { display: none; }
      .spotpatch-repository { display: none; }
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

function startsOnInteractiveControl(event: PointerEvent): boolean {
  const target = event.target;

  return (
    target instanceof Element &&
    target.closest(
      "a, button, input, select, textarea, summary, [contenteditable='true']",
    ) !== null
  );
}

function createUnavailableDataFlowPanel(
  document: Document,
  changesRoot: HTMLElement,
  diagnosticsRoot: HTMLElement,
): DataFlowPanel {
  changesRoot.append(diagnosticsRoot);

  return Object.freeze({
    root: changesRoot,
    refreshButton: createButton(document, ""),
    styles: document.createElement("style"),
    dispose: () => undefined,
    render: () => undefined,
    resetView: () => undefined,
  });
}

export function createRuntimeView(
  document: Document,
  shortcut: string,
  ai: RuntimeAiConfig = Object.freeze({ enabled: false }),
  localePreference: SpotPatchLocalePreference = "auto",
  dataFlowEnabled = false,
  externalAgentEnabled = false,
  framework: "vite" | "next" = "vite",
  sessionId = "",
): RuntimeView {
  const localizer: UiLocalizer = createUiLocalizer(document, localePreference);
  const runtimeWindow = document.defaultView;

  if (runtimeWindow === null) {
    throw new Error("SpotPatch requires a document with an associated window.");
  }

  const floatingSurface = createFloatingSurfaceController(
    runtimeWindow,
    createFloatingSurfaceSession(runtimeWindow, sessionId),
    FLOATING_SURFACE_LAYOUT,
  );
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
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-labelledby", "spotpatch-selection-title");
  const shell = createMarkedElement(document, "div");
  shell.className = "spotpatch-shell";

  const header = createMarkedElement(document, "header");
  header.className = "spotpatch-header";
  header.setAttribute("data-spotpatch-drag-handle", "");
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
  const repositoryLink = createMarkedElement(document, "a");
  repositoryLink.className = "spotpatch-repository";
  repositoryLink.href = SPOTPATCH_REPOSITORY_URL;
  repositoryLink.target = "_blank";
  repositoryLink.rel = "noopener noreferrer";
  const localeButton = createButton(document, "", "spotpatch-locale");
  const resetPositionButton = createButton(document, "⌖", "spotpatch-reset-position");
  const closeButton = createButton(document, "×", "spotpatch-close");
  headerControls.append(repositoryLink, localeButton, resetPositionButton, closeButton);
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
  targetRow.append(targetCount);
  targetsHeading.append(targetsTitle, targetsMeta);
  const targetProgress = createMarkedElement(document, "div");
  targetProgress.className = "spotpatch-target-progress";
  targetProgress.setAttribute("aria-hidden", "true");
  const targetProgressFill = createMarkedElement(document, "div");
  targetProgressFill.className = "spotpatch-target-progress-fill";
  targetProgress.append(targetProgressFill);
  const targetList = createMarkedElement(document, "div");
  targetList.className = "spotpatch-target-list";
  targetsPanel.append(targetsHeading, targetProgress, targetList);
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
  const changesPanel = createMarkedElement(document, "div");
  function requestFloatingSurfaceLayout(): void {
    if (!dialog.hidden) {
      floatingSurface.requestReconcile();
    }
  }

  const externalHandoffPanel = externalAgentEnabled
    ? getExternalHandoffExtension()?.createPanel(
        document,
        framework,
        localizer.locale,
        sessionId,
        localizer.subscribe,
        requestFloatingSurfaceLayout,
      )
    : undefined;
  changesPanel.append(
    targetsPanel,
    agentPanel.root,
    ...(externalHandoffPanel === undefined ? [] : [externalHandoffPanel.root]),
  );
  const dataFlowPanel =
    getDataFlowExtension()?.createPanel(
      document,
      dataFlowEnabled,
      localizer.locale,
      changesPanel,
      diagnostics,
      requestFloatingSurfaceLayout,
    ) ?? createUnavailableDataFlowPanel(document, changesPanel, diagnostics);
  selectionPanel.append(dataFlowPanel.root);

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
  const editorFeedback = createMarkedElement(document, "div");
  editorFeedback.className = "spotpatch-context-state spotpatch-editor-feedback";
  editorFeedback.dataset.state = "idle";
  editorFeedback.setAttribute("role", "status");
  editorFeedback.setAttribute("aria-live", "polite");
  editorFeedback.hidden = true;
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
  const secondaryActions = createMarkedElement(document, "div");
  secondaryActions.className = "spotpatch-secondary-actions";
  const primaryActions = createMarkedElement(document, "div");
  primaryActions.className = "spotpatch-primary-actions";
  addTargetButton.classList.add("spotpatch-icon-action");
  addTargetButton.dataset.compactIcon = "+";
  agentPanel.testButton.classList.add("spotpatch-icon-action");
  agentPanel.testButton.dataset.compactIcon = "✓";
  openEditorButton.classList.add("spotpatch-secondary-action");
  reselectButton.classList.add("spotpatch-secondary-action");
  secondaryActions.append(openEditorButton, reselectButton);
  primaryActions.append(
    agentPanel.testButton,
    addTargetButton,
    agentPanel.runButton,
    ...(externalHandoffPanel === undefined ? [] : [externalHandoffPanel.sendButton]),
    previewButton,
    agentPanel.cancelButton,
    agentPanel.applyButton,
    agentPanel.revertButton,
    agentPanel.resetButton,
    copyButton,
    backButton,
  );
  actions.append(editorFeedback, secondaryActions, primaryActions);
  shell.append(header, body, actions);
  dialog.append(shell);

  const liveRegion = createMarkedElement(document, "div");
  liveRegion.className = "spotpatch-live";
  liveRegion.setAttribute("aria-live", "polite");
  liveRegion.setAttribute("aria-atomic", "true");

  const styles = [
    createStyles(document),
    dataFlowPanel.styles,
    ...(externalHandoffPanel === undefined ? [] : [externalHandoffPanel.styles]),
  ];
  const styleNonce = resolveStyleNonce(document);

  if (styleNonce !== undefined) {
    for (const style of styles) {
      style.nonce = styleNonce;
    }
  }

  shadowRoot.append(
    ...styles,
    selectionHighlights,
    highlight,
    dialog,
    triggerButton,
    liveRegion,
  );
  document.documentElement.append(host);
  floatingSurface.registerSurface(triggerButton);
  floatingSurface.registerSurface(dialog);
  floatingSurface.attachDraggable(triggerButton, triggerButton, {
    suppressClickOnDrag: true,
  });
  floatingSurface.attachDraggable(header, dialog, {
    canStartDrag: (event) =>
      !floatingSurface.isCompact() && !startsOnInteractiveControl(event),
  });
  floatingSurface.reconcile();

  let currentStatus: RuntimeStatus = "idle";
  let currentCanOpenEditor = false;
  let currentCanPreview = false;
  let currentSummaryText = "";
  let editingEnabled = true;
  let currentTargets: readonly SelectionTargetView[] = [];
  let currentMaximum = 0;
  let currentEditorFeedbackState: "idle" | "opening" | "success" | "error" = "idle";
  let currentDataFlowState: DataFlowViewState = Object.freeze({
    component: Object.freeze({
      status: dataFlowEnabled ? "idle" : "disabled",
    }),
    page: Object.freeze({ status: dataFlowEnabled ? "idle" : "disabled" }),
    observationCount: 0,
  });

  function renderEditorStatus(state: "idle" | "opening" | "success" | "error"): void {
    currentEditorFeedbackState = state;
    editorFeedback.dataset.state = state;
    editorFeedback.hidden = state === "idle";
    editorFeedback.textContent =
      state === "opening"
        ? messages.announcements.editorOpening
        : state === "success"
          ? messages.announcements.editorOpened
          : state === "error"
            ? messages.announcements.editorFailed
            : "";
    requestFloatingSurfaceLayout();
  }

  function statusText(target: SelectionTargetView): string {
    if (target.status === "ready") {
      return messages.targets.statusReady;
    }

    return target.status === "warning"
      ? messages.targets.statusPartial
      : messages.targets.statusCollecting;
  }

  function renderTargetProgress(complete: number, total: number): void {
    const ratio = total === 0 ? 0 : complete / total;
    targetProgressFill.style.width = `${String(ratio * 100)}%`;
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
    renderTargetProgress(completeCount, targets.length);
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
      const open = createButton(document, "↗", "spotpatch-target-open");
      open.dataset.openTargetId = target.id;
      open.disabled = !target.canOpenEditor;
      open.setAttribute("aria-label", messages.actions.openTarget(index + 1));
      open.title = messages.actions.openTarget(index + 1);
      const remove = createButton(document, "×", "spotpatch-target-remove");
      remove.dataset.removeTargetId = target.id;
      remove.disabled = !editingEnabled;
      remove.setAttribute("aria-label", messages.targets.remove(index + 1));
      remove.title = messages.targets.removeTitle;
      targetSummary.append(select, open, remove);
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

    requestFloatingSurfaceLayout();
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

    const completeCount = currentTargets.filter(
      (target) => target.instruction.trim().length > 0,
    ).length;
    targetComplete.textContent = messages.targets.complete(
      completeCount,
      currentTargets.length,
    );
    renderTargetProgress(completeCount, currentTargets.length);
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
    externalHandoffPanel?.setContextReady(canPreview);
    updateContextOverview(summaryText);
    requestFloatingSurfaceLayout();
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
    secondaryActions.hidden = !selected;
    agentPanel.setSelectionVisible(selected);
    externalHandoffPanel?.setSelectionVisible(selected);
    copyButton.hidden = !previewing;
    backButton.hidden = !previewing;
    title.textContent = previewing
      ? messages.dialog.previewTitle
      : messages.dialog.editTitle;
    subtitle.textContent = previewing
      ? messages.dialog.previewSubtitle
      : messages.dialog.editSubtitle;
    floatingSurface.reconcile();
  }

  function applyMessages(): void {
    messages = localizer.messages();
    brandName.textContent = messages.brand.name;
    brandContext.textContent = messages.brand.context;
    repositoryLink.textContent = messages.brand.repository;
    repositoryLink.title = messages.brand.repositoryTitle;
    repositoryLink.setAttribute("aria-label", messages.brand.repositoryTitle);
    localeButton.textContent = messages.alternateLocaleName;
    localeButton.title = messages.switchLocale;
    localeButton.setAttribute("aria-label", messages.switchLocale);
    resetPositionButton.title = messages.floatingSurface.resetPosition;
    resetPositionButton.setAttribute(
      "aria-label",
      messages.floatingSurface.resetPosition,
    );
    closeButton.setAttribute("aria-label", messages.dialog.close);
    closeButton.title = messages.dialog.close;
    header.title = messages.floatingSurface.dragHandle;
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
    dataFlowPanel.render(currentDataFlowState);
    triggerButton.title = messages.trigger.title(shortcut);
    triggerButton.textContent =
      currentStatus === "inspecting" ? messages.trigger.stop : messages.trigger.select;
    renderPanelStatus(currentStatus);
    renderEditorStatus(currentEditorFeedbackState);

    if (currentTargets.length > 0) {
      renderTargets(currentTargets, currentMaximum);
    } else {
      targetCount.textContent = messages.targets.count(0, currentMaximum);
      targetComplete.textContent = messages.targets.complete(0, 0);
      renderTargetProgress(0, 0);
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

  function announce(message: string): void {
    liveRegion.textContent = "";
    liveRegion.textContent = message;
  }

  function resetFloatingSurfacePosition(): void {
    floatingSurface.reset();
    announce(messages.floatingSurface.positionReset);
  }

  diagnostics.addEventListener("toggle", requestFloatingSurfaceLayout);
  localeButton.addEventListener("click", localizer.toggle);
  resetPositionButton.addEventListener("click", resetFloatingSurfacePosition);
  const unsubscribeLocale = localizer.subscribe(applyMessages);
  applyMessages();

  return Object.freeze({
    host,
    triggerButton,
    addTargetButton,
    targetList,
    reselectButton,
    openEditorButton,
    repositoryLink,
    previewButton,
    copyButton,
    dataFlowRefreshButton: dataFlowPanel.refreshButton,
    backButton,
    closeButton,
    agentProviderSelect: agentPanel.providerSelect,
    agentModelSelect: agentPanel.modelSelect,
    agentModeSelect: agentPanel.modeSelect,
    agentConsentCheckbox: agentPanel.consentCheckbox,
    agentWorkspaceConsentCheckbox: agentPanel.workspaceConsentCheckbox,
    agentTestButton: agentPanel.testButton,
    agentRunButton: agentPanel.runButton,
    agentCancelButton: agentPanel.cancelButton,
    agentApplyButton: agentPanel.applyButton,
    agentRevertButton: agentPanel.revertButton,
    agentResetButton: agentPanel.resetButton,
    ...(externalHandoffPanel === undefined ? {} : { externalHandoffPanel }),

    renderStatus(status: RuntimeStatus): void {
      const inspecting = status === "inspecting";
      triggerButton.setAttribute("aria-pressed", String(inspecting));
      triggerButton.textContent = inspecting
        ? messages.trigger.stop
        : messages.trigger.select;
      renderPanelStatus(status);
    },

    renderEditorStatus,

    renderDataFlow(state: DataFlowViewState): void {
      currentDataFlowState = state;
      dataFlowPanel.render(state);
      requestFloatingSurfaceLayout();
    },

    showHighlight(rect: ElementRect, label: string): void {
      highlight.hidden = false;
      highlight.style.transform = `translate(${String(rect.x)}px, ${String(rect.y)}px)`;
      highlight.style.width = `${String(rect.width)}px`;
      highlight.style.height = `${String(rect.height)}px`;
      highlightLabel.textContent = label;
      targetLabel.textContent = label;
    },

    hideHighlight(): void {
      highlight.hidden = true;
      highlightLabel.textContent = "";
    },

    showSelectionHighlights,

    hideSelectionHighlights(): void {
      selectionHighlights.replaceChildren();
    },

    showSelection(
      summaryText: string,
      canOpenEditor: boolean,
      canPreview: boolean,
    ): void {
      updateSelection(summaryText, canOpenEditor, canPreview);
      triggerButton.hidden = true;
      dialog.hidden = false;
      floatingSurface.reconcile();
    },

    updateSelection,

    renderTargets,

    updateTargetInstruction,

    setPreviewEnabled(enabled: boolean): void {
      currentCanPreview = enabled;
      previewButton.disabled = !enabled;
      agentPanel.setContextReady(enabled);
      externalHandoffPanel?.setContextReady(enabled);
    },

    hideSelection(): void {
      dialog.hidden = true;
      triggerButton.hidden = false;
      targetList.replaceChildren();
      currentTargets = [];
      currentMaximum = 0;
      currentSummaryText = "";
      renderEditorStatus("idle");
      targetCount.textContent = messages.targets.count(0, 0);
      targetComplete.textContent = messages.targets.complete(0, 0);
      renderTargetProgress(0, 0);
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
      externalHandoffPanel?.setContextReady(false);
      externalHandoffPanel?.setSelectionVisible(false);
      agentPanel.setEditingEnabled(true);
      agentPanel.resetJob();
      dataFlowPanel.resetView();
      floatingSurface.reconcile();
    },

    hideSelectionTemporarily(): void {
      dialog.hidden = true;
      triggerButton.hidden = false;
      floatingSurface.reconcile();
    },

    showPreview(prompt: string): void {
      promptOutput.textContent = prompt;
      requestFloatingSurfaceLayout();
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
      openEditorButton.disabled = !currentCanOpenEditor;
      previewButton.disabled = !enabled || !currentCanPreview;
      externalHandoffPanel?.setContextReady(enabled && currentCanPreview);
      agentPanel.setEditingEnabled(enabled);
      requestFloatingSurfaceLayout();
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
      requestFloatingSurfaceLayout();
    },

    renderAgentWorkspaceHealth(
      state: "idle" | "checking" | "ready" | "consent-required" | "blocked",
      snapshot?: AgentWorkspaceHealthSnapshot,
      errorCode?: ErrorCode,
    ): void {
      agentPanel.renderWorkspaceHealth(state, snapshot, errorCode);
      requestFloatingSurfaceLayout();
    },

    renderAgentJob(
      snapshot: AgentJobSnapshot,
      result: AgentJobResult | undefined,
      activities: readonly AgentActivityItem[],
      errorCode?: ErrorCode,
    ): void {
      agentPanel.renderJob(snapshot, result, activities, errorCode);
      requestFloatingSurfaceLayout();
    },

    resetAgentJob(): void {
      agentPanel.resetJob();
      requestFloatingSurfaceLayout();
    },

    focusTargetInstruction(targetId?: string): void {
      instructionInput(targetId)?.focus({ preventScroll: true });
    },

    focusPrompt(): void {
      promptOutput.focus({ preventScroll: true });
    },

    announce,

    locale: localizer.locale,

    messages: localizer.messages,

    agentWorkspaceConsentGranted: agentPanel.workspaceConsentGranted,

    subscribeLocale: localizer.subscribe,

    dispose(): void {
      diagnostics.removeEventListener("toggle", requestFloatingSurfaceLayout);
      localeButton.removeEventListener("click", localizer.toggle);
      resetPositionButton.removeEventListener("click", resetFloatingSurfacePosition);
      unsubscribeLocale();
      dataFlowPanel.dispose();
      externalHandoffPanel?.dispose();
      agentPanel.dispose();
      floatingSurface.dispose();
      host.remove();
    },
  });
}
