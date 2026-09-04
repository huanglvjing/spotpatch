import { createHash } from "node:crypto";

import {
  CONTEXTUAL_ASK_ERROR_CODES,
  CONTEXTUAL_ASK_LIMITS,
  CONTEXTUAL_ASK_SCHEMA_VERSION,
  ERROR_CODES,
  SpotPatchError,
  type AgentLimits,
  type ContextualAskErrorCode,
  type ContextualAskExecutorCapability,
  type ResolvedAiModelProfile,
  type ResolvedOpenAICompatibleProviderOptions,
} from "@spotpatch/shared";

import { createOpenAICompatibleProviderSession } from "../provider/openai-compatible-provider.js";
import { assertUniqueToolCallIds } from "../provider/provider-parsing.js";
import type { ProviderCredential } from "../provider/provider-credential.js";
import type {
  ProviderSession,
  ProviderToolResult,
} from "../provider/provider-types.js";
import {
  createConfiguredKeyAskPrompt,
  CONFIGURED_KEY_ASK_SYSTEM_INSTRUCTIONS,
  type ConfiguredKeyAskObservedRange,
} from "./configured-key-prompt.js";
import {
  createConfiguredKeyAskToolController,
  CONFIGURED_KEY_ASK_TOOL_NAMES,
  CONFIGURED_KEY_ASK_TOOLS,
} from "./configured-key-tools.js";
import {
  ContextualAskExecutorError,
  type AskSourceGrantEntry,
  type ContextualAskExecutor,
  type ContextualAskExecutorInput,
} from "./executor-port.js";

const CAPABILITY_CACHE_TTL_MS = 5 * 60_000;
const CAPABILITY_FAILURE_CACHE_TTL_MS = 30_000;
const CAPABILITY_SOURCE_ID = "ask_capability_source";
const CAPABILITY_TARGET_ID = "ask_capability_target";
const CAPABILITY_CONTENT =
  "SpotPatch Configured Key Ask validates read-only tool-result continuation.";
const CAPABILITY_CONTENT_HASH = createHash("sha256")
  .update(CAPABILITY_CONTENT)
  .digest("hex");

export interface CreateConfiguredKeyAskExecutorOptions {
  readonly credential: ProviderCredential;
  readonly fetch?: typeof globalThis.fetch;
  readonly limits: Readonly<AgentLimits>;
  readonly model: ResolvedAiModelProfile;
  readonly provider: ResolvedOpenAICompatibleProviderOptions;
  readonly dependencies?: Readonly<{ now?: () => number }>;
}

interface AskLoopResult {
  readonly answer: Awaited<ReturnType<ContextualAskExecutor["execute"]>>;
  readonly toolNames: readonly string[];
  readonly totalToolCalls: number;
  readonly turns: number;
}

interface CachedCapability {
  readonly expiresAt: number;
  readonly value: ContextualAskExecutorCapability;
}

interface CapabilityProbe {
  readonly controller: AbortController;
  readonly promise: Promise<ContextualAskExecutorCapability>;
  settled: boolean;
  waiters: number;
}

function raceWithCancellation<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) return Promise.reject(cancellationError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(cancellationError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error instanceof Error ? error : new Error("Ask capability failed."));
      },
    );
  });
}

function isContextualAskErrorCode(value: unknown): value is ContextualAskErrorCode {
  return (
    typeof value === "string" &&
    (CONTEXTUAL_ASK_ERROR_CODES as readonly string[]).includes(value)
  );
}

function cancellationError(signal: AbortSignal): ContextualAskExecutorError {
  const reason: unknown = signal.reason;
  if (
    typeof reason === "object" &&
    reason !== null &&
    "code" in reason &&
    isContextualAskErrorCode(reason.code)
  ) {
    return new ContextualAskExecutorError(reason.code, { cause: reason });
  }
  return new ContextualAskExecutorError("ASK_CANCELLED", { cause: reason });
}

