import { createReact18Adapter, type ReactAdapter } from "@spotpatch/react-adapter";
import {
  MAX_ANNOTATION_INSTRUCTION_CHARACTERS,
  type CodeContext,
  type ElementContext,
  type SourceMarker,
  type SpotAnnotation,
  type SpotTargetContext,
  type StyleContext,
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
import {
  createRuntimeView,
  type RuntimeView,
  type SelectionHighlightView,
  type SelectionTargetView,
} from "../ui/runtime-view.js";
import {
  createSelectionSummary,
  type ApiConnectionStatus,
  type CollectionStatus,
} from "../ui/selection-summary.js";
import { createAgentWorkflow } from "./agent-workflow.js";
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

interface SelectedTarget {
  readonly id: string;
  readonly resolution: ElementSourceResolution;
  apiStatus: ApiConnectionStatus;
  code: CodeContext | undefined;
  collectionStatus: CollectionStatus;
  element: Element | undefined;
  elementContext: ElementContext | undefined;
  instruction: string;
  marker: SourceMarker | undefined;
  styles: StyleContext | undefined;
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

function sourceLabel(target: SelectedTarget, unavailable: string): string {
  const path = target.code?.relativePath ?? target.resolution.source.relativePath;
  const line = target.resolution.source.line;
  const column = target.resolution.source.column;

  if (path === undefined) {
    return unavailable;
  }

  return `${path}${line === undefined ? "" : `:${String(line)}`}${column === undefined ? "" : `:${String(column)}`}`;
}

function targetStatus(target: SelectedTarget): SelectionTargetView["status"] {
  if (target.apiStatus === "failed" || target.collectionStatus === "failed") {
    return "warning";
  }

  if (target.apiStatus === "loading" || target.collectionStatus === "loading") {
    return "loading";
  }

  return "ready";
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
    dependencies.view ??
    createRuntimeView(browser.document, config.shortcut, config.ai, config.locale);
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
      view.announce(view.messages().announcements.adapterDisabled);

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
  let targets: SelectedTarget[] = [];
  let activeTargetId: string | undefined;
  let targetSequence = 0;
  let sessionRevision = 0;
  let addingTarget = false;
  let previewPrompt = "";
  let previousFocus: HTMLElement | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let mutationObserver: MutationObserver | undefined;
  let unsubscribeLocale: (() => void) | undefined;
  const collectionTimers = new Map<string, number>();

  function transition(event: RuntimeEvent): void {
    state = reduceRuntimeState(state, event);
    view.renderStatus(state.status);
  }

  function activeTarget(): SelectedTarget | undefined {
    return targets.find((target) => target.id === activeTargetId) ?? targets.at(-1);
  }

  function targetIsCurrent(target: SelectedTarget, revision: number): boolean {
    return (
      mounted &&
      revision === sessionRevision &&
      state.status !== "idle" &&
      targets.includes(target)
    );
  }

  function canPreview(): boolean {
    const instructionCharacters = targets.reduce(
      (total, target) => total + target.instruction.trim().length,
      0,
    );

    return (
      targets.length > 0 &&
      instructionCharacters <= MAX_ANNOTATION_INSTRUCTION_CHARACTERS &&
      targets.every(
        (target) =>
          target.instruction.trim().length > 0 &&
          target.element !== undefined &&
          target.elementContext !== undefined &&
          target.styles !== undefined &&
          target.apiStatus !== "loading",
      )
    );
  }

  function selectionSummary(): string {
    const messages = view.messages().summary;

    return targets
      .map((target, index) => {
        const summary = createSelectionSummary(
          {
            resolution: target.resolution,
            ...(target.code === undefined ? {} : { code: target.code }),
            ...(target.styles === undefined ? {} : { styles: target.styles }),
            apiStatus: target.apiStatus,
            collectionStatus: target.collectionStatus,
            spotPatchVersion: config.spotPatchVersion,
            viteVersion: config.viteVersion,
          },
          messages,
        );
        return `${messages.target(index + 1, target.id === activeTargetId)}\n${summary}`;
      })
      .join("\n\n");
  }

  function refreshHighlights(): void {
    const highlights = targets.flatMap((target): SelectionHighlightView[] => {
      if (!target.element?.isConnected) {
        return [];
      }

      return [
        {
          id: target.id,
          label: elementLabel(target.element),
          rect: getElementRect(target.element, browser.window),
          active: target.id === activeTargetId,
        },
      ];
    });

    if (highlights.length === 0) {
      view.hideSelectionHighlights();
    } else {
      view.showSelectionHighlights(highlights);
    }
  }

  function refreshSelectionView(show = false): void {
    if (targets.length === 0) {
      return;
    }

    view.renderTargets(
      targets.map((target) => ({
        id: target.id,
        label:
          target.resolution.react.componentName ??
          (target.element === undefined
            ? (target.elementContext?.tagName ?? "Element")
            : elementLabel(target.element)),
        source: sourceLabel(target, view.messages().context.sourceUnavailable),
        status: targetStatus(target),
        active: target.id === activeTargetId,
        instruction: target.instruction,
      })),
      config.maxTargets,
    );
    refreshHighlights();
    const current = activeTarget();
    const summary = selectionSummary();
    const canOpenEditor = current?.marker !== undefined;

    if (show) {
      view.showSelection(summary, canOpenEditor, canPreview());
    } else {
      view.updateSelection(summary, canOpenEditor, canPreview());
    }
  }

  function selectedAnnotation(): SpotAnnotation | undefined {
    if (!canPreview()) {
      return undefined;
    }

    const annotationTargets = targets.map((target): SpotTargetContext => {
      if (target.elementContext === undefined || target.styles === undefined) {
        throw new Error("SpotPatch attempted to compose an incomplete target.");
      }

      const warnings = [
        ...(target.apiStatus === "failed"
          ? ["Source context could not be loaded."]
          : []),
        ...(target.collectionStatus === "failed"
          ? ["Part of the browser context could not be collected."]
          : []),
      ];

      return {
        instruction: target.instruction.trim(),
        source: target.resolution.source,
        react: target.resolution.react,
        element: target.elementContext,
        styles: target.styles,
        ...(target.code === undefined ? {} : { code: target.code }),
        warnings,
      };
    });

    return createAnnotation({
      id: createId(),
      locale: view.locale(),
      createdAt: now(),
      page: collectPageContext(browser.document, browser.window),
      targets: annotationTargets,
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

  function clearCollectionTimers(): void {
    for (const timer of collectionTimers.values()) {
      browser.window.clearTimeout(timer);
    }

    collectionTimers.clear();
  }

  function releaseSelection(): void {
    sessionRevision += 1;
    api.cancelPending();
    agentWorkflow.disposeSelection();
    clearCollectionTimers();
    resizeObserver?.disconnect();
    targets = [];
    activeTargetId = undefined;
    addingTarget = false;
    previewPrompt = "";
    view.hideSelection();
    view.hideSelectionHighlights();
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

  function cancelAddTarget(): void {
    if (state.status !== "inspecting" || !addingTarget || targets.length === 0) {
      close();
      return;
    }

    addingTarget = false;
    transition({ type: "SELECT" });
    view.hideHighlight();
    refreshSelectionView(true);
    view.focusTargetInstruction(activeTargetId);
    view.announce(view.messages().announcements.addCancelled);
  }

  function activate(): void {
    if (state.status === "inspecting" && addingTarget) {
      cancelAddTarget();
      return;
    }

    if (state.status !== "idle") {
      close();
      return;
    }

    transition({ type: "ACTIVATE" });
    view.hideSelection();
    view.announce(view.messages().announcements.selectionEnabled);
  }

  function beginReselect(message = view.messages().announcements.chooseAnother): void {
    if (state.status !== "selected") {
      return;
    }

    transition({ type: "RESELECT" });
    releaseSelection();
    view.hideHighlight();
    view.announce(message);
  }

  function beginAddTarget(): void {
    if (state.status !== "selected") {
      return;
    }

    if (targets.length >= config.maxTargets) {
      view.announce(view.messages().announcements.selectionLimit(config.maxTargets));
      return;
    }

    addingTarget = true;
    transition({ type: "RESELECT" });
    view.hideSelectionTemporarily();
    view.hideHighlight();
    view.announce(
      view.messages().announcements.chooseAdditional(targets.length, config.maxTargets),
    );
  }

  function detachAppliedTargets(): void {
    sessionRevision += 1;
    clearCollectionTimers();
    resizeObserver?.disconnect();

    for (const target of targets) {
      target.element = undefined;
      target.marker = undefined;
    }

    view.hideHighlight();
    view.hideSelectionHighlights();
    refreshSelectionView();
    view.announce(view.messages().announcements.appliedTargetsDetached);
  }

  const agentWorkflow = createAgentWorkflow({
    ai: config.ai,
    api,
    getAnnotation: selectedAnnotation,
    onApplied: detachAppliedTargets,
    onReselectRequired() {
      beginReselect(view.messages().announcements.reselectAfterChange);
    },
    view,
  });

  async function loadSourceContext(
    target: SelectedTarget,
    revision: number,
  ): Promise<void> {
    const marker = target.marker;

    if (marker === undefined) {
      return;
    }

    try {
      const context = await api.sourceContext({
        fileId: marker.fileId,
        line: marker.line,
        column: marker.column,
        maxLines: config.budget.maxCodeLines,
      });

      if (targetIsCurrent(target, revision)) {
        target.code = context;
        target.apiStatus = "connected";
        refreshSelectionView();
        view.announce(view.messages().announcements.sourceLoaded);
      }
    } catch (error: unknown) {
      if (targetIsCurrent(target, revision)) {
        target.code = undefined;
        target.apiStatus = "failed";
        refreshSelectionView();
        view.announce(view.messages().announcements.sourceFailed);

        if (
          config.debug &&
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          console.warn("[spotpatch:runtime] Source context request failed.");
        }
      }
    }
  }

  function scheduleBrowserContextCollection(
    target: SelectedTarget,
    revision: number,
  ): void {
    const element = target.element;

    if (element === undefined) {
      return;
    }

    const timer = browser.window.setTimeout(() => {
      collectionTimers.delete(target.id);

      if (!targetIsCurrent(target, revision)) {
        return;
      }

      let failed = false;

      try {
        target.elementContext = collectElementContext({
          element,
          maxCharacters: config.budget.domCharacters,
        });
      } catch {
        target.elementContext = undefined;
        failed = true;
      }

      try {
        target.styles = collectStyleContext({
          document: browser.document,
          element,
          maxCharacters: config.budget.cssCharacters,
        });
      } catch {
        target.styles = EMPTY_STYLE_CONTEXT;
        failed = true;
      }

      target.collectionStatus = failed ? "failed" : "ready";
      refreshSelectionView();
      view.announce(
        failed
          ? view.messages().announcements.contextWarning
          : view.messages().announcements.contextCollected,
      );

      if (config.debug && target.styles.warnings.length > 0) {
        console.warn(
          `[spotpatch:runtime] CSS collection completed with ${String(target.styles.warnings.length)} warning(s).`,
        );
      }
    }, 0);
    collectionTimers.set(target.id, timer);
  }

  function duplicateTarget(
    element: Element,
    marker: SourceMarker | undefined,
  ): SelectedTarget | undefined {
    if (marker !== undefined) {
      return targets.find(
        (target) =>
          target.marker?.fileId === marker.fileId &&
          target.marker.line === marker.line &&
          target.marker.column === marker.column,
      );
    }

    return targets.find((target) => target.element === element);
  }

  function selectElement(element: Element): void {
    const resolution = sourceResolver.resolve(element);
    const marker = sourceRefToMarker(resolution.source);
    const duplicate = duplicateTarget(element, marker);

    if (duplicate !== undefined) {
      activeTargetId = duplicate.id;
      addingTarget = false;
      transition({ type: "SELECT" });
      view.hideHighlight();
      refreshSelectionView(true);
      view.focusTargetInstruction(duplicate.id);
      view.announce(view.messages().announcements.duplicate);
      return;
    }

    if (targets.length >= config.maxTargets) {
      addingTarget = false;
      transition({ type: "SELECT" });
      view.hideHighlight();
      refreshSelectionView(true);
      view.announce(view.messages().announcements.selectionLimit(config.maxTargets));
      return;
    }

    const initialSelection = targets.length === 0;

    if (initialSelection) {
      previousFocus =
        browser.document.activeElement instanceof HTMLElement
          ? browser.document.activeElement
          : undefined;
      previewPrompt = "";
      agentWorkflow.beginSelection();
    }

    targetSequence += 1;
    const target: SelectedTarget = {
      id: `target-${String(targetSequence)}`,
      element,
      resolution,
      marker,
      code: undefined,
      elementContext: undefined,
      styles: undefined,
      instruction: "",
      apiStatus: marker === undefined ? "not-required" : "loading",
      collectionStatus: "loading",
    };
    targets.push(target);
    activeTargetId = target.id;
    addingTarget = false;
    const revision = sessionRevision;
    transition({ type: "SELECT" });
    view.hideHighlight();
    resizeObserver?.observe(element);
    refreshSelectionView(true);
    view.focusTargetInstruction(target.id);
    scheduleBrowserContextCollection(target, revision);

    if (marker !== undefined) {
      void loadSourceContext(target, revision);
    } else {
      view.announce(
        resolution.source.confidence === "probable"
          ? view.messages().announcements.sourceProbable
          : view.messages().announcements.sourceMissing,
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
      view.announce(view.messages().announcements.noSelectable);
      return;
    }

    selectElement(candidate);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && state.status !== "idle") {
      event.preventDefault();

      if (state.status === "inspecting" && addingTarget) {
        cancelAddTarget();
      } else if (state.status === "inspecting" || state.status === "selected") {
        close();
      } else {
        transition({ type: "BACK" });
        view.focusTargetInstruction(activeTargetId);
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

  function removeTarget(targetId: string): void {
    if (state.status !== "selected" && state.status !== "inspecting") {
      return;
    }

    const index = targets.findIndex((target) => target.id === targetId);

    if (index < 0) {
      return;
    }

    const [removed] = targets.splice(index, 1);

    if (removed === undefined) {
      return;
    }

    const timer = collectionTimers.get(removed.id);

    if (timer !== undefined) {
      browser.window.clearTimeout(timer);
      collectionTimers.delete(removed.id);
    }

    if (removed.element !== undefined) {
      resizeObserver?.unobserve(removed.element);
    }

    if (activeTargetId === removed.id) {
      activeTargetId = targets.at(-1)?.id;
    }

    if (targets.length === 0) {
      addingTarget = true;

      if (state.status === "selected") {
        transition({ type: "RESELECT" });
      }

      view.hideSelectionTemporarily();
      view.hideSelectionHighlights();
      view.announce(view.messages().announcements.allTargetsRemoved);
      return;
    }

    refreshSelectionView();
    view.announce(view.messages().announcements.targetRemoved);
  }

  function refreshSelectedGeometry(): void {
    if (state.status === "idle" || targets.length === 0) {
      return;
    }

    const disconnected = targets.filter(
      (target) => target.element !== undefined && !target.element.isConnected,
    );

    if (disconnected.length > 0) {
      if (state.status === "previewing") {
        transition({ type: "BACK" });
      }

      for (const target of disconnected) {
        removeTarget(target.id);
      }

      if (targets.length > 0) {
        view.announce(view.messages().announcements.detachedTargetRemoved);
      }

      return;
    }

    refreshHighlights();
  }

  function handleOpenEditor(): void {
    const current = activeTarget();

    if (state.status !== "selected" || current?.marker === undefined) {
      return;
    }

    const marker = current.marker;
    transition({ type: "OPEN_EDITOR" });

    void api
      .openEditor({
        fileId: marker.fileId,
        line: marker.line,
        column: marker.column,
      })
      .then(() => {
        if (mounted && state.status === "selected") {
          view.announce(view.messages().announcements.editorOpened);
        }
      })
      .catch(() => {
        if (mounted && state.status === "selected") {
          view.announce(view.messages().announcements.editorFailed);
        }
      });
  }

  function handleTargetListInput(event: Event): void {
    if (state.status !== "selected" || !(event.target instanceof HTMLTextAreaElement)) {
      return;
    }

    const targetId = event.target.dataset.targetInstructionId;
    const target = targets.find((candidate) => candidate.id === targetId);

    if (target === undefined) {
      return;
    }

    target.instruction = event.target.value;
    view.updateTargetInstruction(target.id, target.instruction);
    view.setPreviewEnabled(canPreview());
  }

  function handleTargetListKeydown(event: KeyboardEvent): void {
    if (
      config.ai.enabled &&
      state.status === "selected" &&
      event.key === "Enter" &&
      (event.metaKey || event.ctrlKey)
    ) {
      event.preventDefault();
      agentWorkflow.run();
    }
  }

  function handlePreview(): void {
    if (state.status !== "selected") {
      return;
    }

    const annotation = selectedAnnotation();

    if (annotation === undefined) {
      view.announce(view.messages().announcements.completeInstructions);
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
      view.announce(view.messages().announcements.clipboardUnavailable);
      return;
    }

    const revision = sessionRevision;
    void clipboard
      .writeText(previewPrompt)
      .then(() => {
        if (mounted && revision === sessionRevision && state.status === "previewing") {
          transition({ type: "COPY_SUCCESS" });
          view.focusTargetInstruction(activeTargetId);
          view.announce(view.messages().announcements.promptCopied);
        }
      })
      .catch(() => {
        if (mounted && revision === sessionRevision && state.status === "previewing") {
          transition({ type: "COPY_FAILURE" });
          view.focusPrompt();
          view.announce(view.messages().announcements.copyFailed);
        }
      });
  }

  function handleBack(): void {
    if (state.status !== "previewing") {
      return;
    }

    transition({ type: "BACK" });
    view.focusTargetInstruction(activeTargetId);
  }

  function handleLocaleChange(): void {
    if (!mounted || targets.length === 0) {
      return;
    }

    refreshSelectionView();

    if (state.status === "previewing") {
      const annotation = selectedAnnotation();

      if (annotation !== undefined) {
        previewPrompt = promptComposer.compose(annotation);
        view.showPreview(previewPrompt);
      }
    }
  }

  function handleTargetListClick(event: MouseEvent): void {
    const eventTarget = event.target;

    if (!(eventTarget instanceof Element)) {
      return;
    }

    const removeButton = eventTarget.closest<HTMLButtonElement>(
      "button[data-remove-target-id]",
    );

    if (removeButton?.dataset.removeTargetId !== undefined) {
      removeTarget(removeButton.dataset.removeTargetId);
      return;
    }

    const activateButton = eventTarget.closest<HTMLButtonElement>(
      "button[data-activate-target-id]",
    );
    const targetId = activateButton?.dataset.activateTargetId;

    if (
      state.status !== "selected" ||
      targetId === undefined ||
      !targets.some((target) => target.id === targetId)
    ) {
      return;
    }

    activeTargetId = targetId;
    refreshSelectionView();
    view.focusTargetInstruction(targetId);
  }

  function handleReselect(): void {
    beginReselect();
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
    view.triggerButton.addEventListener("click", activate);
    view.addTargetButton.addEventListener("click", beginAddTarget);
    view.reselectButton.addEventListener("click", handleReselect);
    view.targetList.addEventListener("click", handleTargetListClick);
    view.targetList.addEventListener("input", handleTargetListInput);
    view.targetList.addEventListener("keydown", handleTargetListKeydown);
    view.openEditorButton.addEventListener("click", handleOpenEditor);
    view.previewButton.addEventListener("click", handlePreview);
    view.copyButton.addEventListener("click", handleCopy);
    view.backButton.addEventListener("click", handleBack);
    view.closeButton.addEventListener("click", close);
    view.agentProviderSelect.addEventListener(
      "change",
      agentWorkflow.providerOrModelChanged,
    );
    view.agentModelSelect.addEventListener(
      "change",
      agentWorkflow.providerOrModelChanged,
    );
    view.agentConsentCheckbox.addEventListener("change", agentWorkflow.consentChanged);
    view.agentTestButton.addEventListener("click", agentWorkflow.testCapability);
    view.agentRunButton.addEventListener("click", agentWorkflow.run);
    view.agentCancelButton.addEventListener("click", agentWorkflow.cancel);
    view.agentApplyButton.addEventListener("click", agentWorkflow.apply);
    view.agentRevertButton.addEventListener("click", agentWorkflow.revert);
    view.agentResetButton.addEventListener("click", agentWorkflow.reset);
    unsubscribeLocale = view.subscribeLocale(handleLocaleChange);

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
      unsubscribeLocale?.();
      unsubscribeLocale = undefined;
      view.dispose();
      api.cancelPending();
      api.dispose();
      agentWorkflow.disposeSelection();
      sourceResolver.dispose();
      return;
    }

    mounted = false;
    unsubscribeLocale?.();
    unsubscribeLocale = undefined;
    browser.document.removeEventListener("pointermove", handlePointerMove, true);
    browser.document.removeEventListener("click", handleClick, true);
    browser.document.removeEventListener("keydown", handleKeydown, true);
    browser.window.removeEventListener("scroll", refreshSelectedGeometry, true);
    browser.window.removeEventListener("resize", refreshSelectedGeometry);
    view.triggerButton.removeEventListener("click", activate);
    view.addTargetButton.removeEventListener("click", beginAddTarget);
    view.reselectButton.removeEventListener("click", handleReselect);
    view.targetList.removeEventListener("click", handleTargetListClick);
    view.targetList.removeEventListener("input", handleTargetListInput);
    view.targetList.removeEventListener("keydown", handleTargetListKeydown);
    view.openEditorButton.removeEventListener("click", handleOpenEditor);
    view.previewButton.removeEventListener("click", handlePreview);
    view.copyButton.removeEventListener("click", handleCopy);
    view.backButton.removeEventListener("click", handleBack);
    view.closeButton.removeEventListener("click", close);
    view.agentProviderSelect.removeEventListener(
      "change",
      agentWorkflow.providerOrModelChanged,
    );
    view.agentModelSelect.removeEventListener(
      "change",
      agentWorkflow.providerOrModelChanged,
    );
    view.agentConsentCheckbox.removeEventListener(
      "change",
      agentWorkflow.consentChanged,
    );
    view.agentTestButton.removeEventListener("click", agentWorkflow.testCapability);
    view.agentRunButton.removeEventListener("click", agentWorkflow.run);
    view.agentCancelButton.removeEventListener("click", agentWorkflow.cancel);
    view.agentApplyButton.removeEventListener("click", agentWorkflow.apply);
    view.agentRevertButton.removeEventListener("click", agentWorkflow.revert);
    view.agentResetButton.removeEventListener("click", agentWorkflow.reset);

    if (animationFrame !== undefined) {
      browser.window.cancelAnimationFrame(animationFrame);
      animationFrame = undefined;
    }

    clearCollectionTimers();
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    resizeObserver = undefined;
    mutationObserver = undefined;
    targets = [];
    activeTargetId = undefined;
    previewPrompt = "";
    lastPointer = undefined;
    previousFocus = undefined;
    api.cancelPending();
    api.dispose();
    agentWorkflow.disposeSelection();
    sourceResolver.dispose();
    view.dispose();
    state = INITIAL_RUNTIME_STATE;
  }

  return Object.freeze({ mount, dispose, getState: () => state });
}
