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
  externalHandoffCapability: `${SPOTPATCH_API_BASE}/external-handoff/capability`,
  externalHandoffPublish: `${SPOTPATCH_API_BASE}/external-handoff/publish`,
  externalHandoffStatus: `${SPOTPATCH_API_BASE}/external-handoff/status`,
  externalHandoffResolveDelivery: `${SPOTPATCH_API_BASE}/external-handoff/resolve-delivery`,
  externalAgentControlStatus: `${SPOTPATCH_API_BASE}/external-agent/control/status`,
  externalAgentControlConnect: `${SPOTPATCH_API_BASE}/external-agent/control/connect`,
  externalAgentControlDisconnect: `${SPOTPATCH_API_BASE}/external-agent/control/disconnect`,
  externalAgentControlCancel: `${SPOTPATCH_API_BASE}/external-agent/control/cancel`,
  externalAgentEvents: `${SPOTPATCH_API_BASE}/external-agent/events`,
  externalAgentResult: `${SPOTPATCH_API_BASE}/external-agent/result`,
});

export type AgentJobAction = "events" | "result" | "cancel" | "apply" | "revert";

export function getAgentJobEndpoint(jobId: string, action: AgentJobAction): string {
  return `${SPOTPATCH_ENDPOINTS.agentJobs}/${encodeURIComponent(jobId)}/${action}`;
}
