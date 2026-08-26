export {
  createAgentJobManager,
  type AgentJobEventListener,
  type AgentJobManager,
  type CreateAgentJobManagerOptions,
} from "./agent/job-manager.js";
export {
  createExternalHandoffService,
  type CreateExternalHandoffServiceOptions,
  type ExternalHandoffService,
} from "./external-handoff/service.js";
export type { ExternalAgentControlPort } from "./external-agent/control-port.js";
export {
  resolveCredentialEnvironment,
  resolveEnvironmentAiConfiguration,
  type EnvironmentAiConfiguration,
} from "./environment-ai.js";
export {
  applyIntegrationPlan,
  createIntegrationFileChange,
  integrationPathExists,
  readIntegrationFile,
  type IntegrationFileChange,
  type IntegrationPlan,
} from "./integration/file-plan.js";
export {
  createRuntimeAiConfig,
  createRuntimeDataFlowConfig,
  DEFAULT_EXCLUDE,
  DEFAULT_OPTIONS,
  resolveOptions,
  type FilterEntry,
  type ResolvedSpotPatchOptions,
  type ResolvedSpotPatchDataFlowOptions,
  type SimpleAiOptions,
  type SpotPatchAiOptions,
  type SpotPatchDataFlowOptions,
  type SpotPatchOptions,
} from "./options.js";
export {
  resolveProjectOptions,
  type ResolveProjectOptionsInput,
} from "./project-options.js";
export {
  discoverProjectValidationCheck,
  resolveManagedExecutionValidation,
  resolveProjectValidationChecks,
  type DiscoverProjectValidationCheckOptions,
  type ResolvedManagedExecutionValidation,
  type ResolveManagedExecutionValidationOptions,
  type ResolveProjectValidationChecksOptions,
} from "./project-validation.js";
export {
  createSourceRegistry,
  type SourceRegistry,
} from "./registry/source-registry.js";
export {
  createSpotPatchMiddleware,
  type CreateMiddlewareOptions,
  type SpotPatchMiddleware,
  type SpotPatchNext,
  type SpotPatchServerLogger,
} from "./server/middleware.js";
export { readJsonRequestBody } from "./server/request-body.js";
export {
  readRuntimeBootstrap,
  resolveRuntimeBootstrapOptions,
  type ResolvedRuntimeBootstrapOptions,
  type RuntimeBootstrapOptions,
} from "./server/runtime-bootstrap.js";
export { isLoopbackHostname } from "./server/request-security.js";
export {
  createSourceRegistrationService,
  type SourceRegistrationHandler,
  type SourceRegistrationService,
  type SourceRegistrationServiceOptions,
} from "./server/source-registration.js";
export { createSession, type SpotPatchSession } from "./session/session.js";
export {
  parseSerializedSpotPatchOptions,
  serializeResolvedSpotPatchOptions,
  type SerializedFilterEntry,
  type SerializedSpotPatchOptions,
} from "./transport-options.js";