function normalizeExecutorError(
  error: unknown,
  signal: AbortSignal,
): ContextualAskExecutorError {
  if (error instanceof ContextualAskExecutorError) return error;
  if (signal.aborted) return cancellationError(signal);
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    isContextualAskErrorCode(error.code)
  ) {
    return new ContextualAskExecutorError(error.code, { cause: error });
  }
  if (error instanceof SpotPatchError) {
    switch (error.code) {
      case ERROR_CODES.AGENT_CANCELLED:
        return new ContextualAskExecutorError("ASK_CANCELLED", { cause: error });
      case ERROR_CODES.AGENT_LIMIT_EXCEEDED:
        return new ContextualAskExecutorError("ASK_LIMIT_EXCEEDED", {
          cause: error,
        });
      case ERROR_CODES.TOOL_ARGUMENTS_INVALID:
      case ERROR_CODES.TOOL_CALL_ID_CONFLICT:
      case ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED:
        return new ContextualAskExecutorError("ASK_ANSWER_INVALID", {
          cause: error,
        });
      default:
        return new ContextualAskExecutorError("ASK_EXECUTOR_UNAVAILABLE", {
          cause: error,
        });
    }
  }
  return new ContextualAskExecutorError("ASK_EXECUTOR_UNAVAILABLE", {
    cause: error,
  });
}

function askProviderLimits(limits: Readonly<AgentLimits>): Readonly<AgentLimits> {
  return Object.freeze({
    ...limits,
    maxTurns: Math.min(limits.maxTurns, CONTEXTUAL_ASK_LIMITS.maximumModelTurns),
    maxToolCalls: Math.min(limits.maxToolCalls, CONTEXTUAL_ASK_LIMITS.maximumToolCalls),
    maxToolOutputCharacters: Math.min(
      limits.maxToolOutputCharacters,
      CONTEXTUAL_ASK_LIMITS.maximumAnswerCharacters,
    ),
    jobTimeoutMs: Math.min(limits.jobTimeoutMs, CONTEXTUAL_ASK_LIMITS.jobTimeoutMs),
  });
}

function linkSignal(source: AbortSignal, target: AbortController): () => void {
  const abort = (): void => {
    target.abort(source.reason);
  };
  if (source.aborted) abort();
  else source.addEventListener("abort", abort, { once: true });
  return () => {
    source.removeEventListener("abort", abort);
  };
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw cancellationError(signal);
}

async function runAskLoop(
  options: Readonly<{
    input: ContextualAskExecutorInput;
    initialObservedRanges: readonly ConfiguredKeyAskObservedRange[];
    limits: Readonly<AgentLimits>;
    session: ProviderSession;
    signal: AbortSignal;
  }>,
): Promise<AskLoopResult> {
  const tools = createConfiguredKeyAskToolController(
    options.input,
    options.limits.maxToolOutputCharacters,
    options.initialObservedRanges,
  );
  let pendingResults: readonly ProviderToolResult[] | undefined;
  let totalToolCalls = 0;
  const toolNames: string[] = [];

  for (let turnIndex = 0; turnIndex < options.limits.maxTurns; turnIndex += 1) {
    throwIfCancelled(options.signal);
    let turn;
    try {
      turn = await options.session.next(pendingResults, options.signal);
      assertUniqueToolCallIds(turn.toolCalls);
    } catch (error: unknown) {
      throw normalizeExecutorError(error, options.signal);
    }
    if (turn.finalText.trim().length > 0 || turn.toolCalls.length === 0) {
      throw new ContextualAskExecutorError("ASK_ANSWER_INVALID");
    }

    totalToolCalls += turn.toolCalls.length;
    if (totalToolCalls > options.limits.maxToolCalls) {
      throw new ContextualAskExecutorError("ASK_LIMIT_EXCEEDED");
    }
    toolNames.push(...turn.toolCalls.map((call) => call.name));
    const submission = turn.toolCalls.find(
      (call) => call.name === CONFIGURED_KEY_ASK_TOOL_NAMES.submitAnswer,
    );
    if (submission !== undefined) {
      if (turn.toolCalls.length !== 1) {
        throw new ContextualAskExecutorError("ASK_ANSWER_INVALID");
      }
      const answer = tools.parseSubmission(submission);
      throwIfCancelled(options.signal);
      return Object.freeze({
        answer,
        toolNames: Object.freeze(toolNames),
        totalToolCalls,
        turns: turnIndex + 1,
      });
    }

    pendingResults = Object.freeze(
      await Promise.all(
        turn.toolCalls.map((call) => Promise.resolve(tools.executeRead(call))),
      ),
    );
  }
  throw new ContextualAskExecutorError("ASK_LIMIT_EXCEEDED");
}

