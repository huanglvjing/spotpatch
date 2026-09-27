import type {
  AgentCapabilitySnapshot,
  AgentJobResult,
  AgentJobSnapshot,
  AgentWorkspaceHealthSnapshot,
  ErrorCode,
  RuntimeAiConfig,
  SpotPatchLocale,
  SpotPatchLocalePreference,
  SpotPatchRuntimeConfig,
} from "@spotpatch/shared";
import {
  MAX_ANNOTATION_INSTRUCTION_CHARACTERS,
  MAX_TARGET_INSTRUCTION_CHARACTERS,
  SPOTPATCH_REPOSITORY_URL,
} from "@spotpatch/shared";
import type {
  DispatchSummary,
  ExternalAgentControlStatus,
} from "@spotpatch/shared/external-handoff-browser";

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
import { THEME_STYLES } from "./theme.js";
import {
  getExternalHandoffExtension,
  type ExternalHandoffPanel,
} from "./external-handoff-contract.js";
import {
  getContextualAskExtension,
  type ContextualAskPanel,
} from "./contextual-ask-contract.js";
import {
  type ExecutionActivityKind,
  type ExecutionIslandView,
  getFloatingSurfaceMotionExtension,
  type FloatingSurfaceActivity,
  type FloatingSurfaceMotionController,
  type FloatingSurfaceProjection,
  type FloatingSurfaceScene,
  type FloatingSurfaceTone,
} from "./motion-extension-contract.js";
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

