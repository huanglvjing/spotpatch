import { ERROR_CODES, SpotPatchError } from "@spotpatch/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { serveClaudeChannelMcp } from "./active/claude/index.js";
import {
  CODEX_ADAPTER_ERROR_CODES,
  CodexAdapterError,
  connectCodexAppServer,
} from "./active/codex/index.js";
import { createActiveEventPump } from "./active/event-pump.js";
import { createSpotPatchBridgeClient } from "./client.js";
import { runSpotPatchBridgeCli } from "./cli-runner.js";
import { resolveExactProjectSessionId } from "./discovery.js";
import { serveSpotPatchMcp } from "./mcp.js";

vi.mock("./active/claude/index.js", () => ({
  serveClaudeChannelMcp: vi.fn(),
}));
vi.mock("./active/codex/index.js", async (importOriginal) => ({
  ...(await importOriginal()),
  connectCodexAppServer: vi.fn(),
}));
vi.mock("./active/event-pump.js", async (importOriginal) => ({
  ...(await importOriginal()),
  createActiveEventPump: vi.fn(),
}));
vi.mock("./client.js", async (importOriginal) => ({
  ...(await importOriginal()),
  createSpotPatchBridgeClient: vi.fn(),
}));
vi.mock("./discovery.js", async (importOriginal) => ({
  ...(await importOriginal()),
  resolveExactProjectSessionId: vi.fn(),
}));
vi.mock("./mcp.js", async (importOriginal) => ({
  ...(await importOriginal()),
  serveSpotPatchMcp: vi.fn(),
}));

function output() {
  let value = "";

  return {
    stream: {
      write(chunk: string) {
        value += chunk;
        return true;
      },
    },
    value: () => value,
  };
}

