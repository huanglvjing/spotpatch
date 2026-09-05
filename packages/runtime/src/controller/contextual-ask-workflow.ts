import {
  CONTEXTUAL_ASK_SCHEMA_VERSION,
  type AskAnswerResult,
  type AskDraftOrigin,
  type AskJobEvent,
  type AskJobSnapshot,
  type SpotAskTaskEnvelope,
} from "@spotpatch/shared/contextual-ask-browser";

import {
  contextualAskApiErrorCode,
  createContextualAskApi,
} from "../api/contextual-ask-api.js";
import type {
  ContextualAskExtension,
  ContextualAskWorkflow,
} from "../ui/contextual-ask-contract.js";

type WorkflowInput = Parameters<ContextualAskExtension["createWorkflow"]>[0];

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function createContextualAskWorkflow(
  input: WorkflowInput,
): ContextualAskWorkflow {
  let mounted = false;
  let revision = 0;
  let busy = false;
  let currentSnapshot: AskJobSnapshot | undefined;
  let currentResult: AskAnswerResult | undefined;
  let currentQuestion = "";
  let capabilityLoaded = false;
  let composing = false;
  const consentByExecutor = new Map<string, boolean>();
  const api =
    input.api ??
    createContextualAskApi({
      fetch: input.fetch,
      sessionToken: input.sessionToken,
    });

  function isCurrent(requestRevision: number): boolean {
    return mounted && revision === requestRevision;
  }

  function createEnvelope(question: string): SpotAskTaskEnvelope | undefined {
    const selection = input.getSelection();
    if (question.length === 0 || question.length > 4_000 || selection === undefined) {
      return undefined;
    }
    const createdAt = new Date().toISOString();
    return {
      schemaVersion: CONTEXTUAL_ASK_SCHEMA_VERSION,
      taskId: input.createId(),
      selection: {
        schemaVersion: CONTEXTUAL_ASK_SCHEMA_VERSION,
        selectionId: input.createId(),
        locale: selection.locale,
        targets: selection.targets.map((snapshot) => ({
          targetId: snapshot.id,
          page: snapshot.page,
          source: snapshot.source,
          react: {
            ...snapshot.react,
            componentStack: [...snapshot.react.componentStack],
          },
          element: snapshot.element,
          styles: {
            ...snapshot.styles,
            classNames: [...snapshot.styles.classNames],
            matchedRules: snapshot.styles.matchedRules.map((rule) => ({ ...rule })),
            computed: { ...snapshot.styles.computed },
            warnings: [...snapshot.styles.warnings],
          },
          ...(snapshot.code === undefined ? {} : { code: snapshot.code }),
          warnings: [],
        })),
        createdAt,
      },
      task: { kind: "ask", question },
      createdAt,
    };
  }

  async function loadCapability(): Promise<void> {
    if (capabilityLoaded) return;
    const requestRevision = revision;
    input.panel.renderCapability(undefined);
    try {
      const capability = await api.capability();
      if (!isCurrent(requestRevision)) return;
      capabilityLoaded = true;
      input.panel.renderCapability(capability);
      const executorId = input.panel.readExecutorId();
      input.panel.setConsent(
        executorId !== undefined && consentByExecutor.get(executorId) === true,
      );
    } catch (error: unknown) {
      if (!isCurrent(requestRevision) || isAbortError(error)) return;
      input.panel.renderError(contextualAskApiErrorCode(error));
    }
  }

  function handleEvent(event: AskJobEvent, requestRevision: number): void {
    if (!isCurrent(requestRevision)) return;
    input.panel.renderEvent(event);
    if (event.type === "snapshot") currentSnapshot = event.snapshot;
  }

  async function submit(): Promise<void> {
    if (busy) return;
    const question = input.panel.readQuestion();
    const executorId = input.panel.readExecutorId();
    const envelope = createEnvelope(question);
    if (
      question.length === 0 ||
      executorId === undefined ||
      !input.panel.readConsent() ||
      envelope === undefined
    ) {
      return;
    }

    const requestRevision = ++revision;
    const model = input.panel.readModel();
    currentQuestion = question;
    busy = true;
    input.onBusyChange(true);
    currentResult = undefined;
    currentSnapshot = undefined;
    input.panel.setBusy(true);
    try {
      const snapshot = await api.createJob({
        schemaVersion: CONTEXTUAL_ASK_SCHEMA_VERSION,
        requestId: input.createId(),
        envelope,
        executorId,
        ...(model === undefined ? {} : { model }),
        providerDataConsent: true,
      });
      if (!isCurrent(requestRevision)) return;
      currentSnapshot = snapshot;
      input.panel.renderJob(snapshot);
      await api.events(snapshot.jobId, 0, (event) => {
        handleEvent(event, requestRevision);
      });
      if (!isCurrent(requestRevision)) return;
      const response = await api.result(snapshot.jobId);
      if (!isCurrent(requestRevision)) return;
      currentSnapshot = response.snapshot;
      busy = false;
      input.onBusyChange(false);
      if (response.result === undefined) {
        input.panel.renderJob(response.snapshot);
        if (response.snapshot.status === "failed") {
          input.panel.renderError(response.snapshot.errorCode);
        }
        return;
      }
      currentResult = response.result;
      input.panel.renderAnswer(response.result, false);
    } catch (error: unknown) {
      if (!isCurrent(requestRevision) || isAbortError(error)) return;
      busy = false;
      input.onBusyChange(false);
      input.panel.renderError(contextualAskApiErrorCode(error));
    } finally {
      if (isCurrent(requestRevision)) {
        busy = false;
        input.panel.setBusy(false);
      }
    }
  }

  async function cancel(): Promise<void> {
    if (!busy || currentSnapshot?.canCancel !== true) return;
    const requestRevision = revision;
    try {
      const snapshot = await api.cancelJob(currentSnapshot.jobId);
      if (!isCurrent(requestRevision)) return;
      currentSnapshot = snapshot;
      busy = false;
      input.onBusyChange(false);
      input.panel.renderJob(snapshot);
      input.panel.setBusy(false);
    } catch (error: unknown) {
      if (!isCurrent(requestRevision) || isAbortError(error)) return;
      busy = false;
      input.onBusyChange(false);
      input.panel.renderError(contextualAskApiErrorCode(error));
    }
  }

  function cancelPending(): void {
    revision += 1;
    const snapshot = currentSnapshot;
    busy = false;
    input.onBusyChange(false);
    currentSnapshot = undefined;
    api.cancelPending();
    if (snapshot?.canCancel === true) {
      void api.cancelJob(snapshot.jobId).catch(() => undefined);
    }
    input.panel.setBusy(false);
  }

  function newQuestion(): void {
    if (busy) cancelPending();
    revision += 1;
    currentSnapshot = undefined;
    currentResult = undefined;
    currentQuestion = "";
    input.panel.clear();
    input.panel.focusQuestion();
  }

  function copyAnswer(): void {
    const text = input.panel.answerPlainText();
    if (text.length === 0 || input.clipboard === undefined) return;
    void input.clipboard
      .writeText(text)
      .then(() => {
        input.panel.notify("copied");
      })
      .catch(() => {
        input.panel.notify("copy-failed");
      });
  }

  function convert(): void {
    if (currentResult === undefined || busy) return;
    const answerDigest = input.panel.answerPlainText().trim().slice(0, 4_000);
    if (answerDigest.length === 0) return;
    const origin: AskDraftOrigin = Object.freeze({
      kind: "contextual-ask",
      askJobId: currentResult.jobId,
      question: currentQuestion,
      answerDigest,
      sourceIds: currentResult.sources.map((source) => source.sourceId),
    });
    input.onConvert(origin);
    input.panel.setOrigin(origin);
    input.panel.setMode("change");
    input.panel.notify("converted");
  }

  function openSource(event: MouseEvent): void {
    const sourceId = input.panel.selectedSourceId(event.target);
    if (sourceId === undefined) return;
    const source = input.panel.sourceById(sourceId);
    if (source !== undefined) {
      void input.onOpenSource(source).catch(() => {
        input.panel.notify("source-open-failed");
      });
    }
  }

  function keydown(event: KeyboardEvent): void {
    if (
      event.target !== input.panel.questionInput ||
      event.key !== "Enter" ||
      composing ||
      event.isComposing ||
      (!event.metaKey && !event.ctrlKey)
    ) {
      return;
    }
    event.preventDefault();
    void submit();
  }

  function executorChanged(): void {
    const executorId = input.panel.readExecutorId();
    input.panel.setConsent(
      executorId !== undefined && consentByExecutor.get(executorId) === true,
    );
  }

  function compositionStart(): void {
    composing = true;
  }

  function compositionEnd(): void {
    composing = false;
  }

  function consentChanged(): void {
    const executorId = input.panel.readExecutorId();
    if (executorId !== undefined) {
      consentByExecutor.set(executorId, input.panel.readConsent());
    }
  }

  function submitClick(): void {
    void submit();
  }

  function cancelClick(): void {
    void cancel();
  }

  function mount(): void {
    if (mounted) return;
    mounted = true;
    input.panel.submitButton.addEventListener("click", submitClick);
    input.panel.cancelButton.addEventListener("click", cancelClick);
    input.panel.newQuestionButton.addEventListener("click", newQuestion);
    input.panel.copyButton.addEventListener("click", copyAnswer);
    input.panel.convertButton.addEventListener("click", convert);
    input.panel.executorSelect.addEventListener("change", executorChanged);
    input.panel.consentCheckbox.addEventListener("change", consentChanged);
    input.panel.questionInput.addEventListener("keydown", keydown);
    input.panel.questionInput.addEventListener("compositionstart", compositionStart);
    input.panel.questionInput.addEventListener("compositionend", compositionEnd);
    input.panel.root.addEventListener("click", openSource);
    void loadCapability();
  }

  function dispose(): void {
    if (!mounted) return;
    cancelPending();
    mounted = false;
    input.panel.submitButton.removeEventListener("click", submitClick);
    input.panel.cancelButton.removeEventListener("click", cancelClick);
    input.panel.newQuestionButton.removeEventListener("click", newQuestion);
    input.panel.copyButton.removeEventListener("click", copyAnswer);
    input.panel.convertButton.removeEventListener("click", convert);
    input.panel.executorSelect.removeEventListener("change", executorChanged);
    input.panel.consentCheckbox.removeEventListener("change", consentChanged);
    input.panel.questionInput.removeEventListener("keydown", keydown);
    input.panel.questionInput.removeEventListener("compositionstart", compositionStart);
    input.panel.questionInput.removeEventListener("compositionend", compositionEnd);
    input.panel.root.removeEventListener("click", openSource);
    api.dispose();
  }

  return Object.freeze({
    beginSelection(): void {
      revision += 1;
      busy = false;
      input.onBusyChange(false);
      currentSnapshot = undefined;
      currentResult = undefined;
      currentQuestion = "";
      input.panel.clear();
      void loadCapability();
    },
    cancelPending,
    dispose,
    isBusy: () => busy,
    mount,
    selectionChanged(): void {
      if (currentResult !== undefined) input.panel.renderAnswer(currentResult, true);
    },
  });
}
