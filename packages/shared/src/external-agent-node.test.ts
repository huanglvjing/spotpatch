import { describe, expect, it } from "vitest";

import {
  bridgeActiveClaimRequestSchema,
  bridgeActiveClaimResultSchema,
  bridgeActiveReportRequestSchema,
  bridgeActiveStateResultSchema,
  bridgeWaitRequestSchema,
  externalHandoffDescriptorSchema,
  resolveExternalHandoffRuntimeDirectory,
} from "./external-agent-node.js";

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
    "fails closed when private Windows discovery has not been implemented",
    async () => {
      await expect(resolveExternalHandoffRuntimeDirectory(true)).rejects.toMatchObject({
        code: "BRIDGE_UNAUTHORIZED",
      });
    },
  );
});
