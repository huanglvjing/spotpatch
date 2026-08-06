import { createReact18Adapter, type ReactAdapter } from "@spotpatch/react-adapter";
import type { CodeContext, SourceConfidence, SourceMarker } from "@spotpatch/shared";

import { createRuntimeApi, type RuntimeApi } from "../api/runtime-api.js";
import { isTextEntryTarget, matchesShortcut } from "../keyboard/shortcut.js";
import { getElementRect } from "../picker/geometry.js";
import { isSpotPatchUIEventTarget, pickElementAt } from "../picker/hit-test.js";
import {
  INITIAL_RUNTIME_STATE,
  reduceRuntimeState,
  type RuntimeEvent,
  type RuntimeState,
} from "../state/runtime-state.js";
import {
  createSourceResolver,
  sourceRefToMarker,
  type ElementSourceResolution,
} from "../source/source-resolver.js";
import { createRuntimeView, type RuntimeView } from "../ui/runtime-view.js";
import type { RuntimeConfig } from "./runtime-config.js";

export interface SpotPatchController {
  readonly dispose: () => void;
  readonly getState: () => RuntimeState;
  readonly mount: () => void;
}

export interface RuntimeControllerDependencies {
  readonly api?: RuntimeApi;
  readonly document?: Document;
  readonly mutationObserver?: typeof MutationObserver;
  readonly reactAdapter?: ReactAdapter;
  readonly resizeObserver?: typeof ResizeObserver;
  readonly view?: RuntimeView;
  readonly window?: Window;
}

interface PointerPosition {
  readonly x: number;
  readonly y: number;
}

function elementLabel(element: Element): string {
  const id = element.id.length > 0 ? `#${element.id}` : "";
  const className = Array.from(element.classList)
    .slice(0, 2)
    .map((name) => `.${name}`)
    .join("");
  return `<${element.tagName.toLowerCase()}${id}${className}>`;
}

const CONFIDENCE_LABELS = Object.freeze({
  exact: "精确元素源码",
  probable: "可能的所属组件",
  approximate: "最近业务容器",
  unknown: "未找到源码",
} satisfies Record<SourceConfidence, string>);

function sourceLocation(
  resolution: ElementSourceResolution,
  context: CodeContext | undefined,
): string {
  const path = context?.relativePath ?? resolution.source.relativePath;
  const line = resolution.source.line;
  const column = resolution.source.column;

  if (path !== undefined && line !== undefined) {
    return `${path}:${String(line)}${column === undefined ? "" : `:${String(column)}`}`;
  }

  if (path !== undefined) {
    return path;
  }

  if (line !== undefined) {
    return `line ${String(line)}${column === undefined ? "" : `, column ${String(column)}`}`;
  }

  return "Unavailable";
}

function selectionSummary(
  resolution: ElementSourceResolution,
  context?: CodeContext,
  requestStatus?: "loading" | "failed",
): string {
  const lines = [
    `Source: ${sourceLocation(resolution, context)}`,
    `Confidence: ${resolution.source.confidence} (${CONFIDENCE_LABELS[resolution.source.confidence]})`,
    `Origin: ${resolution.source.origin}`,
  ];

  if (resolution.react.componentName !== undefined) {
    lines.push(`Component: ${resolution.react.componentName}`);
  }

  if (resolution.react.componentStack.length > 0) {
    lines.push(`Stack: ${resolution.react.componentStack.join(" > ")}`);
  }

  if (!resolution.react.supported && resolution.react.version !== undefined) {
    lines.push(`React ${resolution.react.version}: unsupported`);
  }

  if (context !== undefined) {
    lines.push(`Boundary: ${context.boundary}`);
  } else if (requestStatus === "loading") {
    lines.push("Source context: loading…");
  } else if (requestStatus === "failed") {
    lines.push("Source context: unavailable");
  }

  return lines.join("\n");
}

function resolveBrowserDependencies(
  dependencies: RuntimeControllerDependencies,
): Readonly<{
  document: Document;
  mutationObserver: typeof MutationObserver | undefined;
  resizeObserver: typeof ResizeObserver | undefined;
  window: Window;
}> {
  const documentTarget = dependencies.document ?? globalThis.document;
  const windowTarget = dependencies.window ?? globalThis.window;

  return {
    document: documentTarget,
    window: windowTarget,
    mutationObserver: dependencies.mutationObserver ?? globalThis.MutationObserver,
    resizeObserver: dependencies.resizeObserver ?? globalThis.ResizeObserver,
  };
}

