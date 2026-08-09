import "bippy/install-hook-only";

import type { NextClientBootstrapFailureCode } from "./client/bootstrap.js";

interface NextClientState {
  code?: NextClientBootstrapFailureCode | "MODULE_LOAD_FAILED";
  readonly hookInstalled: boolean;
  readonly initializationDurationMs: number;
  status: "bootstrapping" | "failed" | "ready";
}

declare global {
  var __spotpatchNextClient__: NextClientState | undefined;
}

if (globalThis.__spotpatchNextClient__ === undefined) {
  const startedAt = performance.now();
  const state: NextClientState = {
    hookInstalled:
      typeof Reflect.get(globalThis, "__REACT_DEVTOOLS_GLOBAL_HOOK__") === "object",
    initializationDurationMs: performance.now() - startedAt,
    status: "bootstrapping",
  };
  globalThis.__spotpatchNextClient__ = state;

  void import("./client/bootstrap.js")
    .then(({ bootstrapNextClient }) => bootstrapNextClient())
    .then((result) => {
      if (result.ok) {
        state.status = "ready";
        return;
      }

      state.code = result.code;
      state.status = "failed";
      console.warn(`[spotpatch:next:client] Bootstrap disabled (${result.code}).`);
    })
    .catch(() => {
      state.code = "MODULE_LOAD_FAILED";
      state.status = "failed";
      console.warn("[spotpatch:next:client] Bootstrap disabled (MODULE_LOAD_FAILED).");
    });
}
