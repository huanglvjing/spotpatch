import {
  ERROR_CODES,
  SpotPatchError,
  type AgentCapabilitySnapshot,
  type AgentLimits,
  type ResolvedOpenAICompatibleProviderOptions,
} from "@spotpatch/shared";

import { createOpenAICompatibleProviderSession } from "./openai-compatible-provider.js";
import {
  resolveProviderCredential,
  type ProviderCredential,
} from "./provider-credential.js";

interface ProbeProviderCapabilityOptions {
  readonly provider: ResolvedOpenAICompatibleProviderOptions;
  readonly modelProfileId: string;
  readonly limits: Readonly<AgentLimits>;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly credential?: ProviderCredential;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => string;
  readonly signal: AbortSignal;
}

const PROBE_TOOL_NAME = "spotpatch_capability_probe";
const PROBE_TOKEN = "spotpatch-ready-v1";

export async function probeProviderCapability(
  options: ProbeProviderCapabilityOptions,
): Promise<AgentCapabilitySnapshot> {
  const model = options.provider.models[options.modelProfileId];

  if (model === undefined) {
    throw new SpotPatchError(ERROR_CODES.MODEL_NOT_ALLOWED);
  }

  const credential =
    options.credential ??
    resolveProviderCredential(options.provider.apiKeyEnv, options.environment);
  const session = createOpenAICompatibleProviderSession({
    provider: options.provider,
    model,
    credential,
    instructions:
      "This is a capability check. Call only the declared probe tool, then confirm completion.",
    userPrompt: `Call ${PROBE_TOOL_NAME} with token ${PROBE_TOKEN}.`,
    tools: Object.freeze([
      Object.freeze({
        name: PROBE_TOOL_NAME,
        description: "Confirms structured tool calling and result continuation.",
        parameters: Object.freeze({
          type: "object",
          properties: Object.freeze({
            token: Object.freeze({ type: "string", const: PROBE_TOKEN }),
          }),
          required: Object.freeze(["token"]),
          additionalProperties: false,
        }),
      }),
    ]),
    limits: options.limits,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const first = await session.next(undefined, options.signal);
  const probeCall = first.toolCalls[0];

  if (
    first.toolCalls.length !== 1 ||
    probeCall?.name !== PROBE_TOOL_NAME ||
    probeCall.arguments.token !== PROBE_TOKEN
  ) {
    throw new SpotPatchError(ERROR_CODES.MODEL_TOOL_CALL_UNSUPPORTED);
  }

  const second = await session.next(
    Object.freeze([
      Object.freeze({
        toolCallId: probeCall.id,
        output: Object.freeze({ ok: true }),
      }),
    ]),
    options.signal,
  );

  if (second.toolCalls.length !== 0 || second.finalText.trim().length === 0) {
    throw new SpotPatchError(ERROR_CODES.MODEL_TOOL_CALL_UNSUPPORTED);
  }

  return Object.freeze({
    providerProfileId: options.provider.id,
    providerLabel: options.provider.label,
    modelProfileId: model.id,
    modelLabel: model.label,
    protocol: options.provider.protocol,
    state: "agent-ready",
    authenticated: true,
    modelAvailable: true,
    toolCalling: true,
    toolResultContinuation: true,
    streaming: true,
    checkedAt: (options.now ?? (() => new Date().toISOString()))(),
  });
}
