export {
  createAgentJobManager,
  type AgentJobEventListener,
  type AgentJobManager,
  type CreateAgentJobManagerOptions,
} from "./agent/job-manager.js";
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
  DEFAULT_EXCLUDE,
  DEFAULT_OPTIONS,
  resolveOptions,
  type FilterEntry,
  type ResolvedSpotPatchOptions,
  type SimpleAiOptions,
  type SpotPatchAiOptions,
  type SpotPatchOptions,
} from "./options.js";
export {
  resolveProjectOptions,
  type ResolveProjectOptionsInput,
} from "./project-options.js";
export {
  discoverProjectValidationCheck,
  type DiscoverProjectValidationCheckOptions,
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
