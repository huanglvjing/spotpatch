import { describe, expect, it } from "vitest";

import { openEditorRequestSchema, sourceContextRequestSchema } from "./requests.js";

describe("protocol request schemas", () => {
  it("accepts source identifiers and positive coordinates", () => {
    expect(
      sourceContextRequestSchema.safeParse({
        fileId: "Q7k3pA9vL2s",
        line: 36,
        column: 5,
        maxLines: 80,
      }).success,
    ).toBe(true);
  });

  it("rejects path and command fields", () => {
    expect(
      openEditorRequestSchema.safeParse({
        fileId: "Q7k3pA9vL2s",
        line: 36,
        column: 5,
        absolutePath: "/tmp/private.tsx",
        command: "code",
      }).success,
    ).toBe(false);
  });
});
