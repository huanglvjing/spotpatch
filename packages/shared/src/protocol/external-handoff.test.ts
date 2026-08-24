import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../errors/error-code.js";
import {
  ERROR_CODES as BROWSER_ERROR_CODES,
  EXTERNAL_HANDOFF_LIMITS as BROWSER_EXTERNAL_HANDOFF_LIMITS,
} from "../external-handoff-browser.js";
import {
  EXTERNAL_HANDOFF_LIMITS,
  externalHandoffCapabilitySchema,
  externalHandoffPublishResultSchema,
  externalHandoffStatusResultSchema,
  externalHandoffSnapshotSchema,
  externalHandoffStatusRequestSchema,
  externalHandoffSummarySchema,
} from "./external-handoff.js";

const opaqueId = "0123456789abcdef012345";
const timestamp = "2026-08-23T00:00:00.000Z";
const summary = Object.freeze({
  sessionId: opaqueId,
  framework: "vite",
  revision: 1,
  cursor: opaqueId,
  targetCount: 1,
  page: Object.freeze({ origin: "http://127.0.0.1:5173", pathname: "/" }),
  publishedAt: timestamp,
  expiresAt: "2026-08-23T00:15:00.000Z",
  state: "available",
  pickupCount: 0,
} as const);

describe("external handoff protocol", () => {
  it("keeps the browser projection aligned with canonical protocol constants", () => {
    for (const [name, value] of Object.entries(BROWSER_ERROR_CODES)) {
      expect(ERROR_CODES[name as keyof typeof ERROR_CODES]).toBe(value);
    }
    expect(BROWSER_EXTERNAL_HANDOFF_LIMITS).toEqual({
      maximumConnectorReceipts: EXTERNAL_HANDOFF_LIMITS.maximumConnectorReceipts,
      maximumWaiters: EXTERNAL_HANDOFF_LIMITS.maximumWaiters,
      activeStatusPollMs: EXTERNAL_HANDOFF_LIMITS.activeStatusPollMs,
    });
  });

  it("accepts strict non-sensitive summary and capability payloads", () => {
    expect(externalHandoffSummarySchema.safeParse(summary).success).toBe(true);
    expect(
      externalHandoffCapabilitySchema.safeParse({
        enabled: true,
        brokerReady: true,
        activeWaitCount: 0,
        snapshotSchemaVersion: 1,
        brokerProtocolVersion: 2,
        activeAdapter: null,
        dispatch: null,
      }).success,
    ).toBe(true);
    expect(
      externalHandoffSummarySchema.safeParse({ ...summary, bridgeToken: opaqueId })
        .success,
    ).toBe(false);
  });

  it("keeps active delivery and status metadata strict and non-sensitive", () => {
    const activeAdapter = {
      kind: "claude-channel",
      state: "busy",
      canDispatch: false,
      connectedAt: timestamp,
      updatedAt: timestamp,
    } as const;
    const dispatch = {
      adapterKind: "claude-channel",
      revision: 1,
      phase: "queued",
      updatedAt: timestamp,
    } as const;

    expect(
      externalHandoffPublishResultSchema.safeParse({
        handoff: summary,
        delivery: { mode: "active", adapter: activeAdapter, dispatch },
        replayed: false,
      }).success,
    ).toBe(true);
    expect(
      externalHandoffStatusResultSchema.safeParse({
        handoff: summary,
        activeAdapter,
        dispatch,
      }).success,
    ).toBe(true);
    expect(
      externalHandoffStatusResultSchema.safeParse({
        handoff: summary,
        activeAdapter: { ...activeAdapter, leaseToken: opaqueId },
        dispatch,
      }).success,
    ).toBe(false);
  });

  it("rejects malformed cursors, private fields, and excessive receipt counts", () => {
    expect(
      externalHandoffStatusRequestSchema.safeParse({ cursor: "short" }).success,
    ).toBe(false);
    expect(
      externalHandoffStatusRequestSchema.safeParse({ root: "/private/project" })
        .success,
    ).toBe(false);
    expect(
      externalHandoffSummarySchema.safeParse({
        ...summary,
        pickupCount: EXTERNAL_HANDOFF_LIMITS.maximumConnectorReceipts + 1,
      }).success,
    ).toBe(false);
  });

  it("requires an authorized SpotAnnotation v3 inside snapshots", () => {
    expect(
      externalHandoffSnapshotSchema.safeParse({
        schemaVersion: 1,
        cursor: opaqueId,
        session: { id: opaqueId, framework: "vite" },
        revision: 1,
        publishedAt: timestamp,
        expiresAt: "2026-08-23T00:15:00.000Z",
        annotation: { schemaVersion: 3, targets: [] },
      }).success,
    ).toBe(false);
  });
});
