import { describe, expect, it } from "vitest";

import { formatSourceMarker, parseSourceMarker } from "./source-marker.js";

describe("source marker", () => {
  it("round-trips Astro while keeping legacy markers unchanged", () => {
    const marker = { fileId: "opaque", line: 2, column: 3, kind: "astro" as const };
    expect(formatSourceMarker(marker)).toBe("opaque:2:3:astro");
    expect(parseSourceMarker(formatSourceMarker(marker))).toEqual(marker);
    expect(parseSourceMarker("opaque:2:3:vue")).toBeUndefined();
  });
  it("round-trips a valid marker", () => {
    const marker = Object.freeze({ fileId: "Q7k3pA9vL2s", line: 36, column: 5 });

    expect(parseSourceMarker(formatSourceMarker(marker))).toEqual(marker);
  });

  it.each([null, "", "file:0:1", "file:1:0", "file:one:2", "/tmp/a.tsx:1:2"])(
    "rejects an invalid marker: %s",
    (value) => {
      expect(parseSourceMarker(value)).toBeUndefined();
    },
  );
});
