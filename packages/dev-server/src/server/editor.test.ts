import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createEditorLauncher,
  detectIntegratedEditor,
  type EditorLaunchDependencies,
} from "./editor.js";

interface ProcessDouble {
  readonly emitError: () => void;
  readonly emitExit: (code: number | null, signal?: NodeJS.Signals | null) => void;
  readonly process: ReturnType<EditorLaunchDependencies["processSpawner"]>;
}

function createProcessDouble(): ProcessDouble {
  const emitter = new EventEmitter();
  const process = {
    once(event: string, listener: (...arguments_: unknown[]) => void) {
      emitter.once(event, listener);
      return process;
    },
  } as ReturnType<EditorLaunchDependencies["processSpawner"]>;

  return {
    process,
    emitError: () => {
      emitter.emit("error", new Error("command not found"));
    },
    emitExit: (code, signal = null) => {
      emitter.emit("exit", code, signal);
    },
  };
}

function createDependencies(
  environment: Readonly<NodeJS.ProcessEnv> = Object.freeze({}),
): {
  readonly dependencies: EditorLaunchDependencies;
  readonly fallbackLauncher: ReturnType<typeof vi.fn>;
  readonly processDouble: ProcessDouble;
  readonly processSpawner: ReturnType<typeof vi.fn>;
} {
  const processDouble = createProcessDouble();
  const fallbackLauncher = vi.fn();
  const processSpawner = vi.fn(() => processDouble.process);

  return {
    dependencies: {
      environment,
      fallbackLauncher,
      processSpawner,
      startupGraceMs: 300,
    },
    fallbackLauncher,
    processDouble,
    processSpawner,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("integrated editor detection", () => {
  it("prefers the Cursor executable signal over the generic vscode terminal name", () => {
    expect(
      detectIntegratedEditor({
        TERM_PROGRAM: "vscode",
        VSCODE_GIT_ASKPASS_NODE:
          "/Applications/Cursor.app/Contents/Frameworks/Cursor Helper.app",
      }),
    ).toBe("cursor");
  });

  it.each([
    [{ TERM_PROGRAM: "cursor" }, "cursor"],
    [{ VSCODE_GIT_ASKPASS_NODE: "/usr/share/code/code" }, "vscode"],
    [
      { VSCODE_GIT_ASKPASS_NODE: "C:\\Program Files\\Microsoft VS Code\\Code.exe" },
      "vscode",
    ],
    [{ TERM_PROGRAM: "WarpTerminal" }, undefined],
  ] as const)("detects only controlled editor signals", (environment, expected) => {
    expect(detectIntegratedEditor(environment)).toBe(expected);
  });
});

describe("configured editor launcher", () => {
  it.each([
    ["cursor", "cursor"],
    ["vscode", "code"],
  ] as const)(
    "opens %s by workspace affinity without forcing the last active window",
    async (editor, command) => {
      const { dependencies, processDouble, processSpawner } = createDependencies();
      const launch = createEditorLauncher(dependencies);
      const pending = launch("/project/src/App.tsx:12:4", editor);

      expect(processSpawner).toHaveBeenCalledWith(
        command,
        ["--goto", "/project/src/App.tsx:12:4"],
        expect.objectContaining({ stdio: "ignore", windowsHide: true }),
      );
      expect(processSpawner.mock.calls[0]?.[1]).not.toContain("--reuse-window");

      processDouble.emitExit(0);
      await expect(pending).resolves.toBe(editor);
    },
  );

  it("routes auto to the Cursor workspace that owns the Vite terminal", async () => {
    const environment = Object.freeze({
      TERM_PROGRAM: "vscode",
      VSCODE_GIT_ASKPASS_NODE:
        "/Applications/Cursor.app/Contents/Frameworks/Cursor Helper.app",
    });
    const { dependencies, processDouble, processSpawner } =
      createDependencies(environment);
    const pending = createEditorLauncher(dependencies)(
      "/project/src/App.tsx:12:4",
      "auto",
    );

    expect(processSpawner).toHaveBeenCalledWith(
      "cursor",
      ["--goto", "/project/src/App.tsx:12:4"],
      expect.objectContaining({ env: environment }),
    );

    processDouble.emitExit(0);
    await expect(pending).resolves.toBe("cursor");
  });

  it("uses bounded legacy detection only when no integrated editor is known", async () => {
    vi.useFakeTimers();
    const { dependencies, fallbackLauncher, processSpawner } = createDependencies({
      TERM_PROGRAM: "WarpTerminal",
    });
    const pending = createEditorLauncher(dependencies)(
      "/project/src/App.tsx:12:4",
      "auto",
    );

    expect(fallbackLauncher).toHaveBeenCalledWith(
      "/project/src/App.tsx:12:4",
      undefined,
      expect.any(Function),
    );
    expect(processSpawner).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(300);
    await expect(pending).resolves.toBe("auto");
  });

  it("rejects an immediate fallback detection error", async () => {
    const { dependencies, fallbackLauncher } = createDependencies({
      TERM_PROGRAM: "WarpTerminal",
    });
    fallbackLauncher.mockImplementation(
      (_target: string, _editor: string | undefined, onError: () => void) => {
        onError();
      },
    );

    await expect(
      createEditorLauncher(dependencies)("/project/src/App.tsx:12:4", "auto"),
    ).rejects.toThrow("configured editor could not be started");
  });

  it("accepts a running editor command after the bounded startup window", async () => {
    vi.useFakeTimers();
    const { dependencies } = createDependencies();
    const pending = createEditorLauncher(dependencies)(
      "/project/src/App.tsx:12:4",
      "cursor",
    );

    await vi.advanceTimersByTimeAsync(300);
    await expect(pending).resolves.toBe("cursor");
  });

  it.each(["error", "exit"] as const)(
    "rejects a command %s before reporting success",
    async (failure) => {
      const { dependencies, processDouble } = createDependencies();
      const pending = createEditorLauncher(dependencies)(
        "/project/src/App.tsx:12:4",
        "cursor",
      );

      if (failure === "error") {
        processDouble.emitError();
      } else {
        processDouble.emitExit(1);
      }

      await expect(pending).rejects.toThrow("configured editor could not be started");
    },
  );
});
