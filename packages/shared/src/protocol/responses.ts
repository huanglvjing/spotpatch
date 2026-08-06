import type { ErrorCode } from "../errors/error-code.js";

export interface ApiSuccess<T> {
  readonly ok: true;
  readonly data: T;
}

export interface ApiFailure {
  readonly ok: false;
  readonly error: Readonly<{
    code: ErrorCode;
    message: string;
  }>;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
