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
  askCapability: `${SPOTPATCH_API_BASE}/ask/capability`,
  askJobs: `${SPOTPATCH_API_BASE}/ask/jobs`,
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
export type AskJobAction = "events" | "result" | "cancel";

export function getAgentJobEndpoint(jobId: string, action: AgentJobAction): string {
  return `${SPOTPATCH_ENDPOINTS.agentJobs}/${encodeURIComponent(jobId)}/${action}`;
}

export function getAskJobEndpoint(
  jobId: string,
  action: AskJobAction,
  options: Readonly<{ afterSequence?: number }> = {},
): string {
  const endpoint = `${SPOTPATCH_ENDPOINTS.askJobs}/${encodeURIComponent(jobId)}/${action}`;
  if (action !== "events" && options.afterSequence !== undefined) {
    throw new RangeError("afterSequence is only valid for the events endpoint.");
  }
  if (options.afterSequence === undefined) return endpoint;
  if (!Number.isSafeInteger(options.afterSequence) || options.afterSequence < 0) {
    throw new RangeError("afterSequence must be a non-negative safe integer.");
  }
  return `${endpoint}?afterSequence=${String(options.afterSequence)}`;
}
