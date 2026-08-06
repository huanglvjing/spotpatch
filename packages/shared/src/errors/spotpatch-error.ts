import type { ErrorCode } from "./error-code.js";

export class SpotPatchError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message = code, options?: ErrorOptions) {
    super(message, options);
    this.name = "SpotPatchError";
    this.code = code;
  }
}
