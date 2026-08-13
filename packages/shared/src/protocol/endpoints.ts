export const SPOTPATCH_API_BASE = "/__spotpatch/v1" as const;
export const SPOTPATCH_TOKEN_HEADER = "X-SpotPatch-Token" as const;

export const SPOTPATCH_ENDPOINTS = Object.freeze({
  bootstrap: `${SPOTPATCH_API_BASE}/bootstrap`,
  sourceContext: `${SPOTPATCH_API_BASE}/source-context`,
  openEditor: `${SPOTPATCH_API_BASE}/open-editor`,
  dataFlowComponentReport: `${SPOTPATCH_API_BASE}/data-flow/component-report`,
  dataFlowPageReport: `${SPOTPATCH_API_BASE}/data-flow/page-report`,
  agentCapability: `${SPOTPATCH_API_BASE}/agent/capability`,
  agentWorkspaceHealth: `${SPOTPATCH_API_BASE}/agent/workspace-health`,
  agentJobs: `${SPOTPATCH_API_BASE}/agent/jobs`,
});

export type AgentJobAction = "events" | "result" | "cancel" | "apply" | "revert";

export function getAgentJobEndpoint(jobId: string, action: AgentJobAction): string {
  return `${SPOTPATCH_ENDPOINTS.agentJobs}/${encodeURIComponent(jobId)}/${action}`;
}
