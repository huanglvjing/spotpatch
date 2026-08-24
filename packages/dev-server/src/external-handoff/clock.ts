import { performance } from "node:perf_hooks";

export interface ExternalHandoffClock {
  readonly monotonicNow: () => number;
  readonly wallNow: () => number;
}

export const SYSTEM_EXTERNAL_HANDOFF_CLOCK: ExternalHandoffClock = Object.freeze({
  monotonicNow: () => performance.now(),
  wallNow: () => Date.now(),
});
