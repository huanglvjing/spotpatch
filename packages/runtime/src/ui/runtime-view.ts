import type { ElementRect } from "../picker/geometry.js";
import type { RuntimeStatus } from "../state/runtime-state.js";
import { UI_MARKER_ATTRIBUTE, UI_Z_INDEX } from "./ui-constants.js";

export interface RuntimeView {
  readonly closeButton: HTMLButtonElement;
  readonly host: HTMLElement;
  readonly openEditorButton: HTMLButtonElement;
  readonly reselectButton: HTMLButtonElement;
  readonly triggerButton: HTMLButtonElement;
  readonly announce: (message: string) => void;
  readonly dispose: () => void;
  readonly focusDialog: () => void;
  readonly hideHighlight: () => void;
  readonly hideSelection: () => void;
  readonly renderStatus: (status: RuntimeStatus) => void;
  readonly showHighlight: (rect: ElementRect, label: string) => void;
  readonly showSelection: (summary: string, canOpenEditor: boolean) => void;
  readonly updateSelection: (summary: string, canOpenEditor: boolean) => void;
}

function createMarkedElement<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tagName: K,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.setAttribute(UI_MARKER_ATTRIBUTE, "");
  return element;
}

function createButton(document: Document, label: string): HTMLButtonElement {
  const button = createMarkedElement(document, "button");
  button.type = "button";
  button.textContent = label;
  return button;
}

function createStyles(document: Document): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = `
    :host {
      all: initial;
      color: #f8fafc;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      line-height: 1.45;
    }
    [hidden] { display: none !important; }
    .spotpatch-trigger {
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: ${String(UI_Z_INDEX.controls)};
      border: 1px solid rgb(148 163 184 / 35%);
      border-radius: 999px;
      padding: 9px 14px;
      color: #f8fafc;
      background: #111827;
      box-shadow: 0 10px 30px rgb(15 23 42 / 24%);
      cursor: pointer;
      font: inherit;
      font-weight: 650;
    }
    .spotpatch-trigger[aria-pressed="true"] { background: #4f46e5; }
    .spotpatch-highlight {
      position: fixed;
      z-index: ${String(UI_Z_INDEX.highlight)};
      box-sizing: border-box;
      border: 2px solid #6366f1;
      background: rgb(99 102 241 / 10%);
      pointer-events: none;
    }
    .spotpatch-highlight-label {
      position: absolute;
      top: -24px;
      left: -2px;
      max-width: min(360px, 80vw);
      overflow: hidden;
      border-radius: 5px 5px 5px 0;
      padding: 3px 7px;
      color: #fff;
      background: #4f46e5;
      font: 600 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spotpatch-dialog {
      position: fixed;
      right: 20px;
      bottom: 68px;
      z-index: ${String(UI_Z_INDEX.controls)};
      box-sizing: border-box;
      width: min(380px, calc(100vw - 32px));
      border: 1px solid rgb(148 163 184 / 24%);
      border-radius: 12px;
      padding: 16px;
      color: #e5e7eb;
      background: #111827;
      box-shadow: 0 18px 55px rgb(15 23 42 / 32%);
      outline: none;
    }
    .spotpatch-title { margin: 0; color: #fff; font-size: 15px; }
    .spotpatch-summary {
      margin: 10px 0 14px;
      overflow-wrap: anywhere;
      color: #cbd5e1;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      white-space: pre-wrap;
    }
    .spotpatch-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .spotpatch-actions button {
      border: 1px solid #475569;
      border-radius: 7px;
      padding: 6px 9px;
      color: #f8fafc;
      background: #1e293b;
      cursor: pointer;
      font: inherit;
    }
    .spotpatch-actions button:disabled { cursor: not-allowed; opacity: .5; }
    .spotpatch-actions button:focus-visible,
    .spotpatch-trigger:focus-visible { outline: 2px solid #a5b4fc; outline-offset: 2px; }
    .spotpatch-live {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `;
  return style;
}

export function createRuntimeView(document: Document, shortcut: string): RuntimeView {
  const host = document.createElement("spotpatch-root");
  host.setAttribute(UI_MARKER_ATTRIBUTE, "");
  const shadowRoot = host.attachShadow({ mode: "open" });
  const triggerButton = createButton(document, "Select element");
  triggerButton.className = "spotpatch-trigger";
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
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-labelledby", "spotpatch-selection-title");
  const title = createMarkedElement(document, "h2");
  title.id = "spotpatch-selection-title";
  title.className = "spotpatch-title";
  title.textContent = "Selected element";
  const summary = createMarkedElement(document, "pre");
  summary.className = "spotpatch-summary";
  const actions = createMarkedElement(document, "div");
  actions.className = "spotpatch-actions";
  const reselectButton = createButton(document, "Reselect");
  const openEditorButton = createButton(document, "Open in VS Code");
  const closeButton = createButton(document, "Close");
  actions.append(reselectButton, openEditorButton, closeButton);
  dialog.append(title, summary, actions);

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

  function updateSelection(summaryText: string, canOpenEditor: boolean): void {
    summary.textContent = summaryText;
    openEditorButton.disabled = !canOpenEditor;
  }

  return Object.freeze({
    host,
    triggerButton,
    reselectButton,
    openEditorButton,
    closeButton,

    renderStatus(status: RuntimeStatus): void {
      const inspecting = status === "inspecting";
      triggerButton.setAttribute("aria-pressed", String(inspecting));
      triggerButton.textContent = inspecting ? "Stop selecting" : "Select element";
    },

    showHighlight(rect: ElementRect, label: string): void {
      highlight.hidden = false;
      highlight.style.transform = `translate(${String(rect.x)}px, ${String(rect.y)}px)`;
      highlight.style.width = `${String(rect.width)}px`;
      highlight.style.height = `${String(rect.height)}px`;
      highlightLabel.textContent = label;
    },

    hideHighlight(): void {
      highlight.hidden = true;
      highlightLabel.textContent = "";
    },

    showSelection(summaryText: string, canOpenEditor: boolean): void {
      updateSelection(summaryText, canOpenEditor);
      dialog.hidden = false;
    },

    updateSelection,

    hideSelection(): void {
      dialog.hidden = true;
      summary.textContent = "";
      openEditorButton.disabled = true;
    },

    focusDialog(): void {
      dialog.focus({ preventScroll: true });
    },

    announce(message: string): void {
      liveRegion.textContent = "";
      liveRegion.textContent = message;
    },

    dispose(): void {
      host.remove();
    },
  });
}
