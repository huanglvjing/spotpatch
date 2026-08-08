import launchEditor from "launch-editor";
import { afterEach, describe, expect, it, vi } from "vitest";

import { launchConfiguredEditor } from "./editor.js";

vi.mock("launch-editor", () => ({ default: vi.fn() }));

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(launchEditor).mockReset();
});

describe("configured editor launcher", () => {
  it.each([
    ["auto", undefined],
    ["vscode", "code"],
    ["cursor", "cursor"],
  ] as const)("maps %s to a restricted launch command", async (editor, command) => {
    vi.useFakeTimers();
    const pending = launchConfiguredEditor("/project/src/App.tsx:12:4", editor);

    expect(launchEditor).toHaveBeenCalledWith(
      "/project/src/App.tsx:12:4",
      command,
      expect.any(Function),
    );

    await vi.advanceTimersByTimeAsync(150);
    await expect(pending).resolves.toBeUndefined();
  });

  it("rejects an editor startup error before reporting success", async () => {
    vi.mocked(launchEditor).mockImplementation((_target, _editor, onError) => {
      onError?.("/project/src/App.tsx", "command not found");
    });

    await expect(
      launchConfiguredEditor("/project/src/App.tsx:12:4", "cursor"),
    ).rejects.toThrow("configured editor could not be started");
  });
});
