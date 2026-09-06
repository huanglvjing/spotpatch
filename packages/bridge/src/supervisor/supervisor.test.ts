import { chmod, lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createExternalHandoffService,
  type ExternalHandoffService,
} from "@spotpatch/dev-server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentAdapter } from "../active/types.js";
import { createManagedGrantStore } from "./grant-store.js";
import {
  CODEX_ADAPTER_ERROR_CODES,
  CodexAdapterError,
} from "../active/codex/errors.js";
import {
  createExternalAgentSupervisor,
  type ConnectManagedAdapter,
  type ExternalAgentSupervisor,
  type ManagedAdapterConnection,
} from "./supervisor.js";

const sessionId = "0123456789abcdef012345";
const request = Object.freeze({
  requestId: "abcdefghijklmnopqrstuv",
  adapterKind: "codex",
  profile: "managed-apply-v1",
} as const);

let configBase = "";
let projectRoot = "";
let runtimeRoot = "";
let service: ExternalHandoffService | undefined;
const supervisors: ExternalAgentSupervisor[] = [];

function fakeConnector(): ConnectManagedAdapter {
  return vi.fn<ConnectManagedAdapter>((options) => {
    const adapter: AgentAdapter = {
      kind: "codex-app-server",
      close: vi.fn(() => Promise.resolve()),
      deliver: vi.fn(() => Promise.resolve()),
    };
    const connection: ManagedAdapterConnection = {
      adapter,
      authReadiness: "authenticated",
      requestedModel: options.model ?? "requested-model",
      effectiveModel: "effective-model",
      models: ["requested-model", "alternate-model"],
    };
    return Promise.resolve(connection);
  });
}

async function createSupervisor(
  connector: ConnectManagedAdapter,
  confirmManagedAccess?: () => Promise<boolean>,
): Promise<ExternalAgentSupervisor> {
  const supervisor = await createExternalAgentSupervisor({
    bridgeAdapter: "vite",
    configBase,
    connectManagedAdapter: connector,
    root: projectRoot,
    sessionId,
    ...(confirmManagedAccess === undefined ? {} : { confirmManagedAccess }),
  });
  supervisors.push(supervisor);
  return supervisor;
}

const describeExternalAgentSupervisor =
  process.platform === "win32" ? describe.skip : describe;

