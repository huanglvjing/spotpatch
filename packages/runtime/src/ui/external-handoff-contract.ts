import type {
  ErrorCode,
  ExternalAgentControlStatus,
  ExternalAgentManagedResult,
  ExternalHandoffCapability,
  ExternalHandoffPublishResult,
  ExternalHandoffStatusResult,
  ExternalHandoffFramework,
  SpotAnnotation,
  SpotPatchLocale,
} from "@spotpatch/shared/external-handoff-browser";

export interface ExternalHandoffPanel {
  readonly cancelManagedButton: HTMLButtonElement;
  readonly connectButton: HTMLButtonElement;
  readonly disconnectButton: HTMLButtonElement;
  readonly refreshButton: HTMLButtonElement;
  readonly root: HTMLElement;
  readonly sendButton: HTMLButtonElement;
  readonly styles: HTMLStyleElement;
  readonly confirmDisclosure: (annotation: SpotAnnotation) => Promise<boolean>;
  readonly dispose: () => void;
  readonly renderCapability: (capability: ExternalHandoffCapability) => void;
  readonly renderControlUnavailable: () => void;
  readonly renderControlStatus: (status: ExternalAgentControlStatus) => void;
  readonly renderError: (code?: ErrorCode, retryable?: boolean) => void;
  readonly renderPublishResult: (result: ExternalHandoffPublishResult) => void;
  readonly renderPublishing: () => void;
  readonly renderManagedResult: (result: ExternalAgentManagedResult) => void;
  readonly renderStatus: (result: ExternalHandoffStatusResult) => void;
  readonly resolveButton: HTMLButtonElement;
  readonly revokeButton: HTMLButtonElement;
  readonly setBusy: (busy: boolean) => void;
  readonly setControlBusy: (busy: boolean) => void;
  readonly setContextReady: (ready: boolean) => void;
  readonly setSelectionVisible: (visible: boolean) => void;
}

export interface ExternalHandoffWorkflow {
  readonly cancelPending: () => void;
  readonly dispose: () => void;
  readonly mount: () => void;
}

export interface ExternalHandoffExtension {
  readonly createPanel: (
    document: Document,
    framework: ExternalHandoffFramework,
    locale: () => SpotPatchLocale,
    sessionId: string,
    subscribeLocale: (listener: () => void) => () => void,
    onViewChange: () => void,
  ) => ExternalHandoffPanel;
  readonly createWorkflow: (
    fetch: typeof globalThis.fetch,
    panel: ExternalHandoffPanel,
    selectedAnnotation: () => SpotAnnotation | undefined,
    sessionToken: string,
    window: Window,
  ) => ExternalHandoffWorkflow;
}

const EXTERNAL_HANDOFF_EXTENSION_KEY = Symbol.for("spotpatch.external-handoff.v1");
type ExtensionStore = Partial<Record<symbol, ExternalHandoffExtension>>;

export function registerExternalHandoffExtension(
  extension: ExternalHandoffExtension,
): void {
  (globalThis as ExtensionStore)[EXTERNAL_HANDOFF_EXTENSION_KEY] = extension;
}

export function getExternalHandoffExtension(): ExternalHandoffExtension | undefined {
  return (globalThis as ExtensionStore)[EXTERNAL_HANDOFF_EXTENSION_KEY];
}
