import { describe, expect, it } from "vitest";

import { createNextDataFlowObservationPolicy } from "./data-flow-policy.js";

describe("Next data-flow observation policy", () => {
  it("excludes Next RSC transports without hiding business requests", () => {
    const shouldObserveFetch = createNextDataFlowObservationPolicy().shouldObserveFetch;

    if (shouldObserveFetch === undefined) {
      throw new Error("Expected the Next fetch observation policy.");
    }

    expect(
      shouldObserveFetch(
        "/dashboard",
        { headers: { RSC: "1" } },
        "https://example.test/account",
      ),
    ).toBe(false);
    expect(
      shouldObserveFetch(
        new Request("https://example.test/dashboard", {
          headers: { "Next-Router-Prefetch": "1" },
        }),
        undefined,
        "https://example.test/account",
      ),
    ).toBe(false);
    expect(
      shouldObserveFetch(
        "/dashboard?_rsc=opaque",
        undefined,
        "https://example.test/account",
      ),
    ).toBe(false);
    expect(
      shouldObserveFetch(
        "/api/users?accountId=redacted",
        undefined,
        "https://example.test/account",
      ),
    ).toBe(true);
    expect(
      shouldObserveFetch(
        "https://api.example.test/users?_rsc=business-key",
        undefined,
        "https://example.test/account",
      ),
    ).toBe(true);
  });
});
