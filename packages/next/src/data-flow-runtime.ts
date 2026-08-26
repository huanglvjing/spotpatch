import {
  installDataFlowPrelude,
  type DataFlowRuntime,
} from "@spotpatch/runtime/data-flow";
import { DEFAULT_RUNTIME_DATA_FLOW_LIMITS } from "@spotpatch/shared";

import { createNextDataFlowObservationPolicy } from "./internal/data-flow-policy.js";

const installed = installDataFlowPrelude(
  Object.freeze({
    enabled: true,
    limits: DEFAULT_RUNTIME_DATA_FLOW_LIMITS,
    runtime: "dispatch" as const,
  }),
  globalThis,
  createNextDataFlowObservationPolicy(),
);

if (installed === undefined) {
  throw new Error("SpotPatch Next data-flow prelude could not be installed.");
}

export const dataFlowRuntime: DataFlowRuntime = installed;
