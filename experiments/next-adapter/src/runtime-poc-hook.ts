import "bippy/install-hook-only";

import type { RuntimePocBootstrapFailureCode } from "./runtime-poc-bootstrap.js";

interface RuntimePocState {
  errorCode?: RuntimePocErrorCode;
  readonly hookInstalled: boolean;
  readonly initializationDurationMs: number;
  status: "bootstrapping" | "failed" | "ready";
}

type RuntimePocErrorCode = "module-load-failed" | RuntimePocBootstrapFailureCode;

declare global {
  // The POC exposes only non-sensitive lifecycle evidence for browser assertions.
  var __spotpatchRuntimePoc__: RuntimePocState | undefined;
}

const startedAt = performance.now();
const hookInstalled =
  typeof Reflect.get(globalThis, "__REACT_DEVTOOLS_GLOBAL_HOOK__") === "object";
const state: RuntimePocState = {
  hookInstalled,
  initializationDurationMs: performance.now() - startedAt,
  status: "bootstrapping",
};

globalThis.__spotpatchRuntimePoc__ = state;

void import("./runtime-poc-bootstrap.js")
  .then(({ bootstrapRuntimePoc }) => bootstrapRuntimePoc())
  .then((result) => {
    if (result.ok) {
      state.status = "ready";
      return;
    }

    state.errorCode = result.errorCode;
    state.status = "failed";
  })
  .catch(() => {
    state.errorCode = "module-load-failed";
    state.status = "failed";
  });