function capabilityInput(): ContextualAskExecutorInput {
  const source = Object.freeze({
    handleId: CAPABILITY_SOURCE_ID,
    fileId: "ask_capability_file",
    relativePath: "spotpatch-capability/readonly.txt",
    label: "Read-only capability fixture",
    lineCount: 1,
    size: CAPABILITY_CONTENT.length,
    contentHash: CAPABILITY_CONTENT_HASH,
    confidence: "exact",
    targetIds: Object.freeze([CAPABILITY_TARGET_ID]),
  }) satisfies AskSourceGrantEntry;
  return Object.freeze({
    jobId: "ask_capability_job",
    envelope: Object.freeze({
      schemaVersion: CONTEXTUAL_ASK_SCHEMA_VERSION,
      taskId: "ask_capability_task",
      task: Object.freeze({
        kind: "ask",
        question:
          "Read the declared capability source, then explain what it validates with one citation.",
      }),
      selection: Object.freeze({
        schemaVersion: CONTEXTUAL_ASK_SCHEMA_VERSION,
        selectionId: "ask_capability_selection",
        locale: "en-US",
        createdAt: "2026-01-01T00:00:00.000Z",
        targets: [
          {
            targetId: CAPABILITY_TARGET_ID,
            page: Object.freeze({
              url: "http://spotpatch.invalid/capability",
              pathname: "/capability",
              title: "Capability fixture",
              viewportWidth: 1,
              viewportHeight: 1,
              devicePixelRatio: 1,
            }),
            source: Object.freeze({
              fileId: source.fileId,
              relativePath: source.relativePath,
              line: 1,
              column: 1,
              origin: "jsx-host",
              confidence: "exact",
            }),
            react: Object.freeze({
              supported: false,
              componentStack: [],
            }),
            element: Object.freeze({
              tagName: "div",
              selector: "[data-spotpatch-capability]",
              sanitizedHtml: "<div data-spotpatch-capability></div>",
              rect: Object.freeze({ x: 0, y: 0, width: 1, height: 1 }),
            }),
            styles: Object.freeze({
              classNames: [],
              matchedRules: [],
              computed: {},
              warnings: [],
            }),
            warnings: [],
          },
        ],
      }),
      createdAt: "2026-01-01T00:00:00.000Z",
    }),
    grant: Object.freeze({
      contextHash: CAPABILITY_CONTENT_HASH,
      truncated: false,
      sources: Object.freeze([source]),
    }),
    snapshot: Object.freeze({
      manifest: () => Object.freeze([source]),
      read(
        handleId: string,
        range: Readonly<{ startLine?: number; endLine?: number }> = {},
      ) {
        if (
          handleId !== source.handleId ||
          (range.startLine ?? 1) !== 1 ||
          (range.endLine ?? 1) !== 1
        ) {
          throw new ContextualAskExecutorError("ASK_SOURCE_SCOPE_DENIED");
        }
        return Object.freeze({
          handleId,
          startLine: 1,
          endLine: 1,
          content: CAPABILITY_CONTENT,
        });
      },
      search(query: string) {
        return CAPABILITY_CONTENT.toLocaleLowerCase("en-US").includes(
          query.toLocaleLowerCase("en-US"),
        )
          ? Object.freeze([
              Object.freeze({
                handleId: source.handleId,
                line: 1,
                preview: CAPABILITY_CONTENT,
              }),
            ])
          : Object.freeze([]);
      },
    }),
  });
}

export function createConfiguredKeyAskExecutorId(
  provider: ResolvedOpenAICompatibleProviderOptions,
  model: ResolvedAiModelProfile,
): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        askProtocolVersion: CONTEXTUAL_ASK_SCHEMA_VERSION,
        providerId: provider.id,
        providerType: provider.type,
        protocol: provider.protocol,
        authentication: provider.authentication,
        baseURL: provider.baseURL,
        modelProfileId: model.id,
        model: model.model,
      }),
    )
    .digest("base64url")
    .slice(0, 24);
  return `ask_key_${digest}`;
}

