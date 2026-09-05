import type { SpotPatchLocale } from "@spotpatch/shared";
import type {
  AskAnswerResult,
  AskDraftOrigin,
  AskJobEvent,
  AskJobSnapshot,
  AskSourceReference,
  ContextualAskCapability,
  ErrorCode,
} from "@spotpatch/shared/contextual-ask-browser";
import type { SelectionSnapshotTarget } from "../state/selection-session.js";

import type { ContextualAskApi } from "../api/contextual-ask-api.js";
import type { ClipboardWriter } from "../controller/runtime-environment.js";
import type { FloatingSurfaceProjection } from "./motion-extension-contract.js";

export interface ContextualAskSelectionPreview {
  readonly contextReady: boolean;
  readonly targetCount: number;
  readonly sourceCount: number;
}

export interface ContextualAskSelectionDraft {
  readonly locale: SpotPatchLocale;
  readonly targets: readonly SelectionSnapshotTarget[];
}

export interface ContextualAskPanel {
  readonly cancelButton: HTMLButtonElement;
  readonly consentCheckbox: HTMLInputElement;
  readonly convertButton: HTMLButtonElement;
  readonly copyButton: HTMLButtonElement;
  readonly executorSelect: HTMLSelectElement;
  readonly newQuestionButton: HTMLButtonElement;
  readonly questionInput: HTMLTextAreaElement;
  readonly root: HTMLElement;
  readonly styles: HTMLStyleElement;
  readonly submitButton: HTMLButtonElement;
  readonly clear: () => void;
  readonly dispose: () => void;
  readonly focusQuestion: () => void;
  readonly mode: () => "ask" | "change";
  readonly notify: (
    event: "copied" | "copy-failed" | "converted" | "source-open-failed",
  ) => void;
  readonly readConsent: () => boolean;
  readonly readExecutorId: () => string | undefined;
  readonly readModel: () => string | undefined;
  readonly readQuestion: () => string;
  readonly renderAnswer: (result: AskAnswerResult, stale: boolean) => void;
  readonly renderCapability: (capability?: ContextualAskCapability) => void;
  readonly renderError: (code?: ErrorCode) => void;
  readonly renderEvent: (event: AskJobEvent) => void;
  readonly renderJob: (snapshot: AskJobSnapshot) => void;
  readonly selectedSourceId: (target: EventTarget | null) => string | undefined;
  readonly setBusy: (busy: boolean) => void;
  readonly setConsent: (granted: boolean) => void;
  readonly setMode: (mode: "ask" | "change") => void;
  readonly setOrigin: (origin?: AskDraftOrigin) => void;
  readonly setSelectionPreview: (preview: ContextualAskSelectionPreview) => void;
  readonly setSelectionVisible: (visible: boolean) => void;
  readonly sourceById: (sourceId: string) => AskSourceReference | undefined;
  readonly answerPlainText: () => string;
}

export interface ContextualAskWorkflow {
  readonly beginSelection: () => void;
  readonly cancelPending: () => void;
  readonly dispose: () => void;
  readonly isBusy: () => boolean;
  readonly mount: () => void;
  readonly selectionChanged: () => void;
}

export interface ContextualAskExtension {
  readonly createPanel: (
    input: Readonly<{
      document: Document;
      locale: () => SpotPatchLocale;
      subscribeLocale: (listener: () => void) => () => void;
      changeRoot: HTMLElement;
      changeActions: HTMLElement;
      announce: (message: string) => void;
      onModeChange: (mode: "ask" | "change", title: string, subtitle: string) => void;
      onExecutionChange: (projection?: FloatingSurfaceProjection) => void;
      onViewChange: () => void;
    }>,
  ) => ContextualAskPanel;
  readonly createWorkflow: (
    input: Readonly<{
      api?: ContextualAskApi;
      clipboard?: ClipboardWriter;
      createId: () => string;
      fetch: typeof globalThis.fetch;
      getSelection: () => ContextualAskSelectionDraft | undefined;
      onConvert: (origin: AskDraftOrigin) => void;
      onBusyChange: (busy: boolean) => void;
      onOpenSource: (source: AskSourceReference) => Promise<void>;
      panel: ContextualAskPanel;
      sessionToken: string;
    }>,
  ) => ContextualAskWorkflow;
}

const CONTEXTUAL_ASK_EXTENSION_KEY = Symbol.for("spotpatch.contextual-ask.v1");
type ExtensionStore = Partial<Record<symbol, ContextualAskExtension>>;

export function registerContextualAskExtension(
  extension: ContextualAskExtension,
): void {
  (globalThis as ExtensionStore)[CONTEXTUAL_ASK_EXTENSION_KEY] = extension;
}

export function getContextualAskExtension(): ContextualAskExtension | undefined {
  return (globalThis as ExtensionStore)[CONTEXTUAL_ASK_EXTENSION_KEY];
}
