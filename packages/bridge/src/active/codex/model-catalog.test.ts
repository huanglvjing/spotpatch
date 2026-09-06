import { describe, expect, it, vi } from "vitest";
import { readCodexModelCatalog } from "./model-catalog.js";

const errors = {
  protocolError: () => new Error("protocol"),
  unavailableError: () => new Error("unavailable"),
};

describe("Codex model catalog", () => {
  it("reads all pages, deduplicates models, and preserves later default evidence", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ model: "first", isDefault: false }],
        nextCursor: "next",
      })
      .mockResolvedValueOnce({
        data: [
          { model: "first", isDefault: true },
          {
            model: "second",
            isDefault: false,
            supportedReasoningEfforts: [{ reasoningEffort: "low" }],
          },
        ],
        nextCursor: null,
      });
    await expect(
      readCodexModelCatalog({ ...errors, request, preferredReasoningEffort: "low" }),
    ).resolves.toEqual([
      { model: "first", isDefault: true },
      { model: "second", isDefault: false, reasoningEffort: "low" },
    ]);
    expect(request).toHaveBeenNthCalledWith(2, {
      cursor: "next",
      limit: 100,
      includeHidden: false,
    });
  });

  it.each([
    { data: [{ model: " valid", isDefault: true }], nextCursor: null },
    { data: [{ model: "a", isDefault: "true" }], nextCursor: null },
    { data: [{ model: "a", isDefault: true }], nextCursor: "" },
    {
      data: [{ model: "a", isDefault: true, supportedReasoningEfforts: {} }],
      nextCursor: null,
    },
    {
      data: Array.from({ length: 101 }, () => ({ model: "a", isDefault: true })),
      nextCursor: null,
    },
  ])("rejects malformed or oversized pages: %#", async (value) => {
    await expect(
      readCodexModelCatalog({ ...errors, request: () => Promise.resolve(value) }),
    ).rejects.toThrow("protocol");
  });

  it("rejects cycles even when the first page already has a default", async () => {
    const request = vi.fn().mockResolvedValue({
      data: [{ model: "a", isDefault: true }],
      nextCursor: "same",
    });
    await expect(readCodexModelCatalog({ ...errors, request })).rejects.toThrow(
      "protocol",
    );
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("distinguishes an empty catalog and enforces caller capacity", async () => {
    await expect(
      readCodexModelCatalog({
        ...errors,
        request: () => Promise.resolve({ data: [], nextCursor: null }),
      }),
    ).rejects.toThrow("unavailable");
    await expect(
      readCodexModelCatalog({
        ...errors,
        maximumModels: 1,
        request: () =>
          Promise.resolve({
            data: [
              { model: "a", isDefault: true },
              { model: "b", isDefault: false },
            ],
            nextCursor: null,
          }),
      }),
    ).rejects.toThrow("protocol");
  });
});
