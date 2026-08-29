// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createExecutionIsland } from "./execution-island.js";
import type { FloatingSurfaceProjection } from "./motion-extension-contract.js";

function projection(
  overrides: Partial<FloatingSurfaceProjection> = {},
): FloatingSurfaceProjection {
  return Object.freeze({
    scene: "running",
    tone: "running",
    headline: "Codex is modifying code",
    action: "Reading src/fixtures.tsx",
    meta: "Running",
    activity: Object.freeze({
      key: "read:src/fixtures.tsx",
      label: "read · src/fixtures.tsx",
      state: "active",
    }),
    recentActivities: Object.freeze([]),
    ...overrides,
  });
}

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({ matches: false }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("execution island", () => {
  it("shows elapsed time only when the running job has a real start timestamp", () => {
    vi.useFakeTimers();
    let now = Date.parse("2026-08-29T10:00:08.000Z");
    const island = createExecutionIsland(document, () => now);
    document.body.append(island.elements.root);

    island.render(projection({ startedAt: "2026-08-29T10:00:00.000Z" }));

    expect(island.elements.timer.hidden).toBe(false);
    expect(island.elements.timer.textContent).toBe("00:08");

    now += 1_000;
    vi.advanceTimersByTime(1_000);
    expect(island.elements.timer.textContent).toBe("00:09");

    island.render(projection({ scene: "success", tone: "success" }));
    expect(island.elements.timer.hidden).toBe(true);
    expect(island.elements.meta.textContent).toContain("Running");
    island.dispose();
  });

  it("updates the activity lane from projections without inventing progress", () => {
    const island = createExecutionIsland(document);
    document.body.append(island.elements.root);

    island.render(projection());
    expect(island.elements.activityLabel.textContent).toBe("read · src/fixtures.tsx");
    expect(island.elements.root.textContent).not.toMatch(/\d+%/u);

    island.render(
      projection({
        action: "Running TypeScript",
        activity: Object.freeze({
          key: "check:typecheck",
          label: "check · TypeScript",
          state: "active",
        }),
        recentActivities: Object.freeze([
          {
            key: "read:src/fixtures.tsx",
            label: "read · src/fixtures.tsx",
            state: "success",
          },
          {
            key: "check:typecheck",
            label: "check · TypeScript",
            state: "active",
          },
        ]),
      }),
    );

    expect(island.elements.activityLabel.textContent).toBe("check · TypeScript");
    expect(island.elements.recent.children).toHaveLength(2);
    expect(island.elements.recent.hidden).toBe(false);
    island.dispose();
  });
});
