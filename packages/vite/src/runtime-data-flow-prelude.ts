import {
  installDataFlowPrelude,
  type DataFlowRuntime,
} from "@spotpatch/runtime/data-flow";
import type { RuntimeDataFlowConfig } from "@spotpatch/shared";

declare const __SPOTPATCH_DATA_FLOW_CONFIG__: RuntimeDataFlowConfig;

const installed = installDataFlowPrelude(__SPOTPATCH_DATA_FLOW_CONFIG__);

if (installed === undefined) {
  throw new Error("SpotPatch data-flow prelude was loaded while disabled.");
}

export const dataFlowRuntime: DataFlowRuntime = installed;
