export {
  executeAgentChange,
  type AgentExecutionCallbacks,
  type ExecuteAgentChangeOptions,
} from "./engine/execute-agent-change.js";
export { probeProviderCapability } from "./provider/capability-probe.js";
export { createOpenAICompatibleProviderSession } from "./provider/openai-compatible-provider.js";
export {
  createProviderCredential,
  resolveProviderCredential,
  type ProviderCredential,
} from "./provider/provider-credential.js";
export type {
  ProviderSession,
  ProviderSessionOptions,
  ProviderToolCall,
  ProviderToolDefinition,
  ProviderToolResult,
  ProviderTurn,
} from "./provider/provider-types.js";
export {
  applyPreparedAgentChange,
  revertPreparedAgentChange,
  type PreparedAgentChange,
} from "./worktree/prepared-change.js";
export {
  createManagedExecutionRunner,
  type AuthorizedManagedTask,
  type CreateManagedExecutionRunnerOptions,
  type ManagedExecutionPort,
  type ManagedExecutionPhaseObserver,
  type ManagedExecutionResult,
  type PreparedManagedTask,
} from "./managed/managed-execution.js";
export { inspectAgentWorkspace } from "./worktree/workspace-health.js";
