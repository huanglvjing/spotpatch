import { describe, expect, it } from "vitest";

import { elementInstanceContextSchema } from "./context-schema.js";
import { ELEMENT_INSTANCE_LIMITS } from "./element-instance.js";

const instance = {
  id: "capture_card_3",
  state: "captured",
  selectorStatus: "unique-at-capture",
  label: "Product 3",
  context: "<article>Product 3</article>",
};

describe("instance protocol boundary", () => {
  it("accepts bounded historical evidence without accepting arbitrary framework props or paths", () => {
    expect(elementInstanceContextSchema.parse(instance)).toEqual(instance);
    for (const patch of [
      { id: "../../private" },
      { state: "live-business-record" },
      { selectorStatus: "permanent" },
      { props: { secret: "hidden" } },
      { context: "x".repeat(ELEMENT_INSTANCE_LIMITS.contextCharacters + 1) },
    ]) {
      expect(
        elementInstanceContextSchema.safeParse({ ...instance, ...patch }).success,
      ).toBe(false);
    }
  });
});
