export { createDataFlowPanel } from "./ui/data-flow-panel.js";
export {
  getDataFlowExtension,
  registerDataFlowExtension,
  type DataFlowExtension,
  type DataFlowPanel,
  type DataFlowPanelFactory,
  type DataFlowPanelSnapshot,
  type DataFlowPanelStatus,
  type DataFlowViewState,
} from "./ui/data-flow-panel-contract.js";

import {
  getDataFlowRuntime,
  mergeComponentDataFlowReport,
  mergePageDataFlowReport,
} from "./data-flow-entry.js";
import { createDataFlowPanel } from "./ui/data-flow-panel.js";
import { registerDataFlowExtension } from "./ui/data-flow-panel-contract.js";

export function installDataFlowPanelExtension(): void {
  registerDataFlowExtension(
    Object.freeze({
      createPanel: createDataFlowPanel,
      getComponentRegistration(component: object) {
        return getDataFlowRuntime()?.getComponentRegistration(component);
      },
      observations(routeKey: string) {
        const runtime = getDataFlowRuntime();
        runtime?.updateRoute(routeKey);
        return runtime?.observations() ?? Object.freeze([]);
      },
      mergeComponentReport: mergeComponentDataFlowReport,
      mergePageReport: mergePageDataFlowReport,
    }),
  );
}
