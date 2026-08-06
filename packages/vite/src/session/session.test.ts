import { describe, expect, it } from "vitest";

import { createSession } from "./session.js";

describe("createSession", () => {
  it("creates a fresh token with at least 128 bits of entropy", () => {
    const first = createSession();
    const second = createSession();

    expect(Buffer.from(first.token, "base64url")).toHaveLength(16);
    expect(second.token).not.toBe(first.token);
    expect(Object.isFrozen(first)).toBe(true);
  });
});
