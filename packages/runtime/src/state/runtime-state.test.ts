import { describe, expect, it } from "vitest";

import {
  INITIAL_RUNTIME_STATE,
  reduceRuntimeState,
  type RuntimeEvent,
  type RuntimeStatus,
} from "./runtime-state.js";

function transition(status: RuntimeStatus, type: RuntimeEvent["type"]): RuntimeStatus {
  return reduceRuntimeState({ status }, { type }).status;
}

describe("runtime state reducer", () => {
  it.each([
    ["idle", "ACTIVATE", "inspecting"],
    ["inspecting", "HOVER", "inspecting"],
    ["inspecting", "SELECT", "selected"],
    ["inspecting", "CANCEL", "idle"],
    ["selected", "ADD_NOTE", "annotating"],
    ["selected", "RESELECT", "inspecting"],
    ["selected", "CLOSE", "idle"],
    ["selected", "PREVIEW", "previewing"],
    ["selected", "OPEN_EDITOR", "selected"],
    ["annotating", "SAVE", "selected"],
    ["annotating", "CANCEL_NOTE", "selected"],
    ["previewing", "COPY_SUCCESS", "selected"],
    ["previewing", "COPY_FAILURE", "previewing"],
    ["previewing", "BACK", "selected"],
  ] as const)("moves %s through %s to %s", (from, event, to) => {
    expect(transition(from, event)).toBe(to);
  });

  it("ignores events that are invalid for the current state", () => {
    expect(transition("idle", "SELECT")).toBe("idle");
    expect(transition("inspecting", "PREVIEW")).toBe("inspecting");
    expect(transition("selected", "SAVE")).toBe("selected");
    expect(transition("annotating", "ACTIVATE")).toBe("annotating");
    expect(transition("previewing", "OPEN_EDITOR")).toBe("previewing");
  });

  it("starts idle with an immutable state object", () => {
    expect(INITIAL_RUNTIME_STATE).toEqual({ status: "idle" });
    expect(Object.isFrozen(INITIAL_RUNTIME_STATE)).toBe(true);
  });
});