describe("SpotPatch bridge CLI", () => {
  beforeEach(() => {
    vi.mocked(serveClaudeChannelMcp).mockReset();
    vi.mocked(connectCodexAppServer).mockReset();
    vi.mocked(createActiveEventPump).mockReset();
    vi.mocked(createSpotPatchBridgeClient).mockReset();
    vi.mocked(resolveExactProjectSessionId).mockReset();
    vi.mocked(serveSpotPatchMcp).mockReset();
    vi.mocked(resolveExactProjectSessionId).mockImplementation((_cwd, requested) =>
      Promise.resolve(requested ?? "exact-session"),
    );
  });

  it("uses the documented no-session exit code with stable JSON output", async () => {
    vi.mocked(createSpotPatchBridgeClient).mockReturnValue({
      sessions: vi.fn().mockResolvedValue([]),
    } as never);
    const stdout = output();
    const stderr = output();

    await expect(
      runSpotPatchBridgeCli(["sessions", "--json"], {
        cwd: "/project",
        stdout: stdout.stream,
        stderr: stderr.stream,
      }),
    ).resolves.toBe(3);
    expect(JSON.parse(stdout.value())).toEqual({
      schemaVersion: 1,
      command: "sessions",
      data: { outcome: "sessions", sessions: [] },
    });
    expect(stderr.value()).toBe("");
  });

  it("returns success when at least one project session is active", async () => {
    vi.mocked(createSpotPatchBridgeClient).mockReturnValue({
      sessions: vi.fn().mockResolvedValue([
        {
          sessionId: "0123456789abcdef012345",
          framework: "vite",
          startedAt: "2026-08-23T00:00:00.000Z",
          snapshotAvailable: false,
        },
      ]),
    } as never);
    const stdout = output();

    await expect(
      runSpotPatchBridgeCli(["sessions"], {
        cwd: "/project",
        stdout: stdout.stream,
        stderr: output().stream,
      }),
    ).resolves.toBe(0);
    expect(stdout.value()).toContain("1 active session(s)");
  });

  it("previews a project setup without reading files or printing the absolute root", async () => {
    const stdout = output();
    const projectRoot = "/private/project-root";

    await expect(
      runSpotPatchBridgeCli(["setup", "--client", "cursor", "--scope", "project"], {
        cwd: projectRoot,
        stdout: stdout.stream,
        stderr: output().stream,
      }),
    ).resolves.toBe(0);
    expect(stdout.value()).toContain("dry-run: .cursor/mcp.json");
    expect(stdout.value()).toContain('"command": "node"');
    expect(stdout.value()).not.toContain(projectRoot);
  });

  it("previews the explicit Claude active setup and rejects unsupported active clients", async () => {
    const stdout = output();

    await expect(
      runSpotPatchBridgeCli(
        ["setup", "--client", "claude", "--scope", "project", "--mode", "active"],
        {
          adapter: "next",
          cwd: "/private/project-root",
          stdout: stdout.stream,
          stderr: output().stream,
        },
      ),
    ).resolves.toBe(0);
    expect(stdout.value()).toContain('"channel"');
    expect(stdout.value()).toContain('"claude"');

    await expect(
      runSpotPatchBridgeCli(["setup", "--client", "cursor", "--mode", "active"], {
        cwd: "/project",
        stdout: output().stream,
        stderr: output().stream,
      }),
    ).resolves.toBe(2);
  });

  it("rejects duplicate options instead of silently choosing one", async () => {
    const stderr = output();

    await expect(
      runSpotPatchBridgeCli(["current", "--session", "first", "--session", "second"], {
        stdout: output().stream,
        stderr: stderr.stream,
      }),
    ).resolves.toBe(2);
    expect(stderr.value()).toBe("[spotpatch:bridge] INVALID_REQUEST\n");
  });

  it("runs the Claude Channel until its stdio lifecycle completes", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    vi.mocked(serveClaudeChannelMcp).mockResolvedValue({
      close,
      done: Promise.resolve(),
      host: {},
    } as never);
    const stdout = output();
    const stderr = output();

    await expect(
      runSpotPatchBridgeCli(["channel", "claude", "--session", "session-1"], {
        cwd: "/project",
        stdout: stdout.stream,
        stderr: stderr.stream,
      }),
    ).resolves.toBe(0);
    expect(serveClaudeChannelMcp).toHaveBeenCalledWith({
      cwd: "/project",
      sessionId: "session-1",
    });
    expect(resolveExactProjectSessionId).toHaveBeenCalledWith("/project", "session-1");
    expect(close).toHaveBeenCalledOnce();
    expect(stdout.value()).toBe("");
    expect(stderr.value()).toBe("");
  });

  it("binds an internal MCP process to the explicitly selected Session", async () => {
    await expect(
      runSpotPatchBridgeCli(["mcp", "--session", "session-1"], {
        cwd: "/project",
        stdout: output().stream,
        stderr: output().stream,
      }),
    ).resolves.toBe(0);

    expect(resolveExactProjectSessionId).toHaveBeenCalledWith("/project", "session-1");
    expect(serveSpotPatchMcp).toHaveBeenCalledOnce();
    expect(serveSpotPatchMcp).toHaveBeenCalledWith("/project", {
      sessionId: "session-1",
    });
  });

  it("requires explicit Codex workspace-write consent and runs one shared pump", async () => {
    const adapter = { kind: "codex-app-server" };
    const pump = {
      run: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(connectCodexAppServer).mockResolvedValue(adapter as never);
    vi.mocked(createActiveEventPump).mockReturnValue(pump);
    vi.mocked(createSpotPatchBridgeClient).mockReturnValue({} as never);
    const stderr = output();

    await expect(
      runSpotPatchBridgeCli(["connect", "codex"], {
        cwd: "/project",
        stdout: output().stream,
        stderr: output().stream,
      }),
    ).resolves.toBe(2);
    await expect(
      runSpotPatchBridgeCli(
        ["connect", "codex", "--allow-workspace-write", "--session", "session-1"],
        {
          cwd: "/project",
          stdout: output().stream,
          stderr: stderr.stream,
        },
      ),
    ).resolves.toBe(0);

    expect(connectCodexAppServer).toHaveBeenCalledWith(
      expect.objectContaining({
        allowWorkspaceWrite: true,
        bridgeAdapter: "bridge",
        projectRoot: "/project",
        sessionId: "session-1",
      }),
    );
    expect(resolveExactProjectSessionId).toHaveBeenCalledWith("/project", "session-1");
    const pumpOptions = vi.mocked(createActiveEventPump).mock.calls[0]?.[0];
    expect(pumpOptions?.adapter).toBe(adapter);
    expect(pumpOptions?.client).toBeDefined();
    expect(pumpOptions?.sessionId).toBe("session-1");
    pumpOptions?.onEvent?.({ adapterKind: "codex-app-server", type: "ready" });
    pumpOptions?.onEvent?.({
      adapterKind: "codex-app-server",
      phase: "dispatching",
      revision: 7,
      type: "dispatch",
    });
    pumpOptions?.onEvent?.({
      adapterKind: "codex-app-server",
      phase: "dispatched",
      revision: 7,
      type: "dispatch",
    });
    pumpOptions?.onEvent?.({
      adapterKind: "codex-app-server",
      phase: "working",
      revision: 7,
      type: "dispatch",
    });
    pumpOptions?.onEvent?.({
      adapterKind: "codex-app-server",
      phase: "completed",
      revision: 7,
      type: "dispatch",
    });
    expect(pump.run).toHaveBeenCalledOnce();
    expect(pump.close).toHaveBeenCalledOnce();
    expect(stderr.value()).toContain("without writing project setup");
    expect(stderr.value()).toContain(
      "Existing enabled Codex MCP servers may also start",
    );
    expect(stderr.value()).toContain("may persist this project as trusted");
    expect(stderr.value()).toContain("Codex connected and ready");
    expect(stderr.value()).toContain("SpotPatch is preparing revision 7 for Codex");
    expect(stderr.value()).toContain("Codex accepted revision 7");
    expect(stderr.value()).toContain("Codex started revision 7");
    expect(stderr.value()).toContain(
      "Codex turn ended for revision 7; review the workspace. Ready for the next request.",
    );
    expect(stderr.value()).not.toContain("/project");
    expect(stderr.value()).not.toContain("Codex received revision 7");
  });

  it("interrupts Session discovery before Codex can be started", async () => {
    let resolveDiscovery: ((sessionId: string) => void) | undefined;
    vi.mocked(resolveExactProjectSessionId).mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveDiscovery = resolve;
        }),
    );
    const existingListeners = new Set(process.listeners("SIGINT"));
    const running = runSpotPatchBridgeCli(
      ["connect", "codex", "--allow-workspace-write"],
      {
        cwd: "/project",
        stdout: output().stream,
        stderr: output().stream,
      },
    );

    let interrupt: NodeJS.SignalsListener | undefined;
    await vi.waitFor(() => {
      interrupt = process
        .listeners("SIGINT")
        .find((listener) => !existingListeners.has(listener));
      expect(interrupt).toBeDefined();
    });
    interrupt?.("SIGINT");

    await expect(running).resolves.toBe(130);
    expect(connectCodexAppServer).not.toHaveBeenCalled();
    resolveDiscovery?.("exact-session");
  });

  it("withdraws the active lease when Codex exits while idle", async () => {
    const adapter = { kind: "codex-app-server" };
    vi.mocked(connectCodexAppServer).mockImplementation((options) => {
      queueMicrotask(() => {
        options.onFatal?.(
          new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROCESS_EXITED),
        );
      });
      return Promise.resolve(adapter as never);
    });
    const pump = {
      run: vi.fn(
        (signal?: AbortSignal) =>
          new Promise<void>((resolve) => {
            if (signal?.aborted === true) resolve();
            else {
              signal?.addEventListener(
                "abort",
                () => {
                  resolve();
                },
                { once: true },
              );
            }
          }),
      ),
      close: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(createActiveEventPump).mockReturnValue(pump);
    vi.mocked(createSpotPatchBridgeClient).mockReturnValue({} as never);

    await expect(
      runSpotPatchBridgeCli(["connect", "codex", "--allow-workspace-write"], {
        cwd: "/project",
        stdout: output().stream,
        stderr: output().stream,
      }),
    ).resolves.toBe(8);
    expect(pump.close).toHaveBeenCalledOnce();
  });

  it("preserves an App Server fatal error instead of treating it as user interruption", async () => {
    const fatal = new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROCESS_EXITED);
    vi.mocked(connectCodexAppServer).mockImplementation((options) => {
      options.onFatal?.(fatal);
      expect(options.signal?.aborted).toBe(false);
      return Promise.reject(fatal);
    });
    const stderr = output();

    await expect(
      runSpotPatchBridgeCli(["connect", "codex", "--allow-workspace-write"], {
        cwd: "/project",
        stdout: output().stream,
        stderr: stderr.stream,
      }),
    ).resolves.toBe(8);
    expect(stderr.value()).toContain(CODEX_ADAPTER_ERROR_CODES.PROCESS_EXITED);
  });

  it("tells the user to reconnect when the exact development Session ends", async () => {
    vi.mocked(connectCodexAppServer).mockResolvedValue({
      kind: "codex-app-server",
    } as never);
    const pump = {
      run: vi.fn(() => Promise.reject(new SpotPatchError(ERROR_CODES.SESSION_CLOSED))),
      close: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(createActiveEventPump).mockReturnValue(pump);
    vi.mocked(createSpotPatchBridgeClient).mockReturnValue({} as never);
    const stderr = output();

    await expect(
      runSpotPatchBridgeCli(["connect", "codex", "--allow-workspace-write"], {
        cwd: "/project",
        stdout: output().stream,
        stderr: stderr.stream,
      }),
    ).resolves.not.toBe(0);
    expect(stderr.value()).toContain(ERROR_CODES.SESSION_CLOSED);
    expect(stderr.value()).toContain(
      "The SpotPatch development session ended or changed",
    );
    expect(pump.close).toHaveBeenCalledOnce();
  });
});
