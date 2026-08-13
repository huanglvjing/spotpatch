import type {
  ComponentDataFlowReport,
  NetworkObservation,
  PageDataFlowReport,
  SpotPatchLocale,
} from "@spotpatch/shared";

import type { DataFlowComponentRegistration } from "../data-flow/data-flow-runtime.js";

export type DataFlowPanelStatus = "disabled" | "idle" | "loading" | "ready" | "error";

export interface DataFlowPanelSnapshot {
  readonly status: DataFlowPanelStatus;
  readonly report?: ComponentDataFlowReport | PageDataFlowReport;
  readonly message?: string;
}

export interface DataFlowViewState {
  readonly component: DataFlowPanelSnapshot;
  readonly page: DataFlowPanelSnapshot;
  readonly observationCount: number;
}

export interface DataFlowPanel {
  readonly root: HTMLElement;
  readonly refreshButton: HTMLButtonElement;
  readonly styles: HTMLStyleElement;
  readonly dispose: () => void;
  readonly render: (state: DataFlowViewState) => void;
  readonly resetView: () => void;
}

export type DataFlowPanelFactory = (
  document: Document,
  enabled: boolean,
  locale: () => SpotPatchLocale,
  changesRoot: HTMLElement,
  diagnosticsRoot: HTMLElement,
  onViewChange: () => void,
) => DataFlowPanel;

export interface DataFlowExtension {
  readonly createPanel: DataFlowPanelFactory;
  readonly getComponentRegistration: (
    component: object,
  ) => DataFlowComponentRegistration | undefined;
  readonly observations: (routeKey: string) => readonly NetworkObservation[];
  readonly mergeComponentReport: (
    report: ComponentDataFlowReport,
    observations: readonly NetworkObservation[],
  ) => ComponentDataFlowReport;
  readonly mergePageReport: (
    report: PageDataFlowReport,
    observations: readonly NetworkObservation[],
  ) => PageDataFlowReport;
}

const DATA_FLOW_EXTENSION_KEY = Symbol.for("spotpatch.data-flow.extension.v1");
type ExtensionStore = Partial<Record<symbol, DataFlowExtension>>;

export function registerDataFlowExtension(
  extension: DataFlowExtension,
  target: ExtensionStore = globalThis,
): void {
  target[DATA_FLOW_EXTENSION_KEY] = extension;
}

export function getDataFlowExtension(
  target: ExtensionStore = globalThis,
): DataFlowExtension | undefined {
  return target[DATA_FLOW_EXTENSION_KEY];
}
