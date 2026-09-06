import {
  ERROR_CODES,
  EXTERNAL_AGENT_CONTROL_LIMITS,
  EXTERNAL_AGENT_MANAGED_PROFILE,
  EXTERNAL_HANDOFF_BROKER_PROTOCOL_VERSION,
  EXTERNAL_HANDOFF_LIMITS,
  EXTERNAL_HANDOFF_SNAPSHOT_SCHEMA_VERSION,
  SPOTPATCH_ENDPOINTS,
  SPOTPATCH_TOKEN_HEADER,
  isErrorCode,
  type ErrorCode,
  type ActiveAdapterSummary,
  type DispatchSummary,
  type ExternalAgentControlStatus,
  type ExternalAgentEvent,
  type ExternalHandoffCapability,
  type ExternalHandoffPublishResult,
  type ExternalHandoffStatusResult,
  type ExternalHandoffSummary,
  type SpotAnnotation,
} from "@spotpatch/shared/external-handoff-browser";

import type {
  ExternalHandoffPanel,
  ExternalHandoffWorkflow,
} from "../ui/external-handoff-contract.js";
import {
  exactKeys,
  readBoundedJson,
  record,
  successData,
  validTimestamp,
} from "./browser-api.js";
import { createExternalAgentControlClient } from "./external-agent-control-client.js";

interface WorkflowOptions {
  readonly fetch: typeof globalThis.fetch;
  readonly panel: ExternalHandoffPanel;
  readonly selectedAnnotation: () => SpotAnnotation | undefined;
  readonly sessionToken: string;
  readonly window: Window;
}

const MAX_SUMMARY_RESPONSE_BYTES = 64 * 1_024;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{22,128}$/u;

class ExternalHandoffApiError extends Error {
  constructor(readonly code?: ErrorCode) {
    super("SpotPatch external handoff API request failed.");
    this.name = "ExternalHandoffApiError";
  }
}

function parseActiveAdapter(value: unknown): ActiveAdapterSummary | null {
  if (value === null) return null;

  if (
    !record(value) ||
    !exactKeys(value, ["canDispatch", "connectedAt", "kind", "state", "updatedAt"]) ||
    (value.kind !== "claude-channel" && value.kind !== "codex-app-server") ||
    (value.state !== "ready" && value.state !== "busy" && value.state !== "blocked") ||
    typeof value.canDispatch !== "boolean" ||
    value.canDispatch !== (value.state === "ready") ||
    !validTimestamp(value.connectedAt) ||
    !validTimestamp(value.updatedAt)
  ) {
    throw new ExternalHandoffApiError();
  }

  return Object.freeze({
    kind: value.kind,
    state: value.state,
    canDispatch: value.canDispatch,
    connectedAt: value.connectedAt,
    updatedAt: value.updatedAt,
  });
}

function parseDispatch(value: unknown): DispatchSummary | null {
  if (value === null) return null;
  if (!record(value)) throw new ExternalHandoffApiError();

  if (
    !exactKeys(value, ["adapterKind", "phase", "revision", "updatedAt"]) ||
    (value.adapterKind !== "claude-channel" &&
      value.adapterKind !== "codex-app-server") ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) <= 0 ||
    (value.phase !== "queued" &&
      value.phase !== "dispatching" &&
      value.phase !== "dispatched" &&
      value.phase !== "working" &&
      value.phase !== "completed" &&
      value.phase !== "failed" &&
      value.phase !== "delivery-unknown") ||
    !validTimestamp(value.updatedAt)
  ) {
    throw new ExternalHandoffApiError();
  }

  return Object.freeze({
    adapterKind: value.adapterKind,
    revision: value.revision as number,
    phase: value.phase,
    updatedAt: value.updatedAt,
  });
}

