import type { ErrorCode } from "../errors/error-code.js";

export type AiProviderProtocol = "responses" | "chat-completions";
export type AgentApplyMode = "review" | "auto";

export interface AiModelProfile {
  readonly label: string;
  readonly model: string;
}

export interface OpenAICompatibleProviderOptions {
  readonly type: "openai-compatible";
  readonly label: string;
  readonly protocol: AiProviderProtocol;
  readonly baseURL: string;
  readonly apiKeyEnv: string;
  readonly models: Readonly<Record<string, AiModelProfile>>;
  readonly defaultModel: string;
}

export interface AgentCheckDefinition {
  readonly label: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly required?: boolean;
  readonly timeoutMs?: number;
}

export interface AgentLimits {
  readonly maxTurns: number;
  readonly maxToolCalls: number;
  readonly maxChangedFiles: number;
  readonly maxDiffBytes: number;
  readonly maxReadBytesPerFile: number;
  readonly maxToolOutputCharacters: number;
  readonly maxProviderResponseBytes: number;
  readonly providerConnectTimeoutMs: number;
  readonly providerFirstByteTimeoutMs: number;
  readonly providerIdleTimeoutMs: number;
  readonly checkTimeoutMs: number;
  readonly jobTimeoutMs: number;
}

export const DEFAULT_AGENT_LIMITS = Object.freeze({
  maxTurns: 20,
  maxToolCalls: 80,
  maxChangedFiles: 20,
  maxDiffBytes: 512_000,
  maxReadBytesPerFile: 256_000,
  maxToolOutputCharacters: 40_000,
  maxProviderResponseBytes: 2_000_000,
  providerConnectTimeoutMs: 15_000,
  providerFirstByteTimeoutMs: 30_000,
  providerIdleTimeoutMs: 60_000,
  checkTimeoutMs: 120_000,
  jobTimeoutMs: 600_000,
} satisfies AgentLimits);

export interface AiExecutionOptions {
  readonly isolation?: "git-worktree";
  readonly applyMode?: AgentApplyMode;
  readonly checks?: Readonly<Record<string, AgentCheckDefinition>>;
  readonly limits?: Partial<AgentLimits>;
}

export interface AiOptions {
  readonly providers: Readonly<Record<string, OpenAICompatibleProviderOptions>>;
  readonly defaultProvider: string;
  readonly execution?: AiExecutionOptions;
}

export interface ResolvedAiModelProfile extends AiModelProfile {
  readonly id: string;
}

export interface ResolvedOpenAICompatibleProviderOptions {
  readonly id: string;
  readonly type: "openai-compatible";
  readonly label: string;
  readonly protocol: AiProviderProtocol;
  readonly baseURL: string;
  readonly apiKeyEnv: string;
  readonly models: Readonly<Record<string, ResolvedAiModelProfile>>;
  readonly defaultModel: string;
}

export interface ResolvedAgentCheckDefinition {
  readonly id: string;
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly required: boolean;
  readonly timeoutMs: number;
}

export interface ResolvedAiExecutionOptions {
  readonly isolation: "git-worktree";
  readonly applyMode: AgentApplyMode;
  readonly checks: Readonly<Record<string, ResolvedAgentCheckDefinition>>;
  readonly limits: Readonly<AgentLimits>;
}

export interface ResolvedAiOptions {
  readonly providers: Readonly<Record<string, ResolvedOpenAICompatibleProviderOptions>>;
  readonly defaultProvider: string;
  readonly execution: ResolvedAiExecutionOptions;
}

export interface RuntimeAiModelProfile {
  readonly id: string;
  readonly label: string;
}

export interface RuntimeAiProviderProfile {
  readonly id: string;
  readonly label: string;
  readonly protocol: AiProviderProtocol;
  readonly models: readonly RuntimeAiModelProfile[];
  readonly defaultModel: string;
}

export type RuntimeAiConfig =
  | Readonly<{ enabled: false }>
  | Readonly<{
      enabled: true;
      providers: readonly RuntimeAiProviderProfile[];
      defaultProvider: string;
      applyMode: AgentApplyMode;
    }>;

export const AGENT_JOB_STATUSES = Object.freeze([
  "queued",
  "preparing",
  "running",
  "validating",
  "awaiting-review",
  "applying",
  "applied",
  "completed",
  "cancelling",
  "cancelled",
  "reverting",
  "reverted",
  "failed",
] as const);

export type AgentJobStatus = (typeof AGENT_JOB_STATUSES)[number];

export const AGENT_CAPABILITY_STATES = Object.freeze([
  "unknown",
  "probing",
  "agent-ready",
  "prompt-only",
  "unavailable",
] as const);

export type AgentCapabilityState = (typeof AGENT_CAPABILITY_STATES)[number];

export interface AgentCapabilitySnapshot {
  readonly providerProfileId: string;
  readonly providerLabel: string;
  readonly modelProfileId: string;
  readonly modelLabel: string;
  readonly protocol: AiProviderProtocol;
  readonly state: AgentCapabilityState;
  readonly authenticated: boolean;
  readonly modelAvailable: boolean;
  readonly toolCalling: boolean;
  readonly toolResultContinuation: boolean;
  readonly streaming: boolean;
  readonly checkedAt?: string;
  readonly errorCode?: ErrorCode;
}

export const AGENT_FILE_CHANGE_KINDS = Object.freeze([
  "added",
  "modified",
  "deleted",
] as const);

export type AgentFileChangeKind = (typeof AGENT_FILE_CHANGE_KINDS)[number];

export const AGENT_CHECK_STATUSES = Object.freeze([
  "passed",
  "failed",
  "cancelled",
  "timed-out",
] as const);

export type AgentCheckStatus = (typeof AGENT_CHECK_STATUSES)[number];

export interface AgentChangedFile {
  readonly relativePath: string;
  readonly kind: AgentFileChangeKind;
  readonly additions: number;
  readonly deletions: number;
}

export interface AgentCheckResult {
  readonly checkId: string;
  readonly label: string;
  readonly status: AgentCheckStatus;
  readonly durationMs: number;
  readonly output: string;
}

export interface AgentJobSnapshot {
  readonly jobId: string;
  readonly status: AgentJobStatus;
  readonly providerProfileId: string;
  readonly providerLabel: string;
  readonly modelProfileId: string;
  readonly modelLabel: string;
  readonly phaseMessage: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly canCancel: boolean;
  readonly canApply: boolean;
  readonly canRevert: boolean;
  readonly errorCode?: ErrorCode;
}

export interface AgentJobResult {
  readonly jobId: string;
  readonly summary: string;
  readonly diff: string;
  readonly files: readonly AgentChangedFile[];
  readonly checks: readonly AgentCheckResult[];
}

export interface AgentJobResultResponse {
  readonly snapshot: AgentJobSnapshot;
  readonly result?: AgentJobResult;
}
