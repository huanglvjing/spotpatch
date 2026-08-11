import {
  ERROR_CODES,
  SpotPatchError,
  type AgentCheckResult,
  type AgentJobResult,
  type ResolvedAiExecutionOptions,
  type ResolvedAiModelProfile,
  type ResolvedOpenAICompatibleProviderOptions,
  type SpotAnnotation,
} from "@spotpatch/shared";

import { createOpenAICompatibleProviderSession } from "../provider/openai-compatible-provider.js";
import { assertUniqueToolCallIds } from "../provider/provider-parsing.js";
import type { ProviderCredential } from "../provider/provider-credential.js";
import type {
  ProviderToolCall,
  ProviderToolResult,
} from "../provider/provider-types.js";
import { collectProjectConventions } from "../context/project-conventions.js";
import { isRestartSensitivePath } from "../security/path-policy.js";
import { createAgentToolExecutor } from "../tools/tool-executor.js";
import {
  AGENT_TOOL_DEFINITIONS,
  isReadOnlyAgentTool,
} from "../tools/tool-definitions.js";
import { runConfiguredCheck } from "../validation/check-runner.js";
import { collectAgentChangeSet } from "../worktree/change-set.js";
import { createIsolatedGitWorktree } from "../worktree/git-worktree.js";
import {
  captureAgentFileHashes,
  createPreparedAgentChange,
  type PreparedAgentChange,
} from "../worktree/prepared-change.js";
import { AGENT_SYSTEM_INSTRUCTIONS, composeAgentUserPrompt } from "./agent-prompt.js";

export interface AgentExecutionCallbacks {
  readonly onCheck?: (result: AgentCheckResult) => void;
  readonly onPhase?: (
    event: Readonly<{
      phase: "preparing" | "running" | "validating";
      message: string;
    }>,
  ) => void;
  readonly onTool?: (
    event: Readonly<{
      turn: number;
      toolCallId: string;
      toolName: string;
      state: "started" | "succeeded" | "failed";
    }>,
  ) => void;
}

export interface ExecuteAgentChangeOptions {
  readonly annotation: SpotAnnotation;
  readonly callbacks?: AgentExecutionCallbacks;
  readonly credential: ProviderCredential;
  readonly execution: ResolvedAiExecutionOptions;
  readonly fetch?: typeof globalThis.fetch;
  readonly jobId: string;
  readonly model: ResolvedAiModelProfile;
  readonly promptMaxCharacters?: number;
  readonly provider: ResolvedOpenAICompatibleProviderOptions;
  readonly root: string;
  readonly signal: AbortSignal;
  readonly temporaryBase?: string;
  readonly workingTreeMode?: "require-clean" | "include-local-changes";
}

function isRetryableToolFailure(result: ProviderToolResult): boolean {
  const output = result.output;

  if (typeof output !== "object" || output === null) {
    return false;
  }

  const candidate = output as Readonly<Record<string, unknown>>;
  return (
    candidate.retryable === true &&
    (candidate.errorCode === ERROR_CODES.PATCH_REJECTED ||
      candidate.errorCode === ERROR_CODES.TOOL_ARGUMENTS_INVALID)
  );
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new SpotPatchError(ERROR_CODES.AGENT_CANCELLED);
  }
}

function linkSignal(source: AbortSignal, target: AbortController): () => void {
  const abort = (): void => {
    target.abort(source.reason);
  };

  if (source.aborted) {
    abort();
  } else {
    source.addEventListener("abort", abort, { once: true });
  }

  return () => {
    source.removeEventListener("abort", abort);
  };
}

