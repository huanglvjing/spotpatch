import { describe, expect, it } from "vitest";

import {
  getAgentJobEndpoint,
  getAskJobEndpoint,
  SPOTPATCH_API_BASE,
  SPOTPATCH_ENDPOINTS,
} from "./endpoints.js";

describe("protocol endpoints", () => {
  it("derives every Agent endpoint from the private API base", () => {
    expect(SPOTPATCH_ENDPOINTS.bootstrap).toBe(`${SPOTPATCH_API_BASE}/bootstrap`);
    expect(SPOTPATCH_ENDPOINTS.agentCapability).toBe(
      `${SPOTPATCH_API_BASE}/agent/capability`,
    );
    expect(SPOTPATCH_ENDPOINTS.agentWorkspaceHealth).toBe(
      `${SPOTPATCH_API_BASE}/agent/workspace-health`,
    );
    expect(SPOTPATCH_ENDPOINTS.agentJobs).toBe(`${SPOTPATCH_API_BASE}/agent/jobs`);
    expect(SPOTPATCH_ENDPOINTS.askCapability).toBe(
      `${SPOTPATCH_API_BASE}/ask/capability`,
    );
    expect(SPOTPATCH_ENDPOINTS.askJobs).toBe(`${SPOTPATCH_API_BASE}/ask/jobs`);
    expect(SPOTPATCH_ENDPOINTS.dataFlowComponentReport).toBe(
      `${SPOTPATCH_API_BASE}/data-flow/component-report`,
    );
    expect(SPOTPATCH_ENDPOINTS.dataFlowPageReport).toBe(
      `${SPOTPATCH_API_BASE}/data-flow/page-report`,
    );
    expect(getAgentJobEndpoint("job/id", "apply")).toBe(
      `${SPOTPATCH_API_BASE}/agent/jobs/job%2Fid/apply`,
    );
  });

  it("builds bounded Ask job endpoints and an event resume cursor", () => {
    expect(getAskJobEndpoint("job/id", "result")).toBe(
      `${SPOTPATCH_API_BASE}/ask/jobs/job%2Fid/result`,
    );
    expect(getAskJobEndpoint("job-id", "events", { afterSequence: 12 })).toBe(
      `${SPOTPATCH_API_BASE}/ask/jobs/job-id/events?afterSequence=12`,
    );
    expect(() => getAskJobEndpoint("job-id", "events", { afterSequence: -1 })).toThrow(
      RangeError,
    );
    expect(() => getAskJobEndpoint("job-id", "result", { afterSequence: 1 })).toThrow(
      RangeError,
    );
  });
});
