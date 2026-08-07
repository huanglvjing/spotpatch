import type {
  AgentLimits,
  ResolvedAiModelProfile,
  ResolvedOpenAICompatibleProviderOptions,
} from "@spotpatch/shared";

import type { ProviderCredential } from "./provider-credential.js";

export interface ProviderToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface ProviderToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface ProviderToolResult {
  readonly toolCallId: string;
  readonly output: unknown;
}

export interface ProviderTurn {
  readonly finalText: string;
  readonly toolCalls: readonly ProviderToolCall[];
}

export interface ProviderSession {
  readonly next: (
    toolResults: readonly ProviderToolResult[] | undefined,
    signal: AbortSignal,
  ) => Promise<ProviderTurn>;
}

export interface ProviderSessionOptions {
  readonly provider: ResolvedOpenAICompatibleProviderOptions;
  readonly model: ResolvedAiModelProfile;
  readonly credential: ProviderCredential;
  readonly instructions: string;
  readonly userPrompt: string;
  readonly tools: readonly ProviderToolDefinition[];
  readonly limits: Readonly<AgentLimits>;
  readonly fetch?: typeof globalThis.fetch;
}