function parseCapability(value: unknown): ExternalHandoffCapability {
  if (
    !record(value) ||
    !exactKeys(value, [
      "activeAdapter",
      "activeWaitCount",
      "brokerProtocolVersion",
      "brokerReady",
      "dispatch",
      "enabled",
      "snapshotSchemaVersion",
    ]) ||
    value.enabled !== true ||
    typeof value.brokerReady !== "boolean" ||
    !Number.isSafeInteger(value.activeWaitCount) ||
    (value.activeWaitCount as number) < 0 ||
    (value.activeWaitCount as number) > EXTERNAL_HANDOFF_LIMITS.maximumWaiters ||
    value.snapshotSchemaVersion !== EXTERNAL_HANDOFF_SNAPSHOT_SCHEMA_VERSION ||
    value.brokerProtocolVersion !== EXTERNAL_HANDOFF_BROKER_PROTOCOL_VERSION
  ) {
    throw new ExternalHandoffApiError();
  }

  return Object.freeze({
    enabled: true,
    brokerReady: value.brokerReady,
    activeWaitCount: value.activeWaitCount as number,
    activeAdapter: parseActiveAdapter(value.activeAdapter),
    dispatch: parseDispatch(value.dispatch),
    snapshotSchemaVersion: EXTERNAL_HANDOFF_SNAPSHOT_SCHEMA_VERSION,
    brokerProtocolVersion: EXTERNAL_HANDOFF_BROKER_PROTOCOL_VERSION,
  });
}

function parsePublishResult(value: unknown): ExternalHandoffPublishResult {
  if (
    !record(value) ||
    !exactKeys(value, ["delivery", "handoff", "replayed"]) ||
    typeof value.replayed !== "boolean" ||
    !record(value.delivery)
  ) {
    throw new ExternalHandoffApiError();
  }

  const handoff = parseSummary(value.handoff);

  if (value.delivery.mode === "inbox") {
    if (!exactKeys(value.delivery, ["mode"])) {
      throw new ExternalHandoffApiError();
    }

    return Object.freeze({
      handoff,
      delivery: Object.freeze({ mode: "inbox" as const }),
      replayed: value.replayed,
    });
  }

  if (
    value.delivery.mode !== "active" ||
    !exactKeys(value.delivery, ["adapter", "dispatch", "mode"])
  ) {
    throw new ExternalHandoffApiError();
  }

  const adapter = parseActiveAdapter(value.delivery.adapter);
  const dispatch = parseDispatch(value.delivery.dispatch);

  if (adapter === null || dispatch?.revision !== handoff.revision) {
    throw new ExternalHandoffApiError();
  }

  return Object.freeze({
    handoff,
    delivery: Object.freeze({ mode: "active" as const, adapter, dispatch }),
    replayed: value.replayed,
  });
}

function parseStatusResult(value: unknown): ExternalHandoffStatusResult {
  if (!record(value) || !exactKeys(value, ["activeAdapter", "dispatch", "handoff"])) {
    throw new ExternalHandoffApiError();
  }

  const handoff = parseSummary(value.handoff);
  const dispatch = parseDispatch(value.dispatch);

  if (dispatch !== null && dispatch.revision !== handoff.revision) {
    throw new ExternalHandoffApiError();
  }

  return Object.freeze({
    handoff,
    activeAdapter: parseActiveAdapter(value.activeAdapter),
    dispatch,
  });
}

function parseSummary(value: unknown): ExternalHandoffSummary {
  if (!record(value)) throw new ExternalHandoffApiError();
  const expectedKeys = [
    "cursor",
    "expiresAt",
    "framework",
    "page",
    "pickupCount",
    "publishedAt",
    "revision",
    "sessionId",
    "state",
    "targetCount",
    ...(value.pickedUpAt === undefined ? [] : ["pickedUpAt"]),
  ];

  if (
    !exactKeys(value, expectedKeys) ||
    typeof value.sessionId !== "string" ||
    !OPAQUE_ID_PATTERN.test(value.sessionId) ||
    (value.framework !== "vite" && value.framework !== "next") ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) <= 0 ||
    typeof value.cursor !== "string" ||
    !OPAQUE_ID_PATTERN.test(value.cursor) ||
    !Number.isSafeInteger(value.targetCount) ||
    (value.targetCount as number) <= 0 ||
    !record(value.page) ||
    !exactKeys(value.page, ["origin", "pathname"]) ||
    typeof value.page.origin !== "string" ||
    typeof value.page.pathname !== "string" ||
    !validTimestamp(value.publishedAt) ||
    !validTimestamp(value.expiresAt) ||
    (value.state !== "available" &&
      value.state !== "expired" &&
      value.state !== "superseded") ||
    !Number.isSafeInteger(value.pickupCount) ||
    (value.pickupCount as number) < 0 ||
    (value.pickupCount as number) > EXTERNAL_HANDOFF_LIMITS.maximumConnectorReceipts ||
    (value.pickedUpAt !== undefined && !validTimestamp(value.pickedUpAt))
  ) {
    throw new ExternalHandoffApiError();
  }

  return Object.freeze({
    sessionId: value.sessionId,
    framework: value.framework,
    revision: value.revision as number,
    cursor: value.cursor,
    targetCount: value.targetCount as number,
    page: Object.freeze({ origin: value.page.origin, pathname: value.page.pathname }),
    publishedAt: value.publishedAt,
    expiresAt: value.expiresAt,
    state: value.state,
    pickupCount: value.pickupCount as number,
    ...(value.pickedUpAt === undefined ? {} : { pickedUpAt: value.pickedUpAt }),
  });
}

