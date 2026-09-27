import { describe, expect, it } from "vitest";
import { ContextualAskExecutorError } from "@spotpatch/agent";

import { ASK_ANSWER_WIRE_SCHEMA, parseAskAnswerWire } from "./ask-answer-wire.js";

const CITATION = Object.freeze({ handleId: "source_handle", startLine: 1, endLine: 2 });

describe("Ask answer wire format", () => {
  it("uses the strict structured-output subset without union keywords", () => {
    const serialized = JSON.stringify(ASK_ANSWER_WIRE_SCHEMA);
    expect(serialized).not.toContain('"oneOf"');
    expect(serialized).not.toContain('"anyOf"');
    expect(serialized).toContain('"listItems"');
  });

  it("converts flat wire blocks into answer blocks", () => {
    expect(
      parseAskAnswerWire({
        blocks: [
          {
            kind: "paragraph",
            text: "Renders the card.",
            listItems: [],
            code: null,
            language: null,
            citations: [CITATION],
          },
          {
            kind: "list",
            text: null,
            listItems: [{ text: "Reads props.", citations: [CITATION] }],
            code: null,
            language: null,
            citations: [],
          },
          {
            kind: "code",
            text: null,
            listItems: [],
            code: "<Card />",
            language: null,
            citations: [CITATION],
          },
        ],
        warnings: [],
      }),
    ).toEqual({
      blocks: [
        { kind: "paragraph", text: "Renders the card.", citations: [CITATION] },
        { kind: "list", items: [{ text: "Reads props.", citations: [CITATION] }] },
        { kind: "code", code: "<Card />", citations: [CITATION] },
      ],
      warnings: [],
    });
  });

  it("rejects blocks whose unused fields are populated", () => {
    let failure: unknown;
    try {
      parseAskAnswerWire({
        blocks: [
          {
            kind: "paragraph",
            text: "Mixed block.",
            listItems: [],
            code: "leaked",
            language: null,
            citations: [],
          },
        ],
        warnings: [],
      });
    } catch (error: unknown) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ContextualAskExecutorError);
    expect(failure).toMatchObject({ code: "ASK_ANSWER_INVALID" });
  });
});
