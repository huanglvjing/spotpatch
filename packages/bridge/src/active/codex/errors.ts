export const CODEX_ADAPTER_ERROR_CODES = Object.freeze({
  BUSY: "CODEX_ADAPTER_BUSY",
  CLOSED: "CODEX_ADAPTER_CLOSED",
  EXECUTABLE_NOT_FOUND: "CODEX_EXECUTABLE_NOT_FOUND",
  EXECUTABLE_UNTRUSTED: "CODEX_EXECUTABLE_UNTRUSTED",
  MCP_NOT_READY: "CODEX_MCP_NOT_READY",
  PROCESS_EXITED: "CODEX_PROCESS_EXITED",
  PROTOCOL: "CODEX_APP_SERVER_PROTOCOL_ERROR",
  REQUEST_FAILED: "CODEX_APP_SERVER_REQUEST_FAILED",
  REQUEST_TIMEOUT: "CODEX_APP_SERVER_REQUEST_TIMEOUT",
  UNSUPPORTED_VERSION: "CODEX_UNSUPPORTED_VERSION",
  WORKSPACE_WRITE_REQUIRED: "CODEX_WORKSPACE_WRITE_REQUIRED",
} as const);

export type CodexAdapterErrorCode =
  (typeof CODEX_ADAPTER_ERROR_CODES)[keyof typeof CODEX_ADAPTER_ERROR_CODES];

export class CodexAdapterError extends Error {
  readonly code: CodexAdapterErrorCode;

  constructor(code: CodexAdapterErrorCode, cause?: unknown) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = "CodexAdapterError";
    this.code = code;
  }
}
