import type {
  AskAnswerDraft,
  AskSourceConfidence,
  ContextualAskErrorCode,
  ContextualAskExecutorCapability,
  SpotAskTaskEnvelope,
} from "@spotpatch/shared";

/**
 * Stable failure emitted by an Ask executor. The dev-server translates this
 * Node-only error into the public job error without exposing Provider details.
 */
export class ContextualAskExecutorError extends Error {
  readonly code: ContextualAskErrorCode;

  constructor(
    code: ContextualAskErrorCode,
    options: Readonly<{ cause?: unknown }> = {},
  ) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ContextualAskExecutorError";
    this.code = code;
  }
}

export interface AskSourceGrantEntry {
  readonly handleId: string;
  readonly fileId: string;
  readonly relativePath: string;
  readonly label: string;
  readonly lineCount: number;
  readonly size: number;
  readonly contentHash: string;
  readonly confidence: AskSourceConfidence;
  readonly targetIds: readonly string[];
  readonly sourceVersion?: string;
}

export interface AskSourceGrant {
  readonly contextHash: string;
  readonly truncated: boolean;
  readonly sources: readonly AskSourceGrantEntry[];
}

export interface AskSourceReadResult {
  readonly handleId: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly content: string;
}

export interface AskSourceSearchMatch {
  readonly handleId: string;
  readonly line: number;
  readonly preview: string;
}

/**
 * Read-only, immutable view captured before an executor starts. Implementations
 * must never expose absolute paths or consult the live workspace while reading.
 */
export interface ContextualAskReadSnapshot {
  manifest(): readonly AskSourceGrantEntry[];
  read(
    handleId: string,
    options?: Readonly<{ startLine?: number; endLine?: number }>,
  ): AskSourceReadResult;
  search(query: string): readonly AskSourceSearchMatch[];
}

export interface ContextualAskExecutorInput {
  readonly jobId: string;
  readonly envelope: SpotAskTaskEnvelope;
  readonly grant: AskSourceGrant;
  readonly snapshot: ContextualAskReadSnapshot;
}

export interface ContextualAskExecutor {
  readonly executorId: string;
  capability(signal: AbortSignal): Promise<ContextualAskExecutorCapability>;
  effectiveModelLabel?(): string | undefined;
  execute(
    input: ContextualAskExecutorInput,
    signal: AbortSignal,
  ): Promise<AskAnswerDraft>;
  dispose?(): Promise<void> | void;
}