function failureCode(value: unknown): ErrorCode | undefined {
  return record(value) &&
    value.ok === false &&
    record(value.error) &&
    isErrorCode(value.error.code)
    ? value.error.code
    : undefined;
}

function omitBrowserCode(annotation: SpotAnnotation): SpotAnnotation {
  return {
    ...annotation,
    targets: annotation.targets.map((target) => ({
      instruction: target.instruction,
      ...(target.page === undefined ? {} : { page: target.page }),
      source: target.source,
      react: target.react,
      element: target.element,
      styles: target.styles,
      warnings: target.warnings,
    })),
  };
}

function createRequestId(window: Window): string {
  const bytes = new Uint8Array(24);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function dispatchIsPending(dispatch: DispatchSummary | null): boolean {
  return (
    dispatch !== null &&
    dispatch.phase !== "completed" &&
    dispatch.phase !== "failed" &&
    dispatch.phase !== "delivery-unknown"
  );
}

function api(options: WorkflowOptions) {
  const pending = new Set<AbortController>();

  const request = async (endpoint: string, body: unknown): Promise<unknown> => {
    const controller = new AbortController();
    pending.add(controller);

    try {
      const response = await options.fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [SPOTPATCH_TOKEN_HEADER]: options.sessionToken,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      let envelope: unknown;
      try {
        envelope = await readBoundedJson(response, MAX_SUMMARY_RESPONSE_BYTES);
      } catch {
        throw new ExternalHandoffApiError();
      }

      if (!response.ok) throw new ExternalHandoffApiError(failureCode(envelope));
      try {
        return successData(envelope);
      } catch {
        throw new ExternalHandoffApiError();
      }
    } finally {
      pending.delete(controller);
    }
  };

  return Object.freeze({
    cancel() {
      for (const controller of pending) controller.abort();
      pending.clear();
    },
    async capability() {
      return parseCapability(
        await request(SPOTPATCH_ENDPOINTS.externalHandoffCapability, {}),
      );
    },
    async publish(requestId: string, annotation: SpotAnnotation) {
      return parsePublishResult(
        await request(SPOTPATCH_ENDPOINTS.externalHandoffPublish, {
          annotation: omitBrowserCode(annotation),
          requestId,
        }),
      );
    },
    async status(cursor?: string) {
      return parseStatusResult(
        await request(
          SPOTPATCH_ENDPOINTS.externalHandoffStatus,
          cursor === undefined ? {} : { cursor },
        ),
      );
    },
    async resolveDelivery(cursor: string) {
      return parseStatusResult(
        await request(SPOTPATCH_ENDPOINTS.externalHandoffResolveDelivery, {
          confirmation: "workspace-reviewed",
          cursor,
        }),
      );
    },
  });
}

export function createExternalHandoffWorkflow(
  fetch: typeof globalThis.fetch,
  panel: ExternalHandoffPanel,
  selectedAnnotation: () => SpotAnnotation | undefined,
  sessionToken: string,
  window: Window,
): ExternalHandoffWorkflow {
  const options: WorkflowOptions = {
    fetch,
    panel,
    selectedAnnotation,
    sessionToken,
    window,
  };
  const client = api(options);
  const controlClient = createExternalAgentControlClient(fetch, sessionToken);
  const timers = new Set<number>();
  const lifecycle = {
    disposed: false,
    mounted: false,
    operation: 0,
    userActionPending: false,
  };
  let capability: ExternalHandoffCapability | undefined;
  let controlStatus: ExternalAgentControlStatus | undefined;
  let controlEventController: AbortController | undefined;
  let controlReconnectDelay: number =
    EXTERNAL_AGENT_CONTROL_LIMITS.eventReconnectMinimumMs;
  let controlReconnectTimer: number | undefined;
  let controlActionPending = false;
  let managedResultRevision: number | undefined;
  let managedResultLoadingRevision: number | undefined;
  let current: ExternalHandoffStatusResult | undefined;
  let retryablePublish:
    Readonly<{ annotation: SpotAnnotation; requestId: string }> | undefined;
  const isDisposed = (): boolean => lifecycle.disposed;

  const clearTimers = (): void => {
    for (const timer of timers) options.window.clearTimeout(timer);
    timers.clear();
  };
  const clearControlReconnect = (): void => {
    if (controlReconnectTimer === undefined) return;
    options.window.clearTimeout(controlReconnectTimer);
    controlReconnectTimer = undefined;
  };
  const renderManagedResult = async (revision: number): Promise<void> => {
    if (
      lifecycle.disposed ||
      managedResultRevision === revision ||
      managedResultLoadingRevision === revision
    ) {
      return;
    }
    managedResultLoadingRevision = revision;
    try {
      const result = await controlClient.result(revision);
      if (isDisposed() || controlStatus?.task?.revision !== revision) return;
      managedResultRevision = revision;
      options.panel.renderManagedResult(result);
    } catch {
      // The status remains authoritative. A later status event or reconnect retries
      // the bounded result read while it is still retained by the Supervisor.
    } finally {
      if (managedResultLoadingRevision === revision) {
        managedResultLoadingRevision = undefined;
      }
    }
  };
  const applyControlStatus = (value: ExternalAgentControlStatus): void => {
    if (controlStatus !== undefined && value.sequence < controlStatus.sequence) return;
    controlStatus = value;
    controlReconnectDelay = EXTERNAL_AGENT_CONTROL_LIMITS.eventReconnectMinimumMs;
    options.panel.renderControlStatus(value);
    const resultRevision =
      value.task?.resultExpiresAt === undefined ? undefined : value.task.revision;
    if (resultRevision !== undefined) void renderManagedResult(resultRevision);
  };
  const handleControlEvent = (event: ExternalAgentEvent): void => {
    if (event.type === "status") {
      applyControlStatus(event.data);
      return;
    }
    const resultRevision =
      controlStatus?.task?.resultExpiresAt === undefined
        ? undefined
        : controlStatus.task.revision;
    if (resultRevision !== undefined) void renderManagedResult(resultRevision);
  };
  const startControlEventStream = (): void => {
    if (
      lifecycle.disposed ||
      !lifecycle.mounted ||
      controlEventController !== undefined
    ) {
      return;
    }
    clearControlReconnect();
    const controller = new AbortController();
    controlEventController = controller;
    void controlClient
      .events(controlStatus?.sequence, controller.signal, handleControlEvent)
      .catch((error: unknown) => {
        if (
          lifecycle.disposed ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        if (controlStatus === undefined) options.panel.renderControlUnavailable();
      })
      .finally(() => {
        if (controlEventController === controller) {
          controlEventController = undefined;
        }
        if (lifecycle.disposed || !lifecycle.mounted) return;
        const delay = controlReconnectDelay;
        controlReconnectDelay = Math.min(
          delay * 2,
          EXTERNAL_AGENT_CONTROL_LIMITS.eventReconnectMaximumMs,
        );
        controlReconnectTimer = options.window.setTimeout(() => {
          controlReconnectTimer = undefined;
          startControlEventStream();
        }, delay);
      });
  };
  const refreshControlStatus = async (): Promise<void> => {
    applyControlStatus(await controlClient.status());
  };
  const bootstrapControl = async (): Promise<void> => {
    try {
      await refreshControlStatus();
    } catch {
      if (!lifecycle.disposed) options.panel.renderControlUnavailable();
    } finally {
      if (!lifecycle.disposed) startControlEventStream();
    }
  };
  const performControlAction = async (
    action: () => Promise<ExternalAgentControlStatus>,
  ): Promise<void> => {
    if (lifecycle.disposed || controlActionPending) return;
    controlActionPending = true;
    options.panel.setControlBusy(true);
    try {
      applyControlStatus(await action());
    } catch {
      try {
        await refreshControlStatus();
      } catch {
        if (!isDisposed()) options.panel.renderControlUnavailable();
      }
    } finally {
      controlActionPending = false;
      if (!isDisposed()) options.panel.setControlBusy(false);
    }
  };
  const handleConnectClick = (): void => {
    const model = options.panel.readModel();
    void performControlAction(() =>
      controlClient.connect({
        requestId: createRequestId(options.window),
        adapterKind: "codex",
        profile: EXTERNAL_AGENT_MANAGED_PROFILE,
        ...(model === undefined ? {} : { model }),
      }),
    );
  };
  const handleDisconnectClick = (): void => {
    void performControlAction(() =>
      controlClient.disconnect({
        requestId: createRequestId(options.window),
        adapterKind: "codex",
        revokeGrant: false,
      }),
    );
  };
  const handleRevokeClick = (): void => {
    void performControlAction(() =>
      controlClient.disconnect({
        requestId: createRequestId(options.window),
        adapterKind: "codex",
        revokeGrant: true,
      }),
    );
  };
  const handleManagedCancelClick = (): void => {
    const revision = controlStatus?.task?.revision;
    if (revision === undefined) return;
    void performControlAction(() =>
      controlClient.cancel({
        requestId: createRequestId(options.window),
        revision,
      }),
    );
  };
  const errorCode = (error: unknown): ErrorCode | undefined =>
    error instanceof ExternalHandoffApiError ? error.code : undefined;
  const restorePanel = (): void => {
    if (current !== undefined) options.panel.renderStatus(current);
    else if (capability !== undefined) options.panel.renderCapability(capability);
  };
  const refreshCapability = async (revision: number): Promise<void> => {
    try {
      const result = await client.capability();
      if (lifecycle.disposed || revision !== lifecycle.operation) return;
      capability = result;
      options.panel.renderCapability(result);
      if (result.dispatch !== null) {
        const status = await client.status();
        if (revision !== lifecycle.operation) return;
        current = status;
        options.panel.renderStatus(status);
      }
    } catch (error: unknown) {
      if (
        lifecycle.disposed ||
        revision !== lifecycle.operation ||
        (error instanceof DOMException && error.name === "AbortError")
      )
        return;
      options.panel.renderError(errorCode(error));
    }
  };
  const refreshStatus = async (revision: number): Promise<void> => {
    if (current === undefined) {
      await refreshCapability(revision);
      return;
    }

    try {
      const result = await client.status(current.handoff.cursor);
      if (lifecycle.disposed || revision !== lifecycle.operation) return;
      current = result;
      options.panel.renderStatus(result);
    } catch (error: unknown) {
      if (
        lifecycle.disposed ||
        revision !== lifecycle.operation ||
        (error instanceof DOMException && error.name === "AbortError")
      )
        return;
      options.panel.renderError(errorCode(error));
    }
  };
  const scheduleRefresh = (delay: number, continueWhilePending: boolean): void => {
    const revision = lifecycle.operation;
    const timer = options.window.setTimeout(() => {
      timers.delete(timer);
      void refreshStatus(revision).then(() => {
        if (
          continueWhilePending &&
          !lifecycle.disposed &&
          revision === lifecycle.operation &&
          !lifecycle.userActionPending &&
          current !== undefined &&
          dispatchIsPending(current.dispatch)
        ) {
          scheduleRefresh(
            EXTERNAL_HANDOFF_LIMITS.activeStatusPollMs,
            continueWhilePending,
          );
        }
      });
    }, delay);
    timers.add(timer);
  };
  const handleSend = async (): Promise<void> => {
    if (lifecycle.userActionPending) return;
    lifecycle.userActionPending = true;
    let pending = retryablePublish;

    if (pending === undefined) {
      const annotation = options.selectedAnnotation();
      if (annotation === undefined) {
        lifecycle.userActionPending = false;
        options.panel.renderError(ERROR_CODES.HANDOFF_VALIDATION_FAILED);
        return;
      }

      const disclosureRevision = lifecycle.operation;
      options.panel.setBusy(true);
      const confirmed = await options.panel.confirmDisclosure(annotation);
      if (!confirmed || disclosureRevision !== lifecycle.operation) {
        lifecycle.userActionPending = false;
        options.panel.setBusy(false);
        return;
      }

      pending = Object.freeze({
        annotation,
        requestId: createRequestId(options.window),
      });
    }

    retryablePublish = pending;
    lifecycle.operation += 1;
    const revision = lifecycle.operation;
    clearTimers();
    client.cancel();
    options.panel.renderPublishing();

    try {
      const result = await client.publish(pending.requestId, pending.annotation);
      if (revision !== lifecycle.operation) return;
      retryablePublish = undefined;
      current = Object.freeze({
        handoff: result.handoff,
        activeAdapter:
          result.delivery.mode === "active" ? result.delivery.adapter : null,
        dispatch: result.delivery.mode === "active" ? result.delivery.dispatch : null,
      });
      options.panel.renderPublishResult(result);
      scheduleRefresh(
        result.delivery.mode === "active"
          ? EXTERNAL_HANDOFF_LIMITS.activeStatusPollMs
          : 500,
        result.delivery.mode === "active",
      );
    } catch (error: unknown) {
      if (
        revision !== lifecycle.operation ||
        (error instanceof DOMException && error.name === "AbortError")
      )
        return;
      const code = errorCode(error);
      const retryable = code === undefined;
      if (!retryable) retryablePublish = undefined;
      options.panel.renderError(code, retryable);
    } finally {
      if (revision === lifecycle.operation) {
        lifecycle.userActionPending = false;
        options.panel.setBusy(false);
      }
    }
  };
  const handleRefresh = async (): Promise<void> => {
    if (lifecycle.userActionPending) return;
    lifecycle.userActionPending = true;
    lifecycle.operation += 1;
    const revision = lifecycle.operation;
    clearTimers();
    client.cancel();
    options.panel.setBusy(true);

    try {
      await refreshStatus(revision);
    } finally {
      if (!lifecycle.disposed && revision === lifecycle.operation) {
        lifecycle.userActionPending = false;
        options.panel.setBusy(false);
      }
    }
  };
  const handleResolveDelivery = async (): Promise<void> => {
    if (
      lifecycle.userActionPending ||
      current === undefined ||
      current.dispatch?.phase !== "delivery-unknown"
    ) {
      return;
    }

    lifecycle.userActionPending = true;
    lifecycle.operation += 1;
    const revision = lifecycle.operation;
    clearTimers();
    client.cancel();
    options.panel.setBusy(true);

    try {
      const result = await client.resolveDelivery(current.handoff.cursor);
      if (lifecycle.disposed || revision !== lifecycle.operation) return;
      current = result;
      options.panel.renderStatus(result);
    } catch (error: unknown) {
      if (
        lifecycle.disposed ||
        revision !== lifecycle.operation ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        return;
      }
      options.panel.renderError(errorCode(error));
    } finally {
      if (!lifecycle.disposed && revision === lifecycle.operation) {
        lifecycle.userActionPending = false;
        options.panel.setBusy(false);
      }
    }
  };
  const handleSendClick = (): void => {
    void handleSend();
  };
  const handleRefreshClick = (): void => {
    void handleRefresh();
  };
  const handleResolveClick = (): void => {
    void handleResolveDelivery();
  };
  const cancelPending = (): void => {
    lifecycle.operation += 1;
    lifecycle.userActionPending = false;
    retryablePublish = undefined;
    clearTimers();
    client.cancel();
    restorePanel();
    if (capability === undefined && lifecycle.mounted && !lifecycle.disposed) {
      void refreshCapability(lifecycle.operation);
    }
  };

  return Object.freeze({
    mount(): void {
      if (lifecycle.mounted || lifecycle.disposed) return;
      lifecycle.mounted = true;
      options.panel.sendButton.addEventListener("click", handleSendClick);
      options.panel.refreshButton.addEventListener("click", handleRefreshClick);
      options.panel.resolveButton.addEventListener("click", handleResolveClick);
      options.panel.connectButton.addEventListener("click", handleConnectClick);
      options.panel.disconnectButton.addEventListener("click", handleDisconnectClick);
      options.panel.revokeButton.addEventListener("click", handleRevokeClick);
      options.panel.cancelManagedButton.addEventListener(
        "click",
        handleManagedCancelClick,
      );
      void refreshCapability(lifecycle.operation);
      void bootstrapControl();
    },
    cancelPending,
    dispose(): void {
      if (lifecycle.disposed) return;
      lifecycle.disposed = true;
      lifecycle.operation += 1;
      lifecycle.userActionPending = false;
      retryablePublish = undefined;
      clearTimers();
      clearControlReconnect();
      controlEventController?.abort("workflow-disposed");
      controlEventController = undefined;
      client.cancel();
      options.panel.sendButton.removeEventListener("click", handleSendClick);
      options.panel.refreshButton.removeEventListener("click", handleRefreshClick);
      options.panel.resolveButton.removeEventListener("click", handleResolveClick);
      options.panel.connectButton.removeEventListener("click", handleConnectClick);
      options.panel.disconnectButton.removeEventListener(
        "click",
        handleDisconnectClick,
      );
      options.panel.revokeButton.removeEventListener("click", handleRevokeClick);
      options.panel.cancelManagedButton.removeEventListener(
        "click",
        handleManagedCancelClick,
      );
    },
  });
}