async function executeToolCall(
  call: ProviderToolCall,
  turn: number,
  executor: ReturnType<typeof createAgentToolExecutor>,
  callbacks: AgentExecutionCallbacks | undefined,
  signal: AbortSignal,
): Promise<ProviderToolResult> {
  callbacks?.onTool?.(
    Object.freeze({
      turn,
      toolCallId: call.id,
      toolName: call.name,
      state: "started",
    }),
  );

  try {
    const result = await executor.execute(call, Object.freeze({ turn }), signal);
    callbacks?.onTool?.(
      Object.freeze({
        turn,
        toolCallId: call.id,
        toolName: call.name,
        state: isRetryableToolFailure(result) ? "failed" : "succeeded",
      }),
    );
    return result;
  } catch (error: unknown) {
    callbacks?.onTool?.(
      Object.freeze({
        turn,
        toolCallId: call.id,
        toolName: call.name,
        state: "failed",
      }),
    );
    throw error;
  }
}

async function executeToolCalls(
  calls: readonly ProviderToolCall[],
  turn: number,
  executor: ReturnType<typeof createAgentToolExecutor>,
  callbacks: AgentExecutionCallbacks | undefined,
  signal: AbortSignal,
): Promise<readonly ProviderToolResult[]> {
  if (calls.every((call) => isReadOnlyAgentTool(call.name))) {
    return Promise.all(
      calls.map((call) => executeToolCall(call, turn, executor, callbacks, signal)),
    );
  }

  const results: ProviderToolResult[] = [];

  for (const call of calls) {
    results.push(await executeToolCall(call, turn, executor, callbacks, signal));
  }

  return Object.freeze(results);
}

