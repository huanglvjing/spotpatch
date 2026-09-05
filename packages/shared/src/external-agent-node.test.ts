import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it, vi } from "vitest";

import {
  bridgeActiveClaimRequestSchema,
  bridgeActiveClaimResultSchema,
  bridgeActiveReportRequestSchema,
  bridgeActiveStateResultSchema,
  bridgeWaitRequestSchema,
  assertPrivateExternalHandoffPath,
  externalHandoffDescriptorSchema,
  resolveExternalHandoffRuntimeDirectory,
} from "./external-agent-node.js";

const execFileAsync = promisify(execFile);

async function withWindowsLocalAppData(
  callback: (localAppData: string) => Promise<void>,
): Promise<void> {
  const localAppData = await mkdtemp(
    path.join(os.tmpdir(), "spotpatch-windows-runtime-"),
  );
  const previousXdgRuntimeDirectory = process.env.XDG_RUNTIME_DIR;
  delete process.env.XDG_RUNTIME_DIR;
  vi.stubEnv("LOCALAPPDATA", localAppData);

  try {
    await callback(localAppData);
  } finally {
    vi.unstubAllEnvs();
    if (previousXdgRuntimeDirectory === undefined) {
      delete process.env.XDG_RUNTIME_DIR;
    } else {
      process.env.XDG_RUNTIME_DIR = previousXdgRuntimeDirectory;
    }
    await rm(localAppData, { recursive: true, force: true });
  }
}

const descriptor = Object.freeze({
  schemaVersion: 1,
  brokerProtocolVersion: 2,
  projectKey: "a".repeat(64),
  sessionId: "0123456789abcdef012345",
  framework: "next",
  endpoint: "http://127.0.0.1:43123",
  bridgeToken: "a".repeat(43),
  pid: 42,
  createdAt: "2026-08-23T00:00:00.000Z",
} as const);

describe("external agent Node protocol", () => {
  it("accepts only a literal IPv4 loopback descriptor", () => {
    expect(externalHandoffDescriptorSchema.safeParse(descriptor).success).toBe(true);

    for (const endpoint of [
      "http://localhost:43123",
      "http://127.0.0.2:43123",
      "https://127.0.0.1:43123",
      "http://127.0.0.1:0",
      "http://127.0.0.1:65536",
    ]) {
      expect(
        externalHandoffDescriptorSchema.safeParse({ ...descriptor, endpoint }).success,
      ).toBe(false);
    }
  });

  it("bounds wait requests and rejects unknown fields", () => {
    expect(bridgeWaitRequestSchema.parse({})).toEqual({ timeoutMs: 20_000 });
    expect(bridgeWaitRequestSchema.safeParse({ timeoutMs: 25_001 }).success).toBe(
      false,
    );
    expect(
      bridgeWaitRequestSchema.safeParse({ timeoutMs: 100, root: "/project" }).success,
    ).toBe(false);
  });

  it("keeps active lease credentials private to strict Bridge schemas", () => {
    const activeAdapter = {
      kind: "codex-app-server",
      state: "ready",
      canDispatch: true,
      connectedAt: descriptor.createdAt,
      updatedAt: descriptor.createdAt,
    } as const;

    expect(
      bridgeActiveClaimRequestSchema.safeParse({
        adapterKind: "codex-app-server",
        connectorInstanceId: descriptor.sessionId,
      }).success,
    ).toBe(true);
    expect(
      bridgeActiveClaimResultSchema.safeParse({
        leaseToken: "b".repeat(43),
        heartbeatIntervalMs: 3_000,
        baselineCursor: null,
        activeAdapter,
      }).success,
    ).toBe(true);
    expect(
      bridgeActiveReportRequestSchema.safeParse({
        leaseToken: "b".repeat(43),
        cursor: descriptor.sessionId,
        phase: "queued",
      }).success,
    ).toBe(false);
    expect(
      bridgeActiveStateResultSchema.safeParse({
        activeAdapter,
        dispatch: null,
        leaseToken: "b".repeat(43),
      }).success,
    ).toBe(false);
  });

  it.runIf(process.platform === "win32")(
    "uses the current Windows user's local application data directory",
    async () => {
      await withWindowsLocalAppData(async (localAppData) => {
        const runtimeDirectory = await resolveExternalHandoffRuntimeDirectory(true);
        expect(runtimeDirectory).toBe(
          await realpath(
            path.join(localAppData, "SpotPatch", "external-agent-runtime-v1"),
          ),
        );
      });
    },
  );

  it.runIf(process.platform === "win32")(
    "rejects a runtime directory that grants access to Everyone",
    async () => {
      await withWindowsLocalAppData(async () => {
        const runtimeDirectory = await resolveExternalHandoffRuntimeDirectory(true);
        const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
        if (systemRoot === undefined) {
          throw new Error("Windows system root is unavailable");
        }

        await execFileAsync(
          path.win32.join(systemRoot, "System32", "icacls.exe"),
          [runtimeDirectory, "/grant", "*S-1-1-0:(OI)(CI)R"],
          { windowsHide: true },
        );

        await expect(
          assertPrivateExternalHandoffPath(runtimeDirectory, "directory"),
        ).rejects.toMatchObject({ code: "BRIDGE_UNAUTHORIZED" });
      });
    },
  );
});