export function createConfiguredKeyAskExecutor(
  options: CreateConfiguredKeyAskExecutorOptions,
): ContextualAskExecutor {
  const limits = askProviderLimits(options.limits);
  const executorId = createConfiguredKeyAskExecutorId(options.provider, options.model);
  const label = `${options.provider.label} · ${options.model.label}`;
  const now = options.dependencies?.now ?? Date.now;
  let cachedCapability: CachedCapability | undefined;
  let capabilityProbe: CapabilityProbe | undefined;

  const capabilityValue = (ready: boolean): ContextualAskExecutorCapability =>
    Object.freeze({
      executorId,
      kind: "configured-key",
      label,
      requestedModelLabel: options.model.label,
      effectiveModelLabel: options.model.label,
      state: ready ? "ready" : "unavailable",
      providerDataConsentRequired: true,
      readOnlyProven: true,
      ...(ready ? {} : { errorCode: "ASK_EXECUTOR_UNAVAILABLE" as const }),
    });

  const createSession = (instructions: string, userPrompt: string) =>
    createOpenAICompatibleProviderSession({
      provider: options.provider,
      model: options.model,
      credential: options.credential,
      instructions,
      userPrompt,
      tools: CONFIGURED_KEY_ASK_TOOLS,
      limits,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });

  const probeCapability = async (
    signal: AbortSignal,
  ): Promise<ContextualAskExecutorCapability> => {
    const input = capabilityInput();
    const prompt = createConfiguredKeyAskPrompt(input);
    try {
      const result = await runAskLoop({
        input,
        initialObservedRanges: prompt.initialObservedRanges,
        limits,
        session: createSession(
          `${CONFIGURED_KEY_ASK_SYSTEM_INSTRUCTIONS}\n- Capability check: you must call read_source for sourceId ${CAPABILITY_SOURCE_ID} line 1 before submit_answer.`,
          prompt.userPrompt,
        ),
        signal,
      });
      if (
        result.turns < 2 ||
        !result.toolNames.includes(CONFIGURED_KEY_ASK_TOOL_NAMES.readSource)
      ) {
        throw new ContextualAskExecutorError("ASK_EXECUTOR_UNAVAILABLE");
      }
      const value = capabilityValue(true);
      cachedCapability = Object.freeze({
        expiresAt: now() + CAPABILITY_CACHE_TTL_MS,
        value,
      });
      return value;
    } catch {
      if (signal.aborted) throw cancellationError(signal);
      const value = capabilityValue(false);
      cachedCapability = Object.freeze({
        expiresAt: now() + CAPABILITY_FAILURE_CACHE_TTL_MS,
        value,
      });
      return value;
    }
  };

  return Object.freeze({
    executorId,

    async capability(signal: AbortSignal) {
      throwIfCancelled(signal);
      if (cachedCapability !== undefined && cachedCapability.expiresAt > now()) {
        return cachedCapability.value;
      }
      if (capabilityProbe === undefined) {
        const controller = new AbortController();
        const started = probeCapability(controller.signal);
        const probe: CapabilityProbe = {
          controller,
          promise: started,
          settled: false,
          waiters: 0,
        };
        capabilityProbe = probe;
        const clear = (): void => {
          probe.settled = true;
          if (capabilityProbe === probe) capabilityProbe = undefined;
        };
        void started.then(clear, clear);
      }
      const probe = capabilityProbe;
      probe.waiters += 1;
      try {
        return await raceWithCancellation(probe.promise, signal);
      } finally {
        probe.waiters -= 1;
        if (!probe.settled && probe.waiters === 0) {
          probe.controller.abort(new ContextualAskExecutorError("ASK_CANCELLED"));
        }
      }
    },

    async execute(input: ContextualAskExecutorInput, signal: AbortSignal) {
      const controller = new AbortController();
      const unlink = linkSignal(signal, controller);
      const timeout = setTimeout(() => {
        controller.abort(new ContextualAskExecutorError("ASK_EXECUTOR_UNAVAILABLE"));
      }, limits.jobTimeoutMs);
      timeout.unref();
      try {
        throwIfCancelled(controller.signal);
        const prompt = createConfiguredKeyAskPrompt(input);
        const result = await runAskLoop({
          input,
          initialObservedRanges: prompt.initialObservedRanges,
          limits,
          session: createSession(prompt.instructions, prompt.userPrompt),
          signal: controller.signal,
        });
        return result.answer;
      } catch (error: unknown) {
        throw normalizeExecutorError(error, controller.signal);
      } finally {
        clearTimeout(timeout);
        unlink();
      }
    },
  });
}
