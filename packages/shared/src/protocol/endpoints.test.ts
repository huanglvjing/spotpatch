import { describe, expect, it } from "vitest";

import {
  getAgentJobEndpoint,
  SPOTPATCH_API_BASE,
  SPOTPATCH_ENDPOINTS,
} from "./endpoints.js";

describe("protocol endpoints", () => {
  it("derives every Agent endpoint from the private API base", () => {
    expect(SPOTPATCH_ENDPOINTS.agentCapability).toBe(
      `${SPOTPATCH_API_BASE}/agent/capability`,
    );
    expect(SPOTPATCH_ENDPOINTS.agentWorkspaceHealth).toBe(
      `${SPOTPATCH_API_BASE}/agent/workspace-health`,
    );
    expect(SPOTPATCH_ENDPOINTS.agentJobs).toBe(`${SPOTPATCH_API_BASE}/agent/jobs`);
    expect(getAgentJobEndpoint("job/id", "apply")).toBe(
      `${SPOTPATCH_API_BASE}/agent/jobs/job%2Fid/apply`,
    );
  });
});
