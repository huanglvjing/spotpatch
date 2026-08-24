import type { ExternalHandoffPublishRequest } from "@spotpatch/shared";
import { describe, expect, it } from "vitest";

import { fingerprintExternalHandoffAnnotation } from "./fingerprint.js";

function annotation(): ExternalHandoffPublishRequest["annotation"] {
  return {
    schemaVersion: 3,
    id: "annotation-id",
    locale: "en-US",
    page: {
      url: "http://127.0.0.1:5173/",
      pathname: "/",
      title: "Fixture",
      viewportWidth: 100,
      viewportHeight: 100,
      devicePixelRatio: 1,
    },
    targets: [
      {
        instruction: "Update it.",
        source: { origin: "none", confidence: "unknown" },
        react: { supported: false, componentStack: [] },
        element: {
          tagName: "div",
          selector: "div",
          sanitizedHtml: "<div></div>",
          rect: { x: 0, y: 0, width: 1, height: 1 },
        },
        styles: {
          classNames: [],
          matchedRules: [],
          computed: { color: "black", display: "block" },
          warnings: [],
        },
        warnings: [],
      },
    ],
    createdAt: "2026-08-23T00:00:00.000Z",
  };
}

describe("external handoff fingerprint", () => {
  it("uses sorted recursive JSON keys and SHA-256", () => {
    const first = annotation();
    const reverseKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reverseKeys);
      if (value !== null && typeof value === "object") {
        return Object.fromEntries(
          Object.entries(value as Readonly<Record<string, unknown>>)
            .reverse()
            .map(([key, entry]) => [key, reverseKeys(entry)]),
        );
      }
      return value;
    };
    const same = reverseKeys(first) as ExternalHandoffPublishRequest["annotation"];

    expect(fingerprintExternalHandoffAnnotation(first)).toMatch(/^[a-f0-9]{64}$/u);
    expect(fingerprintExternalHandoffAnnotation(same)).toBe(
      fingerprintExternalHandoffAnnotation(first),
    );
  });

  it("changes when annotation content changes", () => {
    const first = annotation();
    const changed = {
      ...first,
      targets: [{ ...first.targets[0], instruction: "A different change." }],
    } as ExternalHandoffPublishRequest["annotation"];

    expect(fingerprintExternalHandoffAnnotation(changed)).not.toBe(
      fingerprintExternalHandoffAnnotation(first),
    );
  });
});
