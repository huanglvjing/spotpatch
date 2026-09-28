import { describe, expect, it, vi } from "vitest";

import { createContextualAskApi } from "./contextual-ask-api.js";

function pendingFetch() {
  const signals: AbortSignal[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
    const signal = init?.signal;
    if (signal instanceof AbortSignal) signals.push(signal);
    return new Promise<Response>(() => undefined);
  });
  return { fetch, signals };
}

describe("Contextual Ask API", () => {
  it("keeps capability loading when a question is cancelled and aborts it on dispose", () => {
    const { fetch, signals } = pendingFetch();
    const api = createContextualAskApi({ fetch, sessionToken: "session-token" });

    void api.capability().catch(() => undefined);
    void api.result("job_1").catch(() => undefined);
    const [capabilitySignal, resultSignal] = signals;

    api.cancelPending();
    expect(resultSignal?.aborted).toBe(true);
    expect(capabilitySignal?.aborted).toBe(false);

    api.dispose();
    expect(capabilitySignal?.aborted).toBe(true);
  });
});