describeExternalAgentSupervisor("external Agent Supervisor", () => {
  beforeEach(async () => {
    configBase = await mkdtemp(path.join(os.tmpdir(), "spotpatch-supervisor-config-"));
    projectRoot = await mkdtemp(
      path.join(os.tmpdir(), "spotpatch-supervisor-project-"),
    );
    runtimeRoot = await mkdtemp(
      path.join(os.tmpdir(), "spotpatch-supervisor-runtime-"),
    );
    await Promise.all([chmod(configBase, 0o700), chmod(runtimeRoot, 0o700)]);
    vi.stubEnv("XDG_RUNTIME_DIR", runtimeRoot);
    service = createExternalHandoffService({
      framework: "vite",
      root: projectRoot,
      sessionId,
    });
    await service.start();
  });

  afterEach(async () => {
    await Promise.all(
      supervisors.splice(0).map(async (supervisor) => supervisor.dispose()),
    );
    await service?.close();
    service = undefined;
    vi.unstubAllEnvs();
    await Promise.all([
      rm(configBase, { recursive: true, force: true }),
      rm(projectRoot, { recursive: true, force: true }),
      rm(runtimeRoot, { recursive: true, force: true }),
    ]);
  });

  it("returns immediately without a terminal prompt and accepts a CLI-created grant on reconnect", async () => {
    const connector = fakeConnector();
    const supervisor = await createSupervisor(connector);
    await expect(
      supervisor.connect(request, new AbortController().signal),
    ).resolves.toMatchObject({
      connectionState: "awaiting-consent",
      grantState: "missing",
    });
    const store = await createManagedGrantStore({ root: projectRoot, configBase });
    await store.grant();
    await supervisor.connect(
      { ...request, requestId: "after-cli-init" },
      new AbortController().signal,
    );
    await vi.waitFor(() => {
      expect(supervisor.getStatus()).toMatchObject({
        connectionState: "ready",
        grantState: "valid",
      });
    });
  });

  it("switches an idle connection once, forwards the chosen model, and rejects unknown choices", async () => {
    const connector = fakeConnector();
    const supervisor = await createSupervisor(connector, () => Promise.resolve(true));
    const signal = new AbortController().signal;
    await supervisor.connect(request, signal);
    await vi.waitFor(() => {
      expect(supervisor.getStatus().connectionState).toBe("ready");
    });
    const firstResult = vi.mocked(connector).mock.results[0];
    if (firstResult?.type !== "return") throw new Error("Connection did not return");
    const first = await firstResult.value;
    const change = {
      ...request,
      requestId: "change-model-request-001",
      model: "alternate-model",
    };
    await supervisor.connect(change, signal);
    await vi.waitFor(() => {
      expect(supervisor.getStatus().connectionState).toBe("ready");
    });
    expect(first.adapter.close).toHaveBeenCalledOnce();
    expect(connector).toHaveBeenCalledTimes(2);
    expect(vi.mocked(connector).mock.calls[1]?.[0].model).toBe("alternate-model");
    expect(supervisor.getStatus().requestedModel).toBe("alternate-model");
    await supervisor.connect(change, signal);
    await supervisor.connect(
      { ...change, requestId: "same-model-request-0001" },
      signal,
    );
    expect(connector).toHaveBeenCalledTimes(2);
    await expect(
      supervisor.connect(
        { ...change, requestId: "unknown-model-request-01", model: "unknown" },
        signal,
      ),
    ).resolves.toMatchObject({
      connectionState: "ready",
      requestedModel: "alternate-model",
      error: { code: "AGENT_MODEL_UNAVAILABLE" },
    });
    expect(connector).toHaveBeenCalledTimes(2);
  });

  it("rejects model switching while work is in progress without closing the adapter", async () => {
    const connector = fakeConnector();
    const supervisor = await createSupervisor(connector, () => Promise.resolve(true));
    const signal = new AbortController().signal;
    await supervisor.connect(request, signal);
    await vi.waitFor(() => {
      expect(supervisor.getStatus().connectionState).toBe("ready");
    });
    vi.mocked(connector).mock.calls[0]?.[0].onEvent({
      type: "phase",
      phase: "running",
      revision: 1,
    });
    await expect(
      supervisor.connect(
        { ...request, requestId: "busy-model-request-0001", model: "alternate-model" },
        signal,
      ),
    ).rejects.toMatchObject({ code: "EXTERNAL_AGENT_BUSY" });
    expect(connector).toHaveBeenCalledOnce();
    const firstResult = vi.mocked(connector).mock.results[0];
    if (firstResult?.type !== "return") throw new Error("Connection did not return");
    const first = await firstResult.value;
    expect(first.adapter.close).not.toHaveBeenCalled();
  });

  it("keeps Inbox mode when out-of-browser consent is declined", async () => {
    const connector = fakeConnector();
    const supervisor = await createSupervisor(connector, () => Promise.resolve(false));
    const status = await supervisor.connect(request, new AbortController().signal);

    expect(status).toMatchObject({
      mode: "inbox",
      connectionState: "awaiting-consent",
      grantState: "missing",
    });
    expect(connector).not.toHaveBeenCalled();
  });

  it("grants once, reaches managed ready, and revokes explicitly", async () => {
    const connector = fakeConnector();
    const confirm = vi.fn(() => Promise.resolve(true));
    const supervisor = await createSupervisor(connector, confirm);

    await supervisor.connect(request, new AbortController().signal);
    await vi.waitFor(() => {
      expect(supervisor.getStatus()).toMatchObject({
        mode: "managed",
        connectionState: "ready",
        grantState: "valid",
        authReadiness: "authenticated",
        requestedModel: "requested-model",
        effectiveModel: "effective-model",
      });
    });
    await supervisor.connect(request, new AbortController().signal);
    expect(confirm).toHaveBeenCalledOnce();
    expect(connector).toHaveBeenCalledOnce();
    const connectorOptions = vi.mocked(connector).mock.calls[0]?.[0];
    if (connectorOptions === undefined) throw new Error("Connector was not called.");
    expect(connectorOptions).toMatchObject({ privateRuntimeBase: configBase });
    expect(connectorOptions.runtimeKey).toMatch(/^[a-f0-9]{64}$/u);
    const managedRuntimeHome = path.join(
      configBase,
      "external-agent-runtime",
      "codex",
      connectorOptions.runtimeKey,
    );
    await mkdir(managedRuntimeHome, { recursive: true, mode: 0o700 });
    await writeFile(path.join(managedRuntimeHome, "state"), "managed\n");

    const disconnected = await supervisor.disconnect({
      requestId: "zyxwvutsrqponmlkjihgfe",
      adapterKind: "codex",
      revokeGrant: true,
    });
    expect(disconnected).toMatchObject({
      mode: "inbox",
      connectionState: "disconnected",
      grantState: "missing",
    });
    await expect(lstat(managedRuntimeHome)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("auto-restores a valid project grant across three Supervisor lifecycles", async () => {
    const first = await createSupervisor(fakeConnector(), () => Promise.resolve(true));
    await first.connect(request, new AbortController().signal);
    await vi.waitFor(() => {
      expect(first.getStatus().connectionState).toBe("ready");
    });
    await first.dispose();
    supervisors.splice(supervisors.indexOf(first), 1);

    for (let index = 0; index < 3; index += 1) {
      const connector = fakeConnector();
      const restored = await createSupervisor(connector);
      await vi.waitFor(() => {
        expect(restored.getStatus()).toMatchObject({
          mode: "managed",
          connectionState: "ready",
          grantState: "valid",
        });
      });
      expect(connector).toHaveBeenCalledOnce();
      await restored.dispose();
      supervisors.splice(supervisors.indexOf(restored), 1);
    }
  });

  it("classifies signed-out Codex without misreporting a handshake failure", async () => {
    const connector: ConnectManagedAdapter = vi.fn(() =>
      Promise.reject(new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.AUTH_REQUIRED)),
    );
    const supervisor = await createSupervisor(connector, () => Promise.resolve(true));

    const status = await supervisor.connect(request, new AbortController().signal);

    expect(status).toMatchObject({
      mode: "inbox",
      connectionState: "degraded",
      authReadiness: "signed-out",
      error: {
        code: "AGENT_AUTH_REQUIRED",
        stage: "auth",
        action: "sign-in",
      },
    });
  });

  it("classifies model and configuration-isolation failures precisely", async () => {
    for (const [adapterCode, expected] of [
      [
        CODEX_ADAPTER_ERROR_CODES.MODEL_UNAVAILABLE,
        { code: "AGENT_MODEL_UNAVAILABLE", stage: "model" },
      ],
      [
        CODEX_ADAPTER_ERROR_CODES.CONFIG_ISOLATION_UNSUPPORTED,
        { code: "CODEX_CONFIG_ISOLATION_UNSUPPORTED", stage: "protocol" },
      ],
      [
        CODEX_ADAPTER_ERROR_CODES.SCHEMA_INCOMPATIBLE,
        { code: "AGENT_PROTOCOL_INCOMPATIBLE", stage: "protocol" },
      ],
    ] as const) {
      const supervisor = await createSupervisor(
        vi.fn(() => Promise.reject(new CodexAdapterError(adapterCode))),
        () => Promise.resolve(true),
      );

      await expect(
        supervisor.connect(
          { ...request, requestId: crypto.randomUUID().replaceAll("-", "") },
          new AbortController().signal,
        ),
      ).resolves.toMatchObject({ error: expected });
    }
  });

  it("clears a dead Event Pump so a later connect can create a new adapter", async () => {
    const connector = fakeConnector();
    const supervisor = await createSupervisor(connector, () => Promise.resolve(true));
    await supervisor.connect(request, new AbortController().signal);
    await vi.waitFor(() => {
      expect(supervisor.getStatus().connectionState).toBe("ready");
    });

    await service?.close();
    await vi.waitFor(() => {
      expect(supervisor.getStatus().connectionState).toBe("degraded");
    });
    await Promise.resolve();
    await supervisor.connect(
      {
        ...request,
        requestId: "secondconnectrequestid1",
      },
      new AbortController().signal,
    );

    expect(connector).toHaveBeenCalledTimes(2);
  });
});

it.runIf(process.platform === "win32")(
  "keeps managed execution unavailable until private Windows discovery is implemented",
  async () => {
    const windowsConfigBase = await mkdtemp(
      path.join(os.tmpdir(), "spotpatch-supervisor-windows-config-"),
    );
    const windowsProjectRoot = await mkdtemp(
      path.join(os.tmpdir(), "spotpatch-supervisor-windows-project-"),
    );
    const connector = fakeConnector();
    const confirmManagedAccess = vi.fn(() => Promise.resolve(true));
    let supervisor: ExternalAgentSupervisor | undefined;

    try {
      supervisor = await createExternalAgentSupervisor({
        bridgeAdapter: "vite",
        configBase: windowsConfigBase,
        confirmManagedAccess,
        connectManagedAdapter: connector,
        root: windowsProjectRoot,
        sessionId,
      });
      await expect(
        supervisor.connect(request, new AbortController().signal),
      ).resolves.toMatchObject({
        mode: "inbox",
        connectionState: "degraded",
        grantState: "missing",
        error: {
          code: "MANAGED_PLATFORM_UNSUPPORTED",
          stage: "integration",
          action: "use-inbox",
        },
      });
      expect(confirmManagedAccess).not.toHaveBeenCalled();
      expect(connector).not.toHaveBeenCalled();
    } finally {
      await supervisor?.dispose();
      await Promise.all([
        rm(windowsConfigBase, { recursive: true, force: true }),
        rm(windowsProjectRoot, { recursive: true, force: true }),
      ]);
    }
  },
);
