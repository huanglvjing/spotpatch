import { createReact18Adapter, type ReactAdapter } from "@spotpatch/react-adapter";
import type {
  CodeContext,
  ElementContext,
  SourceMarker,
  SpotAnnotation,
  StyleContext,
} from "@spotpatch/shared";

import { createAnnotation } from "../annotation/create-annotation.js";
import { createRuntimeApi, type RuntimeApi } from "../api/runtime-api.js";
import { collectStyleContext } from "../collectors/css-collector.js";
import { collectElementContext } from "../collectors/dom-collector.js";
import { isTextEntryTarget, matchesShortcut } from "../keyboard/shortcut.js";
import { getElementRect } from "../picker/geometry.js";
import { isSpotPatchUIEventTarget, pickElementAt } from "../picker/hit-test.js";
import {
  createPromptComposer,
  type PromptComposer,
} from "../prompt/prompt-composer.js";
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
import {
  createSelectionSummary,
  type ApiConnectionStatus,
  type CollectionStatus,
} from "../ui/selection-summary.js";
import {
  collectPageContext,
  createBrowserAnnotationId,
  resolveClipboardWriter,
  type ClipboardWriter,
} from "./runtime-environment.js";
import type { RuntimeConfig } from "./runtime-config.js";

export interface SpotPatchController {
  readonly dispose: () => void;
  readonly getState: () => RuntimeState;
  readonly mount: () => void;
}

export interface RuntimeControllerDependencies {
  readonly api?: RuntimeApi;
  readonly clipboard?: ClipboardWriter;
  readonly createId?: () => string;
  readonly document?: Document;
  readonly mutationObserver?: typeof MutationObserver;
  readonly now?: () => string;
  readonly promptComposer?: PromptComposer;
  readonly reactAdapter?: ReactAdapter;
  readonly resizeObserver?: typeof ResizeObserver;
  readonly view?: RuntimeView;
  readonly window?: Window;
}

interface PointerPosition {
  readonly x: number;
  readonly y: number;
}

const EMPTY_STYLE_CONTEXT = Object.freeze({
  classNames: Object.freeze([]),
  matchedRules: Object.freeze([]),
  computed: Object.freeze({}),
  warnings: Object.freeze(["CSS context collection failed."]),
}) satisfies StyleContext;

