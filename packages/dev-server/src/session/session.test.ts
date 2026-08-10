import { describe, expect, it } from "vitest";

import { createSession } from "./session.js";

describe("createSession", () => {
  it("creates distinct session identities and tokens with 128 bits of entropy", () => {
    const first = createSession();
    const second = createSession();

    expect(Buffer.from(first.id, "base64url")).toHaveLength(16);
    expect(Buffer.from(first.token, "base64url")).toHaveLength(16);
    expect(first.id).not.toBe(first.token);
    expect(second.id).not.toBe(first.id);
    expect(second.token).not.toBe(first.token);
    expect(Object.isFrozen(first)).toBe(true);
  });
});
