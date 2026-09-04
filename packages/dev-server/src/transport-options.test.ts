import { describe, expect, it } from "vitest";

import { resolveOptions } from "./options.js";
import {
  parseSerializedSpotPatchOptions,
  serializeResolvedSpotPatchOptions,
} from "./transport-options.js";

describe("SpotPatch options transport", () => {
  it("round-trips resolved filters and AI without credentials", () => {
    const resolved = resolveOptions({
      include: [/src[/\\].+\.tsx$/u, "app/**/*.tsx"],
      ai: {
        baseURL: "https://relay.example/v1",
        model: "provider-model",
      },
      dataFlow: { runtime: "dispatch" },
      externalAgent: true,
      contextualAsk: { defaultExecutor: { kind: "managed-codex" } },
    });
    const serialized = serializeResolvedSpotPatchOptions(resolved);
    const parsed = parseSerializedSpotPatchOptions(serialized);

    expect(parsed).toEqual(resolved);
    expect(parsed.externalAgent).toEqual({ enabled: true });
    expect(parsed.contextualAsk).toEqual({
      enabled: true,
      defaultExecutor: { kind: "managed-codex" },
    });
    expect(JSON.stringify(serialized)).not.toContain("credential");
  });

  it("rejects unknown fields and malformed regular expressions", () => {
    const serialized = serializeResolvedSpotPatchOptions(resolveOptions());

    expect(() =>
      parseSerializedSpotPatchOptions({ ...serialized, root: "/private/project" }),
    ).toThrow(TypeError);
    expect(() =>
      parseSerializedSpotPatchOptions({
        ...serialized,
        include: [{ kind: "regexp", source: "[", flags: "u" }],
      }),
    ).toThrow(TypeError);
  });
});