function elementLabel(element: Element): string {
  const id = element.id.length > 0 ? `#${element.id}` : "";
  const className = Array.from(element.classList)
    .slice(0, 2)
    .map((name) => `.${name}`)
    .join("");
  return `<${element.tagName.toLowerCase()}${id}${className}>`;
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
  const promptComposer =
    dependencies.promptComposer ??
    createPromptComposer({ maxCharacters: config.budget.totalCharacters });
  const clipboard =
    dependencies.clipboard ?? resolveClipboardWriter(browser.window.navigator);
  const createId =
    dependencies.createId ?? (() => createBrowserAnnotationId(browser.window));
  const now = dependencies.now ?? (() => new Date().toISOString());
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
  let collectionTimer: number | undefined;
  let lastPointer: PointerPosition | undefined;
  let selectedElement: Element | undefined;
  let selectedElementContext: ElementContext | undefined;
  let selectedMarker: SourceMarker | undefined;
  let selectedResolution: ElementSourceResolution | undefined;
  let selectedStyleContext: StyleContext | undefined;
  let selectedCodeContext: CodeContext | undefined;
  let apiConnectionStatus: ApiConnectionStatus = "not-required";
  let collectionStatus: CollectionStatus = "loading";
  let annotationNote = "";
  let previewPrompt = "";
  let selectionRevision = 0;
  let previousFocus: HTMLElement | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let mutationObserver: MutationObserver | undefined;

  function transition(event: RuntimeEvent): void {
    state = reduceRuntimeState(state, event);
    view.renderStatus(state.status);
  }

  function canPreview(): boolean {
    return (
      annotationNote.trim().length > 0 &&
      selectedElementContext !== undefined &&
      selectedStyleContext !== undefined &&
      apiConnectionStatus !== "loading"
    );
  }

  function hasActiveSelection(): boolean {
    return state.status === "selected" || state.status === "previewing";
  }

  function refreshSelectionView(): void {
    if (selectedResolution === undefined) {
      return;
    }

    view.updateSelection(
      createSelectionSummary({
        resolution: selectedResolution,
        ...(selectedCodeContext === undefined ? {} : { code: selectedCodeContext }),
        ...(selectedStyleContext === undefined ? {} : { styles: selectedStyleContext }),
        apiStatus: apiConnectionStatus,
        collectionStatus,
        spotPatchVersion: config.spotPatchVersion,
        viteVersion: config.viteVersion,
      }),
      selectedMarker !== undefined,
      canPreview(),
    );
  }

  function selectedAnnotation(): SpotAnnotation | undefined {
    if (
      selectedResolution === undefined ||
      selectedElementContext === undefined ||
      selectedStyleContext === undefined ||
      !canPreview()
    ) {
      return undefined;
    }

    const warnings = [
      ...(apiConnectionStatus === "failed"
        ? ["Source context could not be loaded."]
        : []),
      ...(collectionStatus === "failed"
        ? ["Part of the browser context could not be collected."]
        : []),
    ];

    return createAnnotation({
      id: createId(),
      note: annotationNote.trim(),
      createdAt: now(),
      page: collectPageContext(browser.document, browser.window),
      source: selectedResolution.source,
      react: selectedResolution.react,
      element: selectedElementContext,
      styles: selectedStyleContext,
      ...(selectedCodeContext === undefined ? {} : { code: selectedCodeContext }),
      warnings,
    });
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
    if (collectionTimer !== undefined) {
      browser.window.clearTimeout(collectionTimer);
      collectionTimer = undefined;
    }
    resizeObserver?.disconnect();
    selectedElement = undefined;
    selectedElementContext = undefined;
    selectedMarker = undefined;
    selectedResolution = undefined;
    selectedStyleContext = undefined;
    selectedCodeContext = undefined;
    apiConnectionStatus = "not-required";
    collectionStatus = "loading";
    annotationNote = "";
    previewPrompt = "";
    view.hideSelection();
    restoreFocus();
  }

  function close(): void {
    if (state.status === "inspecting") {
      transition({ type: "CANCEL" });
    } else if (state.status === "selected") {
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

      if (mounted && revision === selectionRevision && hasActiveSelection()) {
        selectedCodeContext = context;
        apiConnectionStatus = "connected";
        refreshSelectionView();
        view.announce("Source context loaded.");
      }
    } catch (error: unknown) {
      if (mounted && revision === selectionRevision && hasActiveSelection()) {
        selectedCodeContext = undefined;
        apiConnectionStatus = "failed";
        refreshSelectionView();
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

  function scheduleBrowserContextCollection(element: Element, revision: number): void {
    collectionTimer = browser.window.setTimeout(() => {
      collectionTimer = undefined;

      if (!mounted || revision !== selectionRevision || !hasActiveSelection()) {
        return;
      }

      let failed = false;

      try {
        selectedElementContext = collectElementContext({
          element,
          maxCharacters: config.budget.domCharacters,
        });
      } catch {
        selectedElementContext = undefined;
        failed = true;
      }

      try {
        selectedStyleContext = collectStyleContext({
          document: browser.document,
          element,
          maxCharacters: config.budget.cssCharacters,
        });
      } catch {
        selectedStyleContext = EMPTY_STYLE_CONTEXT;
        failed = true;
      }

      collectionStatus = failed ? "failed" : "ready";
      refreshSelectionView();
      view.announce(
        failed
          ? "Browser context collection completed with a warning."
          : "Browser context collected.",
      );

      if (config.debug && selectedStyleContext.warnings.length > 0) {
        console.warn(
          `[spotpatch:runtime] CSS collection completed with ${String(selectedStyleContext.warnings.length)} warning(s).`,
        );
      }
    }, 0);
  }

  function selectElement(element: Element): void {
    previousFocus =
      browser.document.activeElement instanceof HTMLElement
        ? browser.document.activeElement
        : undefined;
    selectedElement = element;
    selectedElementContext = undefined;
    selectedResolution = sourceResolver.resolve(element);
    selectedMarker = sourceRefToMarker(selectedResolution.source);
    selectedStyleContext = undefined;
    selectedCodeContext = undefined;
    apiConnectionStatus = selectedMarker === undefined ? "not-required" : "loading";
    collectionStatus = "loading";
    annotationNote = "";
    previewPrompt = "";
    selectionRevision += 1;
    const revision = selectionRevision;
    transition({ type: "SELECT" });
    showElementHighlight(element);
    view.showSelection(
      createSelectionSummary({
        resolution: selectedResolution,
        apiStatus: apiConnectionStatus,
        collectionStatus,
        spotPatchVersion: config.spotPatchVersion,
        viteVersion: config.viteVersion,
      }),
      selectedMarker !== undefined,
      false,
    );
    view.focusNote();
    resizeObserver?.disconnect();
    resizeObserver?.observe(element);
    scheduleBrowserContextCollection(element, revision);

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
      } else {
        transition({ type: "BACK" });
        view.focusNote();
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
    if (selectedElement === undefined || !hasActiveSelection()) {
      return;
    }

    if (!selectedElement.isConnected) {
      if (state.status === "previewing") {
        transition({ type: "BACK" });
      }

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

  function handleNoteInput(): void {
    if (state.status !== "selected") {
      return;
    }

    annotationNote = view.readNote();
    view.setPreviewEnabled(canPreview());
  }

  function handlePreview(): void {
    if (state.status !== "selected") {
      return;
    }

    const annotation = selectedAnnotation();

    if (annotation === undefined) {
      view.announce("Complete the problem description and context collection first.");
      return;
    }

    previewPrompt = promptComposer.compose(annotation);
    transition({ type: "PREVIEW" });
    view.showPreview(previewPrompt);
    view.focusPrompt();
  }

  function handleCopy(): void {
    if (state.status !== "previewing" || previewPrompt.length === 0) {
      return;
    }

    if (clipboard === undefined) {
      transition({ type: "COPY_FAILURE" });
      view.focusPrompt();
      view.announce("Clipboard access is unavailable. Select the prompt manually.");
      return;
    }

    const revision = selectionRevision;
    void clipboard
      .writeText(previewPrompt)
      .then(() => {
        if (
          mounted &&
          revision === selectionRevision &&
          state.status === "previewing"
        ) {
          transition({ type: "COPY_SUCCESS" });
          view.focusNote();
          view.announce("Prompt copied to the clipboard.");
        }
      })
      .catch(() => {
        if (
          mounted &&
          revision === selectionRevision &&
          state.status === "previewing"
        ) {
          transition({ type: "COPY_FAILURE" });
          view.focusPrompt();
          view.announce("Copy failed. Select the prompt manually.");
        }
      });
  }

  function handleBack(): void {
    if (state.status !== "previewing") {
      return;
    }

    transition({ type: "BACK" });
    view.focusNote();
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
    view.noteInput.addEventListener("input", handleNoteInput);
    view.previewButton.addEventListener("click", handlePreview);
    view.copyButton.addEventListener("click", handleCopy);
    view.backButton.addEventListener("click", handleBack);
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
    view.noteInput.removeEventListener("input", handleNoteInput);
    view.previewButton.removeEventListener("click", handlePreview);
    view.copyButton.removeEventListener("click", handleCopy);
    view.backButton.removeEventListener("click", handleBack);
    view.closeButton.removeEventListener("click", handleClose);

    if (animationFrame !== undefined) {
      browser.window.cancelAnimationFrame(animationFrame);
      animationFrame = undefined;
    }

    if (collectionTimer !== undefined) {
      browser.window.clearTimeout(collectionTimer);
      collectionTimer = undefined;
    }

    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    resizeObserver = undefined;
    mutationObserver = undefined;
    selectedElement = undefined;
    selectedElementContext = undefined;
    selectedMarker = undefined;
    selectedResolution = undefined;
    selectedStyleContext = undefined;
    selectedCodeContext = undefined;
    annotationNote = "";
    previewPrompt = "";
    lastPointer = undefined;
    previousFocus = undefined;
    api.dispose();
    sourceResolver.dispose();
    view.dispose();
    state = INITIAL_RUNTIME_STATE;
  }

  return Object.freeze({ mount, dispose, getState: () => state });
}