export async function executeAgentChange(
  options: ExecuteAgentChangeOptions,
): Promise<PreparedAgentChange> {
  const controller = new AbortController();
  const unlink = linkSignal(options.signal, controller);
  let jobTimedOut = false;
  const hasJobTimedOut = (): boolean => jobTimedOut;
  const timeout = setTimeout(() => {
    jobTimedOut = true;
    controller.abort("agent-job-timeout");
  }, options.execution.limits.jobTimeoutMs);
  timeout.unref();
  let worktree: Awaited<ReturnType<typeof createIsolatedGitWorktree>> | undefined;

  try {
    throwIfCancelled(controller.signal);
    options.callbacks?.onPhase?.(
      Object.freeze({
        phase: "preparing",
        message: "Preparing isolated Git worktree.",
      }),
    );
    worktree = await createIsolatedGitWorktree({
      root: options.root,
      signal: controller.signal,
      workingTreeMode: options.workingTreeMode ?? "require-clean",
      ...(options.temporaryBase === undefined
        ? {}
        : { temporaryBase: options.temporaryBase }),
    });
    options.callbacks?.onPhase?.(
      Object.freeze({
        phase: "running",
        message: "Running AI agent in isolated worktree.",
      }),
    );
    const executor = createAgentToolExecutor({
      checks: options.execution.checks,
      limits: options.execution.limits,
      worktreeRoot: worktree.root,
      onCheck(result) {
        options.callbacks?.onCheck?.(result);
      },
    });
    const projectConventions = await collectProjectConventions({
      root: worktree.root,
      annotation: options.annotation,
      maximumFileBytes: options.execution.limits.maxReadBytesPerFile,
    });
    const session = createOpenAICompatibleProviderSession({
      provider: options.provider,
      model: options.model,
      credential: options.credential,
      instructions: AGENT_SYSTEM_INSTRUCTIONS,
      userPrompt: composeAgentUserPrompt(
        options.annotation,
        options.promptMaxCharacters ?? 16_000,
        Object.freeze({
          checks: options.execution.checks,
          projectConventions,
        }),
      ),
      tools: AGENT_TOOL_DEFINITIONS,
      limits: options.execution.limits,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
    let pendingResults: readonly ProviderToolResult[] | undefined;
    let summary: string | undefined;
    let toolCallCount = 0;

    for (let turn = 0; turn < options.execution.limits.maxTurns; turn += 1) {
      const turnNumber = turn + 1;
      throwIfCancelled(controller.signal);
      const response = await session.next(pendingResults, controller.signal);
      assertUniqueToolCallIds(response.toolCalls);

      if (response.toolCalls.length === 0) {
        if (toolCallCount === 0) {
          throw new SpotPatchError(ERROR_CODES.MODEL_TOOL_CALL_UNSUPPORTED);
        }

        summary = response.finalText
          .trim()
          .slice(0, options.execution.limits.maxToolOutputCharacters);
        break;
      }

      toolCallCount += response.toolCalls.length;

      if (toolCallCount > options.execution.limits.maxToolCalls) {
        throw new SpotPatchError(ERROR_CODES.AGENT_LIMIT_EXCEEDED);
      }

      pendingResults = await executeToolCalls(
        response.toolCalls,
        turnNumber,
        executor,
        options.callbacks,
        controller.signal,
      );
    }

    if (summary === undefined) {
      throw new SpotPatchError(ERROR_CODES.AGENT_LIMIT_EXCEEDED);
    }

    options.callbacks?.onPhase?.(
      Object.freeze({
        phase: "validating",
        message: "Validating proposed changes.",
      }),
    );
    const initialChangeSet = await collectAgentChangeSet(
      worktree.root,
      executor.touchedPaths(),
      options.execution.limits,
      controller.signal,
    );
    const requiredChecks =
      initialChangeSet.diff.length === 0
        ? []
        : Object.values(options.execution.checks).filter((check) => check.required);
    const finalChecks: AgentCheckResult[] = [];
    let ranFinalCheck = false;

    for (const check of requiredChecks) {
      throwIfCancelled(controller.signal);
      const cached = executor.latestCheckResult(check.id);
      const result =
        cached ??
        (await runConfiguredCheck({
          check,
          maxOutputCharacters: options.execution.limits.maxToolOutputCharacters,
          signal: controller.signal,
          worktreeRoot: worktree.root,
        }));
      finalChecks.push(result);

      if (cached === undefined) {
        ranFinalCheck = true;
        options.callbacks?.onCheck?.(result);
      }
    }

    if (ranFinalCheck) {
      const afterChecks = await collectAgentChangeSet(
        worktree.root,
        executor.touchedPaths(),
        options.execution.limits,
        controller.signal,
      );

      if (afterChecks.diff !== initialChangeSet.diff) {
        throw new SpotPatchError(ERROR_CODES.VALIDATION_FAILED);
      }
    }

    const validationPassed = finalChecks.every((check) => check.status === "passed");
    const result = Object.freeze({
      jobId: options.jobId,
      summary,
      diff: initialChangeSet.diff,
      files: initialChangeSet.files,
      checks: Object.freeze(finalChecks),
    } satisfies AgentJobResult);
    const autoApplyEligible =
      options.execution.applyMode === "auto" &&
      validationPassed &&
      result.diff.length > 0 &&
      !initialChangeSet.hasDeletion &&
      !initialChangeSet.touchedPaths.some(isRestartSensitivePath);
    const [expectedHashes, baselineHashes] = await Promise.all([
      captureAgentFileHashes(worktree.root, initialChangeSet.touchedPaths),
      captureAgentFileHashes(worktree.baseline.root, initialChangeSet.touchedPaths),
    ]);

    return createPreparedAgentChange({
      autoApplyEligible,
      baselineHead: worktree.baseline.head,
      baselineHashes,
      expectedHashes,
      result,
      root: worktree.baseline.root,
      validationPassed,
    });
  } catch (error: unknown) {
    if (options.signal.aborted) {
      throw new SpotPatchError(ERROR_CODES.AGENT_CANCELLED);
    }

    if (hasJobTimedOut()) {
      throw new SpotPatchError(ERROR_CODES.AGENT_LIMIT_EXCEEDED);
    }

    if (error instanceof SpotPatchError) {
      throw error;
    }

    throw new SpotPatchError(ERROR_CODES.INTERNAL_ERROR);
  } finally {
    clearTimeout(timeout);
    unlink();
    await worktree?.cleanup();
  }
}
