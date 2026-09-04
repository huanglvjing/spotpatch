import { ContextualAskExecutorError } from "@spotpatch/agent";
import type { ContextualAskErrorCode } from "@spotpatch/shared";

export class ContextualAskError extends Error {
  readonly code: ContextualAskErrorCode;

  constructor(
    code: ContextualAskErrorCode,
    options: Readonly<{ cause?: unknown }> = {},
  ) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ContextualAskError";
    this.code = code;
  }
}

export function asContextualAskError(error: unknown): ContextualAskError {
  if (error instanceof ContextualAskError) return error;
  if (error instanceof ContextualAskExecutorError) {
    return new ContextualAskError(error.code, { cause: error });
  }
  return new ContextualAskError("ASK_EXECUTOR_UNAVAILABLE", { cause: error });
}
