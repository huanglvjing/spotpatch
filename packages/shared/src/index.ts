export { SpotPatchError } from "./errors/spotpatch-error.js";
export { ERROR_CODES, type ErrorCode } from "./errors/error-code.js";
export {
  isSensitiveName,
  redactSensitiveText,
  sanitizeUrl,
} from "./security/redaction.js";
export type {
  ElementContext,
  PageContext,
  SpotAnnotation,
} from "./model/annotation.js";
export type { CodeContext, ContextBudget } from "./model/code-context.js";
export {
  AGENT_CAPABILITY_STATES,
  AGENT_CHECK_STATUSES,
  AGENT_FILE_CHANGE_KINDS,
  AGENT_JOB_STATUSES,
  DEFAULT_AGENT_LIMITS,
  type AgentApplyMode,
  type AgentCapabilitySnapshot,
  type AgentCapabilityState,
  type AgentChangedFile,
  type AgentCheckDefinition,
  type AgentCheckResult,
  type AgentCheckStatus,
  type AgentFileChangeKind,
  type AgentJobResult,
  type AgentJobResultResponse,
  type AgentJobSnapshot,
  type AgentJobStatus,
  type AgentLimits,
  type AiExecutionOptions,
  type AiModelProfile,
  type AiOptions,
  type AiProviderProtocol,
  type OpenAICompatibleProviderOptions,
  type ResolvedAgentCheckDefinition,
  type ResolvedAiExecutionOptions,
  type ResolvedAiModelProfile,
  type ResolvedAiOptions,
  type ResolvedOpenAICompatibleProviderOptions,
  type RuntimeAiConfig,
  type RuntimeAiModelProfile,
  type RuntimeAiProviderProfile,
} from "./model/agent.js";
export type {
  ReactContext,
  SourceConfidence,
  SourceOrigin,
  SourceRef,
} from "./model/source-ref.js";
export type { MatchedStyleRule, StyleContext } from "./model/style-context.js";
export {
  formatSourceMarker,
  parseSourceMarker,
  SOURCE_MARKER_ATTRIBUTE,
  type SourceMarker,
} from "./model/source-marker.js";
export {
  getAgentJobEndpoint,
  SPOTPATCH_API_BASE,
  SPOTPATCH_ENDPOINTS,
  SPOTPATCH_TOKEN_HEADER,
  type AgentJobAction,
} from "./protocol/endpoints.js";
export {
  agentCapabilityRequestSchema,
  agentJobActionRequestSchema,
  agentJobCreateRequestSchema,
  openEditorRequestSchema,
  sourceContextRequestSchema,
  spotAnnotationRequestSchema,
  type AgentCapabilityRequest,
  type AgentJobCreateRequest,
  type OpenEditorRequest,
  type SourceContextRequest,
} from "./protocol/requests.js";
export type { AgentJobEvent } from "./protocol/agent-events.js";
export {
  agentCapabilitySnapshotSchema,
  agentChangedFileSchema,
  agentCheckResultSchema,
  agentJobEventSchema,
  agentJobResultResponseSchema,
  agentJobResultSchema,
  agentJobSnapshotSchema,
} from "./protocol/agent-schemas.js";
export type { ApiFailure, ApiResponse, ApiSuccess } from "./protocol/responses.js";