export function createController(
  config: RuntimeConfig,
  dependencies: RuntimeControllerDependencies = {},
): SpotPatchController {
  const browser = resolveBrowserDependencies(dependencies);
  const view =
    dependencies.view ?? createRuntimeView(browser.document, config.shortcut);
  const api =
    dependencies.api ??
    createRuntimeApi({
      apiBase: config.apiBase,
      fetch: browser.window.fetch.bind(browser.window),
      sessionToken: config.sessionToken,
    });
  const sourceResolver = createSourceResolver({
    adapter:
      dependencies.reactAdapter ??
      createReact18Adapter({
        maxComponentDepth: config.budget.maxComponentDepth,
      }),
    onAdapterError() {
      view.announce("React inspection was disabled after an adapter failure.");

      if (config.debug) {
        console.warn(
          "[spotpatch:react] Adapter failed and was disabled for this session.",
        );
      }
    },
  });
  let state: RuntimeState = INITIAL_RUNTIME_STATE;
  let mounted = false;
  let animationFrame: number | undefined;
  let lastPointer: PointerPosition | undefined;
  let selectedElement: Element | undefined;
  let selectedMarker: SourceMarker | undefined;
  let selectedResolution: ElementSourceResolution | undefined;
  let selectionRevision = 0;
  let previousFocus: HTMLElement | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let mutationObserver: MutationObserver | undefined;

  function transition(event: RuntimeEvent): void {
    state = reduceRuntimeState(state, event);
    view.renderStatus(state.status);
  }

  function showElementHighlight(element: Element): void {
    view.showHighlight(getElementRect(element, browser.window), elementLabel(element));
  }

  function restoreFocus(): void {
    if (previousFocus?.isConnected === true) {
      previousFocus.focus({ preventScroll: true });
    }

    previousFocus = undefined;
  }

  function releaseSelection(): void {
    selectionRevision += 1;
    api.cancelPending();
    resizeObserver?.disconnect();
    selectedElement = undefined;
    selectedMarker = undefined;
    selectedResolution = undefined;
    view.hideSelection();
    restoreFocus();
  }

  function close(): void {
    if (state.status === "inspecting") {
      transition({ type: "CANCEL" });
    } else if (state.status === "selected") {
      transition({ type: "CLOSE" });
    } else if (state.status === "annotating") {
      transition({ type: "CANCEL_NOTE" });
      transition({ type: "CLOSE" });
    } else if (state.status === "previewing") {
      transition({ type: "BACK" });
      transition({ type: "CLOSE" });
    }

    releaseSelection();
    view.hideHighlight();
  }

  function activate(): void {
    if (state.status !== "idle") {
      close();
      return;
    }

    transition({ type: "ACTIVATE" });
    view.hideSelection();
    view.announce("Element selection enabled.");
  }

  function beginReselect(message = "Choose another element."): void {
    if (state.status !== "selected") {
      return;
    }

    transition({ type: "RESELECT" });
    releaseSelection();
    view.hideHighlight();
    view.announce(message);
  }

  async function loadSourceContext(
    marker: SourceMarker,
    revision: number,
  ): Promise<void> {
    try {
      const context = await api.sourceContext({
        fileId: marker.fileId,
        line: marker.line,
        column: marker.column,
        maxLines: config.budget.maxCodeLines,
      });

      if (mounted && revision === selectionRevision && state.status === "selected") {
        if (selectedResolution !== undefined) {
          view.updateSelection(selectionSummary(selectedResolution, context), true);
        }
        view.announce("Source context loaded.");
      }
    } catch (error: unknown) {
      if (mounted && revision === selectionRevision && state.status === "selected") {
        if (selectedResolution !== undefined) {
          view.updateSelection(
            selectionSummary(selectedResolution, undefined, "failed"),
            true,
          );
        }
        view.announce("Source context could not be loaded.");

        if (
          config.debug &&
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          console.warn("[spotpatch:runtime] Source context request failed.");
        }
      }
    }
  }

  function selectElement(element: Element): void {
    previousFocus =
      browser.document.activeElement instanceof HTMLElement
        ? browser.document.activeElement
        : undefined;
    selectedElement = element;
    selectedResolution = sourceResolver.resolve(element);
    selectedMarker = sourceRefToMarker(selectedResolution.source);
    selectionRevision += 1;
    const revision = selectionRevision;
    transition({ type: "SELECT" });
    showElementHighlight(element);
    view.showSelection(
      selectionSummary(
        selectedResolution,
        undefined,
        selectedMarker === undefined ? undefined : "loading",
      ),
      selectedMarker !== undefined,
    );
    view.focusDialog();
    resizeObserver?.disconnect();
    resizeObserver?.observe(element);

    if (selectedMarker !== undefined) {
      void loadSourceContext(selectedMarker, revision);
    } else {
      view.announce(
        selectedResolution.source.confidence === "probable"
          ? "A probable React component was found without an authorized file token."
          : "No authorized source marker was found for the selected element.",
      );
    }
  }

  function updateHoveredElement(): void {
    animationFrame = undefined;

    if (state.status !== "inspecting" || lastPointer === undefined) {
      return;
    }

    const candidate = pickElementAt(
      browser.document,
      browser.window,
      lastPointer.x,
      lastPointer.y,
    );
    transition({ type: "HOVER" });

    if (candidate === undefined) {
      view.hideHighlight();
      return;
    }

    showElementHighlight(candidate);
  }

  function handlePointerMove(event: PointerEvent): void {
    if (state.status !== "inspecting") {
      return;
    }

    lastPointer = { x: event.clientX, y: event.clientY };

    animationFrame ??= browser.window.requestAnimationFrame(updateHoveredElement);
  }

  function handleClick(event: MouseEvent): void {
    if (state.status !== "inspecting" || isSpotPatchUIEventTarget(event.target)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const candidate = pickElementAt(
      browser.document,
      browser.window,
      event.clientX,
      event.clientY,
    );

    if (candidate === undefined) {
      view.announce("No selectable element was found.");
      return;
    }

    selectElement(candidate);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && state.status !== "idle") {
      event.preventDefault();

      if (state.status === "inspecting" || state.status === "selected") {
        close();
      } else if (state.status === "annotating") {
        transition({ type: "CANCEL_NOTE" });
      } else {
        transition({ type: "BACK" });
      }

      return;
    }

    if (
      isTextEntryTarget(event.target) ||
      !matchesShortcut(event, config.shortcut, browser.window.navigator.userAgent)
    ) {
      return;
    }

    event.preventDefault();
    activate();
  }

  function refreshSelectedGeometry(): void {
    if (selectedElement === undefined || state.status !== "selected") {
      return;
    }

    if (!selectedElement.isConnected) {
      beginReselect("The selected element was removed. Choose another element.");
      return;
    }

    showElementHighlight(selectedElement);
  }

  function handleOpenEditor(): void {
    if (state.status !== "selected" || selectedMarker === undefined) {
      return;
    }

    const marker = selectedMarker;
    transition({ type: "OPEN_EDITOR" });

    void api
      .openEditor({
        fileId: marker.fileId,
        line: marker.line,
        column: marker.column,
      })
      .then(() => {
        if (mounted && state.status === "selected") {
          view.announce("VS Code open request sent.");
        }
      })
      .catch(() => {
        if (mounted && state.status === "selected") {
          view.announce("VS Code could not be opened.");
        }
      });
  }

  function handleTrigger(): void {
    activate();
  }

  function handleReselect(): void {
    beginReselect();
  }

  function handleClose(): void {
    close();
  }

  function mount(): void {
    if (mounted) {
      return;
    }

    mounted = true;
    view.renderStatus(state.status);
    browser.document.addEventListener("pointermove", handlePointerMove, true);
    browser.document.addEventListener("click", handleClick, true);
    browser.document.addEventListener("keydown", handleKeydown, true);
    browser.window.addEventListener("scroll", refreshSelectedGeometry, true);
    browser.window.addEventListener("resize", refreshSelectedGeometry);
    view.triggerButton.addEventListener("click", handleTrigger);
    view.reselectButton.addEventListener("click", handleReselect);
    view.openEditorButton.addEventListener("click", handleOpenEditor);
    view.closeButton.addEventListener("click", handleClose);

    if (browser.resizeObserver !== undefined) {
      resizeObserver = new browser.resizeObserver(refreshSelectedGeometry);
    }

    if (browser.mutationObserver !== undefined) {
      mutationObserver = new browser.mutationObserver(refreshSelectedGeometry);
      mutationObserver.observe(browser.document.documentElement, {
        childList: true,
        subtree: true,
      });
    }

    if (config.debug) {
      console.info(`[spotpatch:runtime] Mounted. Shortcut: ${config.shortcut}.`);
    }
  }

  function dispose(): void {
    if (!mounted) {
      view.dispose();
      api.dispose();
      sourceResolver.dispose();
      return;
    }

    mounted = false;
    browser.document.removeEventListener("pointermove", handlePointerMove, true);
    browser.document.removeEventListener("click", handleClick, true);
    browser.document.removeEventListener("keydown", handleKeydown, true);
    browser.window.removeEventListener("scroll", refreshSelectedGeometry, true);
    browser.window.removeEventListener("resize", refreshSelectedGeometry);
    view.triggerButton.removeEventListener("click", handleTrigger);
    view.reselectButton.removeEventListener("click", handleReselect);
    view.openEditorButton.removeEventListener("click", handleOpenEditor);
    view.closeButton.removeEventListener("click", handleClose);

    if (animationFrame !== undefined) {
      browser.window.cancelAnimationFrame(animationFrame);
      animationFrame = undefined;
    }

    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    resizeObserver = undefined;
    mutationObserver = undefined;
    selectedElement = undefined;
    selectedMarker = undefined;
    selectedResolution = undefined;
    lastPointer = undefined;
    previousFocus = undefined;
    api.dispose();
    sourceResolver.dispose();
    view.dispose();
    state = INITIAL_RUNTIME_STATE;
  }

  return Object.freeze({ mount, dispose, getState: () => state });
}
