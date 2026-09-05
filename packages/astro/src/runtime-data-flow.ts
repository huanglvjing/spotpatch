import {
  installDataFlowPrelude,
  disposeDataFlowPrelude,
  type DataFlowRuntime,
} from "@spotpatch/runtime/data-flow";
import type { RuntimeDataFlowConfig } from "@spotpatch/shared";

import { createAstroDataFlowPolicy } from "./data-flow-policy.js";

declare const __SPOTPATCH_DATA_FLOW_CONFIG__: RuntimeDataFlowConfig;
const observation = createAstroDataFlowPolicy(document);
const installed = installDataFlowPrelude(
  __SPOTPATCH_DATA_FLOW_CONFIG__,
  globalThis,
  observation.policy,
);
if (installed === undefined)
  throw new Error("SpotPatch Astro data-flow prelude loaded while disabled.");
export const dataFlowRuntime: DataFlowRuntime = installed;
const updateRoute = (): void => {
  dataFlowRuntime.updateRoute(location.pathname);
};
document.addEventListener("astro:page-load", updateRoute);
updateRoute();
import.meta.hot?.dispose(() => {
  document.removeEventListener("astro:page-load", updateRoute);
  observation.dispose();
  disposeDataFlowPrelude(dataFlowRuntime);
});
