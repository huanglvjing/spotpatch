// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createFloatingSurfaceSession } from "./floating-surface-session.js";

const sessionId = "floating-surface-test";
const storageKey = `spotpatch:floating-surface:${sessionId}`;

afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("floating surface session", () => {
  it("round-trips a bounded position within one session", () => {
    const session = createFloatingSurfaceSession(window, sessionId);
    const position = Object.freeze({
      horizontal: "start" as const,
      vertical: "end" as const,
      xRatio: 0.25,
      yRatio: 0.75,
    });

    session.save(position);

    expect(session.load()).toEqual(position);
  });

  it("rejects malformed, out-of-range, and unknown-version snapshots", () => {
    const session = createFloatingSurfaceSession(window, sessionId);

    for (const value of [
      "not json",
      JSON.stringify({
        version: 1,
        horizontal: "start",
        vertical: "end",
        xRatio: Number.NaN,
        yRatio: 0,
      }),
      JSON.stringify({
        version: 1,
        horizontal: "start",
        vertical: "end",
        xRatio: 1.1,
        yRatio: 0,
      }),
      JSON.stringify({
        version: 2,
        horizontal: "start",
        vertical: "end",
        xRatio: 0,
        yRatio: 0,
      }),
    ]) {
      window.sessionStorage.setItem(storageKey, value);
      expect(session.load()).toBeUndefined();
    }
  });

  it("isolates stored positions by session id", () => {
    const first = createFloatingSurfaceSession(window, "first");
    const second = createFloatingSurfaceSession(window, "second");

    first.save({ horizontal: "end", vertical: "end", xRatio: 1, yRatio: 1 });

    expect(second.load()).toBeUndefined();
    expect(first.load()).toMatchObject({ xRatio: 1, yRatio: 1 });
  });

  it("keeps the UI usable when storage writes fail", () => {
    const setItem = vi.fn(() => {
      throw new Error("Storage disabled");
    });
    const unavailableWindow = {
      sessionStorage: {
        getItem: () => null,
        removeItem: () => {
          return undefined;
        },
        setItem,
      },
    } as unknown as Window;
    const session = createFloatingSurfaceSession(unavailableWindow, sessionId);

    expect(() => {
      session.save({ horizontal: "end", vertical: "end", xRatio: 1, yRatio: 1 });
    }).not.toThrow();
    expect(setItem).toHaveBeenCalledOnce();
  });
});
