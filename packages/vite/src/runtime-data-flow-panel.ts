import {
  createDataFlowPanel,
  registerDataFlowExtension,
} from "@spotpatch/runtime/data-flow-panel";
import {
  getDataFlowRuntime,
  mergeComponentDataFlowReport,
  mergePageDataFlowReport,
} from "@spotpatch/runtime/data-flow";

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