const SUCCESS_SETTLE_MS = 1_500;

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
  readonly contextualAskPanel?: ContextualAskPanel;
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
    ${THEME_STYLES}
    .spotpatch-floating-surface {
      position: fixed;
      right: ${String(FLOATING_SURFACE_LAYOUT.desktopInset)}px;
      bottom: ${String(FLOATING_SURFACE_LAYOUT.desktopInset)}px;
      z-index: ${String(UI_Z_INDEX.controls)};
      box-sizing: border-box;
      overflow: hidden;
      isolation: isolate;
      border: 1px solid var(--spotpatch-border);
      background: var(--spotpatch-surface-fill);
      box-shadow: var(--spotpatch-shadow-float), var(--spotpatch-shadow-inset);
      transform-origin: 100% 100%;
    }
    .spotpatch-floating-surface[data-scene="pill"],
    .spotpatch-floating-surface[data-scene="capturing"] {
      width: max-content;
      border-radius: var(--spotpatch-radius-pill);
    }
    .spotpatch-floating-surface[data-scene="planner"] {
      border-radius: var(--spotpatch-radius-panel);
      box-shadow: var(--spotpatch-shadow-panel), var(--spotpatch-shadow-inset);
    }

    .spotpatch-trigger {
      display: inline-flex;
      min-height: 44px;
      align-items: center;
      gap: 10px;
      border: 0;
      border-radius: var(--spotpatch-radius-pill);
      padding: 0 18px 0 16px;
      color: var(--spotpatch-text);
      background: transparent;
      cursor: pointer;
      font-size: 13.5px;
      font-weight: 620;
      letter-spacing: -.005em;
      touch-action: none;
      user-select: none;
      transition: background var(--spotpatch-duration-fast) ease;
    }
    .spotpatch-trigger::before {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--spotpatch-accent);
      box-shadow: 0 0 0 4px var(--spotpatch-accent-tint);
      content: "";
      transition: background var(--spotpatch-duration-base) ease;
    }
    .spotpatch-trigger:hover { background: var(--spotpatch-hover); }
    .spotpatch-trigger[aria-pressed="true"]::before {
      background: var(--spotpatch-accent-cyan);
      animation: spotpatch-trigger-pulse 1.6s var(--spotpatch-ease-standard) infinite;
    }
    .spotpatch-trigger[data-dragging="true"] { cursor: grabbing; }
    @keyframes spotpatch-trigger-pulse {
      0% { box-shadow: 0 0 0 0 var(--spotpatch-cyan-line); }
      100% { box-shadow: 0 0 0 9px transparent; }
    }

    .spotpatch-highlight,
    .spotpatch-selection-highlight {
      position: fixed;
      top: 0;
      left: 0;
      box-sizing: border-box;
      border-radius: var(--spotpatch-radius-xs);
      pointer-events: none;
    }
    .spotpatch-highlight {
      z-index: ${String(UI_Z_INDEX.highlight)};
      border: 1.5px solid var(--spotpatch-accent);
      background: var(--spotpatch-accent-tint);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--spotpatch-accent) 12%, transparent);
      transition:
        transform var(--spotpatch-duration-fast) var(--spotpatch-ease-out),
        width var(--spotpatch-duration-fast) var(--spotpatch-ease-out),
        height var(--spotpatch-duration-fast) var(--spotpatch-ease-out);
    }
    .spotpatch-highlight-label,
    .spotpatch-selection-highlight > span {
      position: absolute;
      bottom: calc(100% + 6px);
      left: -1.5px;
      overflow: hidden;
      border-radius: var(--spotpatch-radius-xs);
      padding: 4px 8px;
      color: var(--spotpatch-text-on-accent);
      background: var(--spotpatch-accent-strong);
      font: 600 11px/1.3 var(--spotpatch-font-mono);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spotpatch-highlight-label { max-width: min(380px, 80vw); }
    .spotpatch-selection-highlights {
      position: fixed;
      inset: 0;
      z-index: ${String(UI_Z_INDEX.highlight)};
      pointer-events: none;
    }
    .spotpatch-selection-highlight {
      border: 1.5px solid var(--spotpatch-accent-cyan);
      background: var(--spotpatch-cyan-tint);
    }
    .spotpatch-selection-highlight[data-active="true"] {
      border-color: var(--spotpatch-accent);
      background: var(--spotpatch-accent-tint);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--spotpatch-accent) 12%, transparent);
    }
    .spotpatch-selection-highlight[data-entering="true"] {
      animation: spotpatch-pop var(--spotpatch-duration-base) var(--spotpatch-ease-spring) both;
    }
    .spotpatch-selection-highlight > span {
      max-width: min(300px, 70vw);
      color: var(--spotpatch-bg);
      background: var(--spotpatch-accent-cyan);
    }
    .spotpatch-selection-highlight[data-active="true"] > span {
      color: var(--spotpatch-text-on-accent);
      background: var(--spotpatch-accent-strong);
    }

    .spotpatch-dialog {
      position: relative;
      box-sizing: border-box;
      width: min(${String(FLOATING_SURFACE_LAYOUT.workbenchMaxWidth)}px, calc(100vw - ${String(FLOATING_SURFACE_LAYOUT.desktopInset * 2)}px));
      outline: none;
    }
    .spotpatch-shell {
      display: flex;
      box-sizing: border-box;
      max-height: min(${String(FLOATING_SURFACE_LAYOUT.workbenchMaxHeight)}px, calc(100vh - ${String(FLOATING_SURFACE_LAYOUT.desktopInset * 2)}px));
      overflow: hidden;
      flex-direction: column;
    }

    .spotpatch-header { padding: 0 18px 16px; }
    .spotpatch-header[data-spotpatch-drag-handle] { cursor: grab; touch-action: none; user-select: none; }
    .spotpatch-header[data-dragging="true"] { cursor: grabbing; }
    .spotpatch-header button,
    .spotpatch-header a { cursor: pointer; user-select: auto; }
    .spotpatch-brand-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin: 0 -18px 16px;
      padding: 12px 14px 12px 18px;
      border-bottom: 1px solid var(--spotpatch-border-subtle);
    }
    .spotpatch-brand { display: inline-flex; min-width: 0; align-items: center; gap: 10px; }
    .spotpatch-brand-mark { width: 28px; height: 28px; flex: none; }
    .spotpatch-brand-copy { display: grid; min-width: 0; gap: 1px; }
    .spotpatch-brand-name { font-size: 13.5px; font-weight: 650; letter-spacing: -.01em; }
    .spotpatch-brand-context { color: var(--spotpatch-text-muted); font-size: 11px; font-weight: 520; }
    .spotpatch-header-controls { display: inline-flex; flex: none; align-items: center; gap: 2px; }
    .spotpatch-repository,
    .spotpatch-locale,
    .spotpatch-reset-position,
    .spotpatch-close {
      display: inline-grid;
      box-sizing: border-box;
      min-width: 28px;
      height: 28px;
      place-items: center;
      border: 0;
      border-radius: var(--spotpatch-radius-sm);
      padding: 0 7px;
      color: var(--spotpatch-text-muted);
      background: transparent;
      font-size: 12px;
      font-weight: 600;
      line-height: 1;
      text-decoration: none;
      transition:
        color var(--spotpatch-duration-fast) ease,
        background var(--spotpatch-duration-fast) ease;
    }
    .spotpatch-reset-position,
    .spotpatch-close { padding: 0; font-size: 15px; }
    .spotpatch-repository:hover,
    .spotpatch-locale:hover,
    .spotpatch-reset-position:hover,
    .spotpatch-close:hover { color: var(--spotpatch-text); background: var(--spotpatch-hover); }

    .spotpatch-title {
      margin: 0;
      font-size: 17px;
      font-weight: 650;
      letter-spacing: -.02em;
      line-height: 1.3;
    }
    .spotpatch-subtitle {
      max-width: 400px;
      margin: 4px 0 0;
      color: var(--spotpatch-text-secondary);
      font-size: 12.5px;
      line-height: 1.55;
    }
    .spotpatch-target-row {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: 10px;
      margin-top: 14px;
    }
    .spotpatch-target-label {
      min-width: 0;
      overflow: hidden;
      border: 1px solid var(--spotpatch-accent-line);
      border-radius: var(--spotpatch-radius-pill);
      padding: 3px 10px;
      color: var(--spotpatch-accent-soft);
      background: var(--spotpatch-accent-tint);
      font: 600 11px/1.4 var(--spotpatch-font-mono);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spotpatch-context-state {
      display: inline-flex;
      flex: none;
      align-items: center;
      gap: 6px;
      color: var(--spotpatch-warning-text);
      font-size: 11.5px;
      white-space: nowrap;
    }
    .spotpatch-context-state::before {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--spotpatch-warning);
      content: "";
    }
    .spotpatch-context-state[data-state="loading"]::before {
      animation: spotpatch-dot-breathe 1.4s ease-in-out infinite;
    }
    .spotpatch-context-state[data-state="ready"],
    .spotpatch-editor-feedback[data-state="success"] { color: var(--spotpatch-success-text); }
    .spotpatch-context-state[data-state="ready"]::before,
    .spotpatch-editor-feedback[data-state="success"]::before { background: var(--spotpatch-success); }
    .spotpatch-context-state[data-state="warning"],
    .spotpatch-editor-feedback[data-state="error"] { color: var(--spotpatch-danger-text); }
    .spotpatch-context-state[data-state="warning"]::before,
    .spotpatch-editor-feedback[data-state="error"]::before { background: var(--spotpatch-danger); }
    @keyframes spotpatch-dot-breathe {
      50% { opacity: .35; }
    }

    .spotpatch-body {
      min-height: 0;
      overflow: auto;
      overscroll-behavior: contain;
      padding: 0 18px 16px;
    }
    .spotpatch-targets-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
      color: var(--spotpatch-text-muted);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: .06em;
      text-transform: uppercase;
    }
    .spotpatch-targets-meta {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: 8px;
      letter-spacing: 0;
      text-transform: none;
    }
    .spotpatch-target-budget { font: 500 11px/1.4 var(--spotpatch-font-mono); }
    .spotpatch-target-budget[data-state="ready"] { display: none; }
    .spotpatch-target-budget[data-state="over"] { color: var(--spotpatch-danger-text); }
    .spotpatch-target-count {
      margin-left: auto;
      color: var(--spotpatch-text-muted);
      font: 500 11px/1.4 var(--spotpatch-font-mono);
    }
    .spotpatch-target-progress {
      height: 2px;
      margin-bottom: 12px;
      overflow: hidden;
      border-radius: var(--spotpatch-radius-pill);
      background: var(--spotpatch-border-subtle);
    }
    .spotpatch-target-progress-fill {
      width: 0;
      height: 100%;
      border-radius: inherit;
      background: var(--spotpatch-brand-line);
      transition: width var(--spotpatch-duration-slow) var(--spotpatch-ease-out);
    }
    .spotpatch-target-list {
      display: grid;
      gap: 8px;
      max-height: min(340px, 48vh);
      overflow: auto;
      padding: 2px;
      margin: -2px;
    }

    .spotpatch-target-item {
      overflow: hidden;
      border: 1px solid var(--spotpatch-border-subtle);
      border-radius: var(--spotpatch-radius-card);
      background: var(--spotpatch-bg-raised);
      transition:
        border-color var(--spotpatch-duration-base) ease,
        background var(--spotpatch-duration-base) ease,
        box-shadow var(--spotpatch-duration-base) ease;
    }
    .spotpatch-target-item[data-active="true"] {
      border-color: var(--spotpatch-accent-line);
      background: var(--spotpatch-bg-active);
      box-shadow: 0 0 0 3px var(--spotpatch-accent-tint);
    }
    .spotpatch-target-item[data-entering="true"] {
      animation: spotpatch-enter var(--spotpatch-duration-slow) var(--spotpatch-ease-out) both;
    }
    .spotpatch-target-summary {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 30px 30px;
      align-items: center;
      gap: 2px;
      padding: 4px;
    }
    .spotpatch-target-select {
      display: grid;
      grid-template-columns: 24px minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      min-width: 0;
      border: 0;
      border-radius: var(--spotpatch-radius-sm);
      padding: 7px 8px;
      color: inherit;
      background: transparent;
      cursor: pointer;
      text-align: left;
      transition: background var(--spotpatch-duration-fast) ease;
    }
    .spotpatch-target-select:hover { background: var(--spotpatch-hover); }
    .spotpatch-target-index {
      display: inline-grid;
      width: 24px;
      height: 24px;
      place-items: center;
      border-radius: var(--spotpatch-radius-xs);
      color: var(--spotpatch-text-secondary);
      background: var(--spotpatch-hover);
      font: 600 11px/1 var(--spotpatch-font-mono);
    }
    [data-active="true"] .spotpatch-target-index {
      color: var(--spotpatch-text-on-accent);
      background: var(--spotpatch-accent-strong);
    }
    .spotpatch-target-copy { min-width: 0; }
    .spotpatch-target-name,
    .spotpatch-target-source {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spotpatch-target-name { font-size: 13px; font-weight: 620; }
    .spotpatch-target-source {
      margin-top: 1px;
      color: var(--spotpatch-text-muted);
      font: 500 11px/1.4 var(--spotpatch-font-mono);
    }
    .spotpatch-target-state {
      border-radius: var(--spotpatch-radius-pill);
      padding: 3px 8px;
      color: var(--spotpatch-success-text);
      background: var(--spotpatch-success-tint);
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
    }
    .spotpatch-target-state[data-complete="false"] {
      color: var(--spotpatch-warning-text);
      background: var(--spotpatch-warning-tint);
    }
    .spotpatch-target-open,
    .spotpatch-target-remove {
      display: inline-grid;
      width: 30px;
      height: 30px;
      place-items: center;
      border: 0;
      border-radius: var(--spotpatch-radius-sm);
      padding: 0;
      color: var(--spotpatch-text-muted);
      background: transparent;
      cursor: pointer;
      transition:
        color var(--spotpatch-duration-fast) ease,
        background var(--spotpatch-duration-fast) ease;
    }
    .spotpatch-target-open:hover:not(:disabled) { color: var(--spotpatch-cyan-text); background: var(--spotpatch-cyan-tint); }
    .spotpatch-target-remove:hover:not(:disabled) { color: var(--spotpatch-danger-text); background: var(--spotpatch-danger-tint); }
    .spotpatch-target-open:disabled,
    .spotpatch-target-remove:disabled { cursor: not-allowed; opacity: .35; }

    .spotpatch-target-editor {
      display: block;
      padding: 2px 12px 12px;
    }
    .spotpatch-target-editor-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 6px;
    }
    .spotpatch-target-editor-label { color: var(--spotpatch-text-secondary); font-size: 11.5px; font-weight: 600; }
    .spotpatch-target-editor-count { color: var(--spotpatch-text-muted); font: 500 11px/1.3 var(--spotpatch-font-mono); }
    .spotpatch-target-editor textarea {
      display: block;
      box-sizing: border-box;
      width: 100%;
      min-height: 76px;
      resize: vertical;
      border: 1px solid var(--spotpatch-border);
      border-radius: var(--spotpatch-radius-md);
      padding: 10px 12px;
      color: var(--spotpatch-text);
      caret-color: var(--spotpatch-accent-soft);
      background: var(--spotpatch-bg-input);
      font-size: 13px;
      line-height: 1.55;
      outline: none;
      transition:
        border-color var(--spotpatch-duration-fast) ease,
        box-shadow var(--spotpatch-duration-fast) ease;
    }
    .spotpatch-target-editor textarea::placeholder { color: var(--spotpatch-text-muted); }
    .spotpatch-target-editor textarea:hover { border-color: var(--spotpatch-border-strong); }
    .spotpatch-target-editor textarea:focus {
      border-color: var(--spotpatch-accent-line);
      box-shadow: 0 0 0 3px var(--spotpatch-accent-tint);
    }

    .spotpatch-diagnostics {
      margin-top: 10px;
      overflow: hidden;
      border: 1px solid var(--spotpatch-border-subtle);
      border-radius: var(--spotpatch-radius-md);
    }
    .spotpatch-diagnostics > summary {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 9px 12px;
      color: var(--spotpatch-text-secondary);
      cursor: pointer;
      font-size: 11.5px;
      font-weight: 600;
      list-style: none;
      user-select: none;
    }
    .spotpatch-diagnostics > summary::-webkit-details-marker { display: none; }
    .spotpatch-diagnostics > summary::before {
      color: var(--spotpatch-text-muted);
      content: "›";
      font-size: 16px;
      line-height: 1;
      transition: transform var(--spotpatch-duration-base) var(--spotpatch-ease-out);
    }
    .spotpatch-diagnostics[open] > summary::before { transform: rotate(90deg); }
    .spotpatch-source-peek {
      min-width: 0;
      margin-left: auto;
      overflow: hidden;
      color: var(--spotpatch-text-muted);
      font: 500 11px/1.3 var(--spotpatch-font-mono);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spotpatch-summary,
    .spotpatch-prompt {
      margin: 0;
      overflow: auto;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
      user-select: text;
      font: 11px/1.6 var(--spotpatch-font-mono);
    }
    .spotpatch-summary {
      max-height: 170px;
      border-top: 1px solid var(--spotpatch-border-subtle);
      padding: 10px 12px 12px;
      color: var(--spotpatch-text-secondary);
    }
    .spotpatch-prompt {
      max-height: min(500px, 60vh);
      border: 1px solid var(--spotpatch-border-subtle);
      border-radius: var(--spotpatch-radius-md);
      padding: 12px;
      color: var(--spotpatch-text);
      background: var(--spotpatch-bg-input);
    }

    .spotpatch-actions {
      display: grid;
      gap: 8px;
      border-top: 1px solid var(--spotpatch-border-subtle);
      padding: 12px 18px 16px;
    }
    .spotpatch-editor-feedback { white-space: normal; }
    .spotpatch-secondary-actions,
    .spotpatch-primary-actions { display: flex; align-items: center; gap: 8px; }
    .spotpatch-secondary-actions { gap: 2px; margin: 0 -8px; }
    .spotpatch-actions button {
      display: inline-flex;
      min-height: 36px;
      align-items: center;
      justify-content: center;
      gap: 6px;
      border: 1px solid var(--spotpatch-border);
      border-radius: var(--spotpatch-radius-md);
      padding: 0 12px;
      color: var(--spotpatch-text);
      background: var(--spotpatch-bg-raised);
      cursor: pointer;
      font-size: 12.5px;
      font-weight: 600;
      white-space: nowrap;
      transition:
        border-color var(--spotpatch-duration-fast) ease,
        background var(--spotpatch-duration-fast) ease,
        box-shadow var(--spotpatch-duration-base) ease,
        transform var(--spotpatch-duration-fast) ease;
    }
    .spotpatch-actions button:hover:not(:disabled) {
      border-color: var(--spotpatch-border-strong);
      background: var(--spotpatch-bg-active);
    }
    .spotpatch-actions button:active:not(:disabled) { transform: scale(.98); }
    .spotpatch-actions .spotpatch-primary {
      min-width: 140px;
      flex: 1;
      border-color: transparent;
      color: var(--spotpatch-text-on-accent);
      background: var(--spotpatch-primary-fill);
      box-shadow: var(--spotpatch-shadow-accent), var(--spotpatch-shadow-inset);
    }
    .spotpatch-actions .spotpatch-primary:hover:not(:disabled) {
      border-color: transparent;
      background: var(--spotpatch-primary-fill);
      filter: brightness(1.1);
    }
    .spotpatch-actions .spotpatch-primary::after { content: "↗"; font-size: 12px; opacity: .8; }
    .spotpatch-actions .spotpatch-secondary-action {
      min-height: 30px;
      border-color: transparent;
      padding: 0 8px;
      color: var(--spotpatch-text-secondary);
      background: transparent;
      font-size: 12px;
      font-weight: 550;
    }
    .spotpatch-actions .spotpatch-secondary-action:hover:not(:disabled) {
      border-color: transparent;
      color: var(--spotpatch-text);
      background: var(--spotpatch-hover);
    }
    .spotpatch-actions .spotpatch-icon-action {
      width: 36px;
      min-width: 36px;
      padding: 0;
      font-size: 0;
    }
    .spotpatch-actions .spotpatch-icon-action::before {
      color: var(--spotpatch-text-secondary);
      content: attr(data-compact-icon);
      font-size: 17px;
      font-weight: 400;
      line-height: 1;
    }
    .spotpatch-actions button:disabled {
      box-shadow: none;
      cursor: not-allowed;
      filter: none;
      opacity: .4;
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
    @media (max-width: 520px) {
      .spotpatch-dialog { width: calc(100vw - 16px); }
      .spotpatch-shell { max-height: calc(100dvh - 16px); }
      .spotpatch-header, .spotpatch-body { padding-right: 14px; padding-left: 14px; }
      .spotpatch-brand-row { margin-right: -14px; margin-left: -14px; padding-right: 10px; padding-left: 14px; }
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

function createFallbackExecutionIsland(document: Document): ExecutionIslandView {
  const root = createButton(document, "", "spotpatch-execution-island");
  root.hidden = true;
  root.setAttribute("aria-hidden", "true");
  const logo = createBrandMark(
    document,
    undefined,
    "spotpatch-fallback-execution-island",
  );
  logo.classList.add("spotpatch-execution-logo");
  const copy = createMarkedElement(document, "span");
  root.append(logo, copy);

  return Object.freeze({
    canExpand: () => false,
    isExpanded: () => false,
    root,
    setExpanded: () => undefined,
    render(projection: FloatingSurfaceProjection): void {
      const text = [projection.headline, projection.action, projection.meta]
        .filter((value) => value.length > 0)
        .join(" · ");
      copy.textContent = text;
      root.setAttribute("aria-label", text);
    },
    dispose(): void {
      // The no-motion fallback owns no listeners or timers.
    },
  });
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
  framework: SpotPatchRuntimeConfig["framework"] = "vite",
  sessionId = "",
  contextualAskEnabled = false,
): RuntimeView {
  const localizer: UiLocalizer = createUiLocalizer(document, localePreference);
  const associatedWindow = document.defaultView;

  if (associatedWindow === null) {
    throw new Error("SpotPatch requires a document with an associated window.");
  }
  const runtimeWindow: Window = associatedWindow;

  const floatingSurface = createFloatingSurfaceController(
    runtimeWindow,
    createFloatingSurfaceSession(runtimeWindow, sessionId),
    FLOATING_SURFACE_LAYOUT,
  );
  let messages = localizer.messages();
  let currentStatus: RuntimeStatus = "idle";
  let contextualAskMode: "ask" | "change" = "change";
  let contextualAskTitle = "";
  let contextualAskSubtitle = "";
  let plannerVisible = false;
  let executionSuppressed = false;
  let executionProjection: FloatingSurfaceProjection | undefined;
  let pendingAgentMotion:
    | Readonly<{
        source: HTMLButtonElement;
        target: HTMLElement;
      }>
    | undefined;
  let successSettleKey: string | undefined;
  let settledSuccessKey: string | undefined;
  let successSettleTimer: number | undefined;
  let observedExecutionStartedAt: string | undefined;
  const host = document.createElement("spotpatch-root");
  host.setAttribute(UI_MARKER_ATTRIBUTE, "");
  const shadowRoot = host.attachShadow({ mode: "open" });
  const floatingSurfaceRoot = createMarkedElement(document, "div");
  floatingSurfaceRoot.className = "spotpatch-floating-surface";
  floatingSurfaceRoot.dataset.scene = "pill";
  floatingSurfaceRoot.dataset.tone = "neutral";
  const triggerButton = createButton(
    document,
    messages.trigger.select,
    "spotpatch-trigger",
  );
  triggerButton.title = messages.trigger.title(shortcut);
  triggerButton.setAttribute("aria-pressed", "false");

  const motionExtension = getFloatingSurfaceMotionExtension();
  const motionExecutionIsland = motionExtension?.createExecutionIsland(document);
  const executionIslandView: ExecutionIslandView =
    motionExecutionIsland ?? createFallbackExecutionIsland(document);
  const executionIsland = executionIslandView.root;

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
    if (plannerVisible) {
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
        renderExternalDispatch,
        renderExternalControl,
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
  const contextualAskPanel = contextualAskEnabled
    ? getContextualAskExtension()?.createPanel({
        document,
        locale: localizer.locale,
        subscribeLocale: localizer.subscribe,
        changeRoot: dataFlowPanel.root,
        changeActions: actions,
        announce,
        onModeChange(mode, askTitle, askSubtitle) {
          contextualAskMode = mode;
          contextualAskTitle = askTitle;
          contextualAskSubtitle = askSubtitle;
          if (host.isConnected) renderPanelStatus(currentStatus);
        },
        onExecutionChange(projection) {
          executionProjection = projection;
          executionSuppressed = false;
          renderFloatingSurfaceMotion();
        },
        onViewChange: requestFloatingSurfaceLayout,
      })
    : undefined;
  if (contextualAskPanel !== undefined) {
    selectionPanel.prepend(contextualAskPanel.root);
  }
  shell.append(header, body, actions);
  dialog.append(shell);

  const liveRegion = createMarkedElement(document, "div");
  liveRegion.className = "spotpatch-live";
  liveRegion.setAttribute("aria-live", "polite");
  liveRegion.setAttribute("aria-atomic", "true");

  const styles = [
    createStyles(document),
    ...(motionExtension === undefined ? [] : [motionExtension.createStyles(document)]),
    dataFlowPanel.styles,
    ...(contextualAskPanel === undefined ? [] : [contextualAskPanel.styles]),
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
    floatingSurfaceRoot,
    liveRegion,
  );
  floatingSurfaceRoot.append(triggerButton, dialog, executionIsland);
  document.documentElement.append(host);
  floatingSurface.registerSurface(floatingSurfaceRoot);
  const motionController: FloatingSurfaceMotionController | undefined =
    motionExtension === undefined || motionExecutionIsland === undefined
      ? undefined
      : motionExtension.createController(
          document,
          Object.freeze({
            execution: motionExecutionIsland.elements,
            pill: triggerButton,
            planner: dialog,
            surface: floatingSurfaceRoot,
          }),
          floatingSurface.reconcile,
        );
  const cancelMotionOnDrag = (): void => {
    motionController?.cancel();
  };
  floatingSurface.attachDraggable(triggerButton, floatingSurfaceRoot, {
    onDragStart: cancelMotionOnDrag,
    suppressClickOnDrag: true,
  });
  floatingSurface.attachDraggable(header, floatingSurfaceRoot, {
    canStartDrag: (event) =>
      !floatingSurface.isCompact() && !startsOnInteractiveControl(event),
    onDragStart: cancelMotionOnDrag,
  });
  floatingSurface.attachDraggable(executionIsland, floatingSurfaceRoot, {
    onDragStart: cancelMotionOnDrag,
    suppressClickOnDrag: true,
  });
  floatingSurface.reconcile();

  let currentCanOpenEditor = false;
  let currentCanPreview = false;
  let currentSummaryText = "";
  let editingEnabled = true;
  let currentTargets: readonly SelectionTargetView[] = [];
  let currentMaximum = 0;
  // Lists are rebuilt on every render; only ids absent from the previous
  // render play the entrance animation.
  let renderedTargetIds: ReadonlySet<string> = new Set();
  let renderedHighlightIds: ReadonlySet<string> = new Set();
  let currentEditorFeedbackState: "idle" | "opening" | "success" | "error" = "idle";
  let currentDataFlowState: DataFlowViewState = Object.freeze({
    component: Object.freeze({
      status: dataFlowEnabled ? "idle" : "disabled",
    }),
    page: Object.freeze({ status: dataFlowEnabled ? "idle" : "disabled" }),
    observationCount: 0,
  });

  function currentTargetSummary(): Readonly<{ label: string; source: string }> {
    const target = currentTargets.find((candidate) => candidate.active);
    return target === undefined
      ? Object.freeze({
          label: messages.context.selectedElement,
          source: "",
        })
      : Object.freeze({ label: target.label, source: target.source });
  }

  function currentTargetContext(): string {
    const target = currentTargetSummary();
    return target.source.length === 0
      ? target.label
      : `${target.label} · ${target.source}`;
  }

  function beginObservedExecution(): string {
    observedExecutionStartedAt = new Date().toISOString();
    return observedExecutionStartedAt;
  }

  function observedExecutionStart(): string {
    return observedExecutionStartedAt ?? beginObservedExecution();
  }

  function clearSuccessSettle(resetKeys: boolean): void {
    if (successSettleTimer !== undefined) {
      runtimeWindow.clearTimeout(successSettleTimer);
      successSettleTimer = undefined;
    }
    if (resetKeys) {
      successSettleKey = undefined;
      settledSuccessKey = undefined;
    }
  }

  function showSuccessUntilSettled(key: string): boolean {
    if (settledSuccessKey === key) return false;
    if (successSettleKey === key) return true;

    clearSuccessSettle(false);
    successSettleKey = key;
    successSettleTimer = runtimeWindow.setTimeout(() => {
      successSettleTimer = undefined;
      if (!host.isConnected) return;
      settledSuccessKey = key;
      executionProjection = undefined;
      observedExecutionStartedAt = undefined;
      executionSuppressed = false;
      plannerVisible = false;
      renderFloatingSurfaceMotion();
    }, SUCCESS_SETTLE_MS);
    return true;
  }

  function externalAgentIdentity(kind: string): string {
    return kind.startsWith("claude")
      ? messages.execution.claude
      : kind.startsWith("codex")
        ? messages.execution.codex
        : kind;
  }

  function projectAgentActivity(item: AgentActivityItem): FloatingSurfaceActivity {
    return Object.freeze({
      ...(item.detail === undefined ? {} : { detail: item.detail }),
      key: item.key,
      kind: item.kind,
      label: messages.execution.activityLane(item.kind, item.detail),
      state: item.state,
    });
  }

  function motionActivity(
    key: string,
    kind: ExecutionActivityKind,
    detail: string | undefined,
    state: FloatingSurfaceActivity["state"] = "active",
  ): FloatingSurfaceActivity {
    return Object.freeze({
      ...(detail === undefined ? {} : { detail }),
      key,
      kind,
      label: messages.execution.activityLane(kind, detail),
      state,
    });
  }

  function renderFloatingSurfaceMotion(): void {
    const capturing = currentStatus === "inspecting";
    const pillActive = !plannerVisible || capturing;
    const projection: FloatingSurfaceProjection = pillActive
      ? {
          scene: capturing ? "capturing" : "pill",
          tone: capturing ? "capturing" : "neutral",
          headline: triggerButton.textContent,
          action: "",
          meta: "",
          recentActivities: Object.freeze([]),
        }
      : !executionSuppressed && executionProjection !== undefined
        ? executionProjection
        : {
            scene: "planner",
            tone: "ready",
            headline: messages.dialog.editTitle,
            action: messages.dialog.editSubtitle,
            meta: messages.context.ready,
            recentActivities: Object.freeze([]),
          };

    if (motionController !== undefined) {
      motionController.render(projection, () => {
        executionIslandView.render(projection);
      });
      return;
    }

    executionIslandView.render(projection);
    floatingSurfaceRoot.dataset.scene = projection.scene;
    floatingSurfaceRoot.dataset.tone = projection.tone;
    const plannerActive = projection.scene === "planner";
    triggerButton.hidden = !pillActive;
    triggerButton.inert = !pillActive;
    dialog.hidden = !plannerActive;
    dialog.inert = !plannerActive;
    dialog.setAttribute("aria-hidden", String(!plannerActive));
    executionIsland.hidden = pillActive || plannerActive;
    executionIsland.inert = pillActive || plannerActive;
    executionIsland.setAttribute("aria-hidden", String(pillActive || plannerActive));
    floatingSurface.reconcile();
  }

  function renderExternalDispatch(dispatch: DispatchSummary | null): void {
    if (dispatch === null) {
      pendingAgentMotion = undefined;
      observedExecutionStartedAt = undefined;
    } else if (
      pendingAgentMotion !== undefined &&
      dispatch.phase !== "failed" &&
      dispatch.phase !== "delivery-unknown"
    ) {
      startStagedAgentRequest();
    } else if (dispatch.phase === "failed" || dispatch.phase === "delivery-unknown") {
      pendingAgentMotion = undefined;
    }

    if (dispatch !== null && !executionSuppressed) {
      const failed =
        dispatch.phase === "failed" || dispatch.phase === "delivery-unknown";
      const completed = dispatch.phase === "completed";
      const startedAt = failed || completed ? undefined : observedExecutionStart();
      if (failed || completed) observedExecutionStartedAt = undefined;
      const successKey = `dispatch:${String(dispatch.revision)}`;
      if (completed && !showSuccessUntilSettled(successKey)) {
        executionProjection = undefined;
        renderFloatingSurfaceMotion();
        return;
      }
      const identity = externalAgentIdentity(dispatch.adapterKind);
      const target = currentTargetSummary();
      const activityKind: ExecutionActivityKind =
        dispatch.phase === "queued" ||
        dispatch.phase === "dispatching" ||
        dispatch.phase === "dispatched"
          ? "dispatch"
          : completed
            ? "sync"
            : "unknown";
      const activity = motionActivity(
        `dispatch:${String(dispatch.revision)}:${dispatch.phase}`,
        activityKind,
        dispatch.phase,
        failed ? "failure" : completed ? "success" : "active",
      );
      const scene = failed
        ? "failed"
        : completed
          ? "success"
          : dispatch.phase === "working"
            ? "running"
            : "handoff";
      executionProjection = {
        scene,
        tone: failed ? "danger" : completed ? "success" : "running",
        headline: completed
          ? messages.execution.completedTitle
          : failed
            ? messages.execution.failedTitle
            : scene === "running"
              ? messages.execution.runningTitle(target.label)
              : messages.execution.dispatchingTitle(identity),
        action: completed ? messages.execution.resultReturned : target.source,
        expandedHeadline: completed
          ? messages.execution.expandedCompletedTitle
          : failed
            ? messages.execution.failedTitle
            : scene === "running"
              ? messages.execution.expandedRunningTitle(identity)
              : messages.execution.dispatchingTitle(identity),
        expandedAction: completed
          ? messages.execution.resultReturned
          : currentTargetContext(),
        meta: failed
          ? messages.execution.failedStatus
          : completed
            ? messages.execution.completedStatus
            : scene === "running"
              ? messages.execution.runningStatus
              : messages.execution.dispatchingStatus,
        activity,
        recentActivities: Object.freeze([activity]),
        ...(startedAt === undefined ? {} : { startedAt }),
      };
    } else if (dispatch === null) {
      executionProjection = undefined;
    }
    renderFloatingSurfaceMotion();
  }

  function renderExternalControl(status: ExternalAgentControlStatus | undefined): void {
    const task = status?.task;
    if (status === undefined || task === undefined || executionSuppressed) return;
    const phase = task.managedPhase;
    const failed = phase === "failed" || phase === "cleanup-warning";
    const completed = phase === "completed" || phase === "review-required";
    const cancelled = phase === "cancelled";
    if (failed || cancelled) {
      pendingAgentMotion = undefined;
    } else if (pendingAgentMotion !== undefined) {
      startStagedAgentRequest();
    }
    if (cancelled) {
      executionProjection = undefined;
      observedExecutionStartedAt = undefined;
      renderFloatingSurfaceMotion();
      return;
    }
    const startedAt = failed || completed ? undefined : observedExecutionStart();
    if (failed || completed) observedExecutionStartedAt = undefined;
    if (
      phase === "completed" &&
      !showSuccessUntilSettled(`managed:${String(task.revision)}`)
    ) {
      executionProjection = undefined;
      renderFloatingSurfaceMotion();
      return;
    }
    const scene: FloatingSurfaceScene = failed
      ? "failed"
      : completed
        ? "success"
        : phase === "preparing"
          ? "handoff"
          : "running";
    const tone: FloatingSurfaceTone = failed
      ? "danger"
      : completed
        ? "success"
        : "running";
    const identity = messages.execution.codex;
    const target = currentTargetSummary();
    const activityKind: ExecutionActivityKind =
      phase === "preparing"
        ? "prepare"
        : phase === "auditing"
          ? "audit"
          : phase === "validating"
            ? "check"
            : phase === "applying"
              ? "apply"
              : completed
                ? "sync"
                : "unknown";
    const latestCheck = task.checks.at(-1);
    const latestFile = task.files.at(-1);
    const activityDetail =
      phase === "validating"
        ? latestCheck?.id
        : phase === "auditing" || phase === "applying"
          ? latestFile?.path
          : undefined;
    const activity = motionActivity(
      `managed:${String(task.revision)}:${phase}:${activityDetail ?? ""}`,
      activityKind,
      activityDetail,
      failed ? "failure" : completed ? "success" : "active",
    );
    const recentActivities = Object.freeze([
      ...task.files
        .slice(-2)
        .map((file) =>
          motionActivity(
            `managed-file:${String(task.revision)}:${file.path}`,
            "patch",
            file.path,
            "success",
          ),
        ),
      ...task.checks
        .slice(-2)
        .map((check) =>
          motionActivity(
            `managed-check:${String(task.revision)}:${check.id}`,
            "check",
            check.id,
            check.outcome === "passed" ? "success" : "failure",
          ),
        ),
      activity,
    ]);
    executionProjection = {
      scene,
      tone,
      headline: completed
        ? messages.execution.completedTitle
        : failed
          ? messages.execution.failedTitle
          : scene === "handoff"
            ? messages.execution.dispatchingTitle(identity)
            : phase === "validating"
              ? messages.execution.activityAction("check", activityDetail)
              : messages.execution.runningTitle(target.label),
      action: completed
        ? task.files.length === 0
          ? messages.execution.resultReturned
          : messages.execution.resultSummary(task.files.length)
        : target.source,
      expandedHeadline: completed
        ? messages.execution.expandedCompletedTitle
        : failed
          ? messages.execution.failedTitle
          : scene === "handoff"
            ? messages.execution.dispatchingTitle(identity)
            : messages.execution.expandedRunningTitle(identity),
      expandedAction: completed
        ? messages.execution.resultReturned
        : currentTargetContext(),
      meta: failed
        ? messages.execution.failedStatus
        : completed
          ? messages.execution.completedStatus
          : phase === "validating"
            ? messages.execution.checkingStatus
            : scene === "handoff"
              ? messages.execution.dispatchingStatus
              : messages.execution.runningStatus,
      activity,
      recentActivities,
      ...(startedAt === undefined ? {} : { startedAt }),
    };
    renderFloatingSurfaceMotion();
  }

  function beginAgentRequest(target: HTMLButtonElement, agentCard: HTMLElement): void {
    if (!plannerVisible) {
      return;
    }

    clearSuccessSettle(true);
    const startedAt = beginObservedExecution();
    executionSuppressed = false;
    const activity = motionActivity(
      `dispatch-start:${currentTargetContext()}`,
      "dispatch",
      currentTargetContext(),
    );
    executionProjection = {
      scene: "agent-charging",
      tone: "running",
      headline: messages.execution.receivingTitle,
      action: currentTargetContext(),
      expandedHeadline: messages.execution.receivingTitle,
      expandedAction: currentTargetContext(),
      meta: messages.execution.receivingStatus,
      activity,
      recentActivities: Object.freeze([activity]),
      startedAt,
    };
    renderFloatingSurfaceMotion();
    motionController?.dispatch(target, agentCard);
  }

  function stageAgentRequest(source: HTMLButtonElement, target: HTMLElement): void {
    if (!plannerVisible || source.disabled) return;
    pendingAgentMotion = Object.freeze({ source, target });
  }

  function startStagedAgentRequest(): void {
    const pending = pendingAgentMotion;
    pendingAgentMotion = undefined;
    if (
      pending === undefined ||
      !pending.source.isConnected ||
      !pending.target.isConnected
    ) {
      return;
    }
    beginAgentRequest(pending.source, pending.target);
  }

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
    const previousTargetIds = renderedTargetIds;
    renderedTargetIds = new Set(targets.map((target) => target.id));
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
      item.dataset.entering = String(!previousTargetIds.has(target.id));
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
    const previousHighlightIds = renderedHighlightIds;
    renderedHighlightIds = new Set(targets.map((target) => target.id));
    selectionHighlights.replaceChildren();

    for (const [index, target] of targets.entries()) {
      const box = createMarkedElement(document, "div");
      box.className = "spotpatch-selection-highlight";
      box.dataset.targetId = target.id;
      box.dataset.entering = String(!previousHighlightIds.has(target.id));
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
    contextualAskPanel?.setSelectionPreview({
      contextReady: currentTargets.every((target) => target.status !== "loading"),
      targetCount: currentTargets.length,
      sourceCount: currentTargets.filter((target) => target.canOpenEditor).length,
    });
    updateContextOverview(summaryText);
    requestFloatingSurfaceLayout();
  }

  function renderPanelStatus(status: RuntimeStatus): void {
    currentStatus = status;
    const selected = status === "selected";
    const previewing = status === "previewing";
    selectionPanel.hidden = !selected;
    previewPanel.hidden = !previewing;
    reselectButton.hidden = !selected;
    addTargetButton.hidden = !selected;
    openEditorButton.hidden = !selected;
    previewButton.hidden = !selected;
    secondaryActions.hidden = !selected;
    agentPanel.setSelectionVisible(selected);
    externalHandoffPanel?.setSelectionVisible(selected);
    contextualAskPanel?.setSelectionVisible(selected);
    copyButton.hidden = !previewing;
    backButton.hidden = !previewing;
    title.textContent = previewing
      ? messages.dialog.previewTitle
      : contextualAskMode === "ask" && contextualAskTitle.length > 0
        ? contextualAskTitle
        : messages.dialog.editTitle;
    subtitle.textContent = previewing
      ? messages.dialog.previewSubtitle
      : contextualAskMode === "ask" && contextualAskSubtitle.length > 0
        ? contextualAskSubtitle
        : messages.dialog.editSubtitle;
    renderFloatingSurfaceMotion();
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
  const onAgentRun = (): void => {
    stageAgentRequest(agentPanel.runButton, agentPanel.root);
  };
  const onExternalSend = (): void => {
    if (externalHandoffPanel !== undefined) {
      stageAgentRequest(externalHandoffPanel.sendButton, externalHandoffPanel.root);
    }
  };
  const onExecutionOpen = (): void => {
    if (executionIslandView.canExpand() && !executionIslandView.isExpanded()) {
      if (motionController === undefined) {
        executionIslandView.setExpanded(true);
        floatingSurface.reconcile();
      } else {
        motionController.updateLayout(() => {
          executionIslandView.setExpanded(true);
        });
      }
      return;
    }
    clearSuccessSettle(false);
    executionSuppressed = true;
    renderFloatingSurfaceMotion();
  };
  const onExecutionKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !executionIslandView.isExpanded()) return;
    event.preventDefault();
    event.stopPropagation();
    if (motionController === undefined) {
      executionIslandView.setExpanded(false);
      floatingSurface.reconcile();
    } else {
      motionController.updateLayout(() => {
        executionIslandView.setExpanded(false);
      });
    }
  };
  agentPanel.runButton.addEventListener("click", onAgentRun);
  externalHandoffPanel?.sendButton.addEventListener("click", onExternalSend);
  executionIsland.addEventListener("click", onExecutionOpen);
  executionIsland.addEventListener("keydown", onExecutionKeyDown);
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
    ...(contextualAskPanel === undefined ? {} : { contextualAskPanel }),

    renderStatus(status: RuntimeStatus): void {
      const inspecting = status === "inspecting";
      if (status === "idle" || inspecting) {
        plannerVisible = false;
      } else {
        plannerVisible = true;
      }
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
      plannerVisible = true;
      renderPanelStatus(currentStatus === "previewing" ? "previewing" : "selected");
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
      plannerVisible = false;
      executionSuppressed = false;
      executionProjection = undefined;
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
      contextualAskPanel?.setSelectionVisible(false);
      agentPanel.setEditingEnabled(true);
      agentPanel.resetJob();
      dataFlowPanel.resetView();
      renderFloatingSurfaceMotion();
    },

    hideSelectionTemporarily(): void {
      plannerVisible = false;
      executionSuppressed = false;
      executionProjection = undefined;
      renderFloatingSurfaceMotion();
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
      if (state === "error") {
        pendingAgentMotion = undefined;
        renderFloatingSurfaceMotion();
      }
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
      if (state === "blocked") {
        pendingAgentMotion = undefined;
        renderFloatingSurfaceMotion();
      }
      requestFloatingSurfaceLayout();
    },

    renderAgentJob(
      snapshot: AgentJobSnapshot,
      result: AgentJobResult | undefined,
      activities: readonly AgentActivityItem[],
      errorCode?: ErrorCode,
    ): void {
      agentPanel.renderJob(snapshot, result, activities, errorCode);
      if (
        pendingAgentMotion !== undefined &&
        snapshot.status !== "failed" &&
        snapshot.status !== "cancelled"
      ) {
        startStagedAgentRequest();
      }
      if (snapshot.status === "failed" || snapshot.status === "cancelled") {
        pendingAgentMotion = undefined;
      }
      const successful =
        snapshot.status === "awaiting-review" ||
        snapshot.status === "applied" ||
        snapshot.status === "completed" ||
        snapshot.status === "reverted";
      const failed = snapshot.status === "failed";
      const cancelled = snapshot.status === "cancelled";
      const terminalSuccess =
        snapshot.status === "applied" ||
        snapshot.status === "completed" ||
        snapshot.status === "reverted";
      const scene: FloatingSurfaceScene = successful
        ? "success"
        : failed
          ? "failed"
          : snapshot.status === "queued" || snapshot.status === "preparing"
            ? "handoff"
            : "running";
      if (!executionSuppressed) {
        if (
          terminalSuccess &&
          !showSuccessUntilSettled(`job:${snapshot.jobId}:${snapshot.status}`)
        ) {
          executionProjection = undefined;
          renderFloatingSurfaceMotion();
          requestFloatingSurfaceLayout();
          return;
        }
        const identity = snapshot.providerLabel;
        const target = currentTargetSummary();
        const projectedActivities = Object.freeze(activities.map(projectAgentActivity));
        const latestActivity = activities.at(-1);
        const phaseKind: ExecutionActivityKind =
          snapshot.status === "queued" || snapshot.status === "preparing"
            ? "prepare"
            : snapshot.status === "validating"
              ? "check"
              : snapshot.status === "applying" || snapshot.status === "reverting"
                ? "apply"
                : snapshot.status === "awaiting-review" || successful
                  ? "sync"
                  : "unknown";
        const phaseActivity = motionActivity(
          `job-phase:${snapshot.jobId}:${snapshot.status}:${snapshot.updatedAt}`,
          phaseKind,
          undefined,
          successful ? "success" : failed ? "failure" : "active",
        );
        const activity =
          snapshot.status === "running" && latestActivity !== undefined
            ? projectAgentActivity(latestActivity)
            : phaseActivity;
        executionProjection = cancelled
          ? undefined
          : {
              scene,
              tone: successful ? "success" : failed ? "danger" : "running",
              headline: successful
                ? messages.execution.completedTitle
                : failed
                  ? messages.execution.failedTitle
                  : scene === "handoff"
                    ? messages.execution.dispatchingTitle(identity)
                    : snapshot.status === "validating"
                      ? messages.execution.activityAction(
                          "check",
                          latestActivity?.detail,
                        )
                      : snapshot.status === "applying" ||
                          snapshot.status === "reverting"
                        ? messages.execution.activityAction(phaseKind)
                        : messages.execution.runningTitle(target.label),
              action: successful
                ? result === undefined || result.files.length === 0
                  ? messages.execution.resultReturned
                  : messages.execution.resultSummary(result.files.length)
                : (latestActivity?.detail ?? target.source),
              expandedHeadline: successful
                ? messages.execution.expandedCompletedTitle
                : failed
                  ? messages.execution.failedTitle
                  : scene === "handoff"
                    ? messages.execution.dispatchingTitle(identity)
                    : messages.execution.expandedRunningTitle(identity),
              expandedAction: successful
                ? result === undefined || result.files.length === 0
                  ? messages.execution.resultReturned
                  : messages.execution.resultSummary(result.files.length)
                : currentTargetContext(),
              meta: successful
                ? messages.execution.completedStatus
                : failed
                  ? messages.execution.failedStatus
                  : snapshot.status === "validating"
                    ? messages.execution.checkingStatus
                    : scene === "handoff"
                      ? messages.execution.dispatchingStatus
                      : messages.execution.runningStatus,
              activity,
              recentActivities:
                projectedActivities.length === 0
                  ? Object.freeze([phaseActivity])
                  : projectedActivities,
              startedAt: snapshot.createdAt,
            };
      }
      renderFloatingSurfaceMotion();
      requestFloatingSurfaceLayout();
    },

    resetAgentJob(): void {
      agentPanel.resetJob();
      observedExecutionStartedAt = undefined;
      if (executionProjection !== undefined) {
        executionProjection = undefined;
        executionSuppressed = false;
        renderFloatingSurfaceMotion();
      }
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
      agentPanel.runButton.removeEventListener("click", onAgentRun);
      externalHandoffPanel?.sendButton.removeEventListener("click", onExternalSend);
      executionIsland.removeEventListener("click", onExecutionOpen);
      executionIsland.removeEventListener("keydown", onExecutionKeyDown);
      unsubscribeLocale();
      dataFlowPanel.dispose();
      externalHandoffPanel?.dispose();
      contextualAskPanel?.dispose();
      agentPanel.dispose();
      motionController?.dispose();
      executionIslandView.dispose();
      clearSuccessSettle(true);
      floatingSurface.dispose();
      host.remove();
    },
  });
}
