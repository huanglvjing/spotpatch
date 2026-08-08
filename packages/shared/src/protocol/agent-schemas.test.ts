import { describe, expect, it } from "vitest";

import {
  agentJobEventSchema,
  agentJobResultResponseSchema,
  agentJobSnapshotSchema,
  agentWorkspaceHealthSnapshotSchema,
} from "./agent-schemas.js";

const jobId = "0123456789abcdefghijklmn";
const snapshot = Object.freeze({
  jobId,
  status: "awaiting-review" as const,
  providerProfileId: "relay",
  providerLabel: "Trusted Relay",
  modelProfileId: "coder",
  modelLabel: "Coding Model",
  phaseMessage: "Validated changes are ready for review.",
  createdAt: "2026-08-07T00:00:00.000Z",
  updatedAt: "2026-08-07T00:00:01.000Z",
  canCancel: true,
  canApply: true,
  canRevert: false,
});

describe("Agent response schemas", () => {
  it("accepts a bounded workspace health snapshot", () => {
    expect(
      agentWorkspaceHealthSnapshotSchema.safeParse({
        state: "consent-required",
        checkedAt: "2026-08-08T00:00:00.000Z",
        changes: {
          staged: 1,
          unstaged: 1,
          untracked: 1,
          conflicted: 0,
          total: 2,
        },
        canIncludeLocalChanges: true,
      }).success,
    ).toBe(true);
  });

  it("rejects inconsistent workspace health states and counts", () => {
    expect(
      agentWorkspaceHealthSnapshotSchema.safeParse({
        state: "ready",
        checkedAt: "2026-08-08T00:00:00.000Z",
        changes: {
          staged: 1,
          unstaged: 0,
          untracked: 0,
          conflicted: 0,
          total: 0,
        },
        canIncludeLocalChanges: true,
      }).success,
    ).toBe(false);
    expect(
      agentWorkspaceHealthSnapshotSchema.safeParse({
        state: "blocked",
        checkedAt: "2026-08-08T00:00:00.000Z",
        changes: {
          staged: 0,
          unstaged: 0,
          untracked: 0,
          conflicted: 0,
          total: 0,
        },
        canIncludeLocalChanges: false,
      }).success,
    ).toBe(false);
  });

  it("accepts a bounded, correlated snapshot event and result", () => {
    expect(agentJobSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(
      agentJobEventSchema.safeParse({
        schemaVersion: 2,
        sequence: 1,
        jobId,
        status: "awaiting-review",
        timestamp: "2026-08-07T00:00:01.000Z",
        type: "snapshot",
        data: { snapshot },
      }).success,
    ).toBe(true);
    expect(
      agentJobResultResponseSchema.safeParse({
        snapshot,
        result: {
          jobId,
          summary: "Updated one component.",
          diff: "diff --git a/src/App.tsx b/src/App.tsx\n",
          files: [],
          checks: [],
        },
      }).success,
    ).toBe(true);
  });

  it("rejects untrusted extra fields and malformed identifiers", () => {
    expect(
      agentJobSnapshotSchema.safeParse({
        ...snapshot,
        jobId: "../outside",
        absolutePath: "/private/project/src/App.tsx",
      }).success,
    ).toBe(false);
  });

  it("rejects mismatched nested job identity and status", () => {
    expect(
      agentJobEventSchema.safeParse({
        schemaVersion: 2,
        sequence: 1,
        jobId,
        status: "running",
        timestamp: "2026-08-07T00:00:01.000Z",
        type: "snapshot",
        data: { snapshot },
      }).success,
    ).toBe(false);
    expect(
      agentJobResultResponseSchema.safeParse({
        snapshot,
        result: {
          jobId: "zyxwvutsrqponmlkjihgfedc",
          summary: "Mismatched result.",
          diff: "",
          files: [],
          checks: [],
        },
      }).success,
    ).toBe(false);
  });

  it("rejects oversized provider-controlled display values", () => {
    expect(
      agentJobResultResponseSchema.safeParse({
        snapshot,
        result: {
          jobId,
          summary: "x".repeat(80_001),
          diff: "",
          files: [],
          checks: [],
        },
      }).success,
    ).toBe(false);
    expect(
      agentJobEventSchema.safeParse({
        schemaVersion: 2,
        sequence: 1,
        jobId,
        status: "running",
        timestamp: "2026-08-07T00:00:01.000Z",
        type: "phase",
        data: { message: "x".repeat(1_025) },
      }).success,
    ).toBe(false);
  });
});
