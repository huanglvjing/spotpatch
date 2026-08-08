import {
  agentCapabilitySnapshotSchema,
  agentJobEventSchema,
  agentJobResultResponseSchema,
  agentJobSnapshotSchema,
} from "@spotpatch/shared";
import { describe, expect, it } from "vitest";

import {
  isAgentCapabilitySnapshot,
  isAgentJobEvent,
  isAgentJobResultResponse,
  isAgentJobSnapshot,
} from "./agent-response-validation.js";

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

const capability = Object.freeze({
  providerProfileId: "relay",
  providerLabel: "Trusted Relay",
  modelProfileId: "coder",
  modelLabel: "Coding Model",
  protocol: "responses" as const,
  state: "agent-ready" as const,
  authenticated: true,
  modelAvailable: true,
  toolCalling: true,
  toolResultContinuation: true,
  streaming: true,
  checkedAt: "2026-08-07T00:00:00.000Z",
});

const resultResponse = Object.freeze({
  snapshot,
  result: Object.freeze({
    jobId,
    summary: "Updated one component.",
    diff: "diff --git a/src/App.tsx b/src/App.tsx\n",
    files: Object.freeze([
      Object.freeze({
        relativePath: "src/App.tsx",
        kind: "modified" as const,
        additions: 1,
        deletions: 1,
      }),
    ]),
    checks: Object.freeze([
      Object.freeze({
        checkId: "typecheck",
        label: "Typecheck",
        status: "passed" as const,
        durationMs: 12,
        output: "No errors.",
      }),
    ]),
  }),
});

const event = Object.freeze({
  schemaVersion: 2 as const,
  sequence: 1,
  jobId,
  status: "awaiting-review" as const,
  timestamp: "2026-08-07T00:00:01.000Z",
  type: "snapshot" as const,
  data: Object.freeze({ snapshot }),
});

describe("browser Agent response validation", () => {
  it.each([
    [capability, isAgentCapabilitySnapshot, agentCapabilitySnapshotSchema],
    [snapshot, isAgentJobSnapshot, agentJobSnapshotSchema],
    [resultResponse, isAgentJobResultResponse, agentJobResultResponseSchema],
    [event, isAgentJobEvent, agentJobEventSchema],
  ] as const)(
    "matches the shared schema for valid protocol data",
    (value, guard, schema) => {
      expect(guard(value)).toBe(schema.safeParse(value).success);
      expect(guard(value)).toBe(true);
    },
  );

  it.each([
    [
      { ...capability, baseURL: "https://private.example/v1" },
      isAgentCapabilitySnapshot,
      agentCapabilitySnapshotSchema,
    ],
    [{ ...snapshot, jobId: "../outside" }, isAgentJobSnapshot, agentJobSnapshotSchema],
    [
      {
        ...resultResponse,
        result: { ...resultResponse.result, jobId: "zyxwvutsrqponmlkjihgfedc" },
      },
      isAgentJobResultResponse,
      agentJobResultResponseSchema,
    ],
    [{ ...event, status: "running" }, isAgentJobEvent, agentJobEventSchema],
  ] as const)(
    "matches the shared schema for rejected protocol data",
    (value, guard, schema) => {
      expect(guard(value)).toBe(schema.safeParse(value).success);
      expect(guard(value)).toBe(false);
    },
  );
});
