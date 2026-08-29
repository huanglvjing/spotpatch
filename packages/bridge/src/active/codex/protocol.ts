import type { ChildProcessWithoutNullStreams } from "node:child_process";

import {
  CODEX_ADAPTER_ERROR_CODES,
  CodexAdapterError,
  CodexRemoteRequestError,
} from "./errors.js";

const DEFAULT_MAXIMUM_LINE_BYTES = 1_048_576;
const DEFAULT_MAXIMUM_STDERR_BYTES = 65_536;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const MAXIMUM_PENDING_REQUESTS = 16;

type JsonRecord = Readonly<Record<string, unknown>>;
type NotificationEnvelope = JsonRecord & Readonly<{ method: string; params: unknown }>;

interface PendingRequest {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: CodexAdapterError) => void;
  readonly timeout: NodeJS.Timeout;
}

export interface CodexProtocolDiagnostics {
  readonly stderrBytesObserved: number;
  readonly stderrTruncated: boolean;
}

export interface CodexJsonlClientOptions {
  readonly maximumLineBytes?: number | undefined;
  readonly maximumStderrBytes?: number | undefined;
  readonly requestTimeoutMs?: number | undefined;
  readonly onFatal: (error: CodexAdapterError) => void;
  readonly onNotification: (method: string, params: unknown) => void;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(record: JsonRecord, required: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === required.length && required.every((key) => key in record);
}

function isNotificationEnvelope(record: JsonRecord): record is NotificationEnvelope {
  if (!("method" in record) || !("params" in record)) return false;
  if (
    !Object.keys(record).every(
      (key) => key === "method" || key === "params" || key === "emittedAtMs",
    ) ||
    typeof record.method !== "string"
  ) {
    return false;
  }

  return (
    !("emittedAtMs" in record) ||
    (typeof record.emittedAtMs === "number" &&
      Number.isSafeInteger(record.emittedAtMs) &&
      record.emittedAtMs >= 0)
  );
}

function isRequestId(value: unknown): value is number | string {
  return (
    (typeof value === "number" && Number.isSafeInteger(value)) ||
    (typeof value === "string" && value.length > 0 && value.length <= 128)
  );
}

function reverseRequestResult(
  method: string,
):
  | Readonly<{ kind: "result"; value: unknown }>
  | Readonly<{ kind: "error"; code: number; message: string }> {
  switch (method) {
    case "item/commandExecution/requestApproval":
      return { kind: "result", value: { decision: "decline" } };
    case "item/fileChange/requestApproval":
      return { kind: "result", value: { decision: "decline" } };
    case "item/tool/requestUserInput":
      return { kind: "result", value: { answers: {} } };
    case "mcpServer/elicitation/request":
      return {
        kind: "result",
        value: { action: "decline", content: null, _meta: null },
      };
    case "item/permissions/requestApproval":
      return {
        kind: "result",
        value: { permissions: {}, scope: "turn", strictAutoReview: true },
      };
    case "item/tool/call":
      return { kind: "result", value: { contentItems: [], success: false } };
    case "applyPatchApproval":
    case "execCommandApproval":
      return {
        kind: "result",
        value: {
          decision: {
            denied: {
              rejection: "SpotPatch does not relay approval requests.",
            },
          },
        },
      };
    case "account/chatgptAuthTokens/refresh":
    case "attestation/generate":
      return {
        kind: "error",
        code: -32_001,
        message: "Request is not supported by the SpotPatch client.",
      };
    default:
      return { kind: "error", code: -32_601, message: "Method not found." };
  }
}

export class CodexJsonlClient {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #maximumLineBytes: number;
  readonly #maximumStderrBytes: number;
  readonly #onFatal: (error: CodexAdapterError) => void;
  readonly #onNotification: (method: string, params: unknown) => void;
  readonly #pending = new Map<number, PendingRequest>();
  readonly #requestTimeoutMs: number;
  #closed = false;
  #nextRequestId = 1;
  #stderrBytesObserved = 0;
  #stderrTruncated = false;
  #stdoutBuffer = Buffer.alloc(0);

  constructor(child: ChildProcessWithoutNullStreams, options: CodexJsonlClientOptions) {
    this.#child = child;
    this.#maximumLineBytes = options.maximumLineBytes ?? DEFAULT_MAXIMUM_LINE_BYTES;
    this.#maximumStderrBytes =
      options.maximumStderrBytes ?? DEFAULT_MAXIMUM_STDERR_BYTES;
    this.#onFatal = options.onFatal;
    this.#onNotification = options.onNotification;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

    child.stdout.on("data", (chunk: Buffer) => {
      this.#consumeStdout(Buffer.from(chunk));
    });
    child.stdout.once("end", () => {
      if (!this.#closed) {
        this.#fail(new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROCESS_EXITED));
      }
    });
    child.stdout.once("error", (error) => {
      this.#fail(new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL, error));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const remaining = Math.max(
        0,
        this.#maximumStderrBytes - this.#stderrBytesObserved,
      );
      this.#stderrBytesObserved += Math.min(remaining, chunk.byteLength);
      if (chunk.byteLength > remaining) this.#stderrTruncated = true;
    });
    child.stdin.once("error", (error) => {
      this.#fail(
        new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROCESS_EXITED, error),
      );
    });
    child.once("error", (error) => {
      this.#fail(
        new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROCESS_EXITED, error),
      );
    });
    child.once("exit", () => {
      if (!this.#closed) {
        this.#fail(new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROCESS_EXITED));
      }
    });
  }

  diagnostics(): CodexProtocolDiagnostics {
    return Object.freeze({
      stderrBytesObserved: this.#stderrBytesObserved,
      stderrTruncated: this.#stderrTruncated,
    });
  }

  notify(method: string): void {
    this.#write({ method });
  }

  request(method: string, params: unknown, onWritten?: () => void): Promise<unknown> {
    if (this.#closed) {
      return Promise.reject(new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.CLOSED));
    }
    if (this.#pending.size >= MAXIMUM_PENDING_REQUESTS) {
      return Promise.reject(new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL));
    }

    const id = this.#nextRequestId;
    this.#nextRequestId += 1;

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#fail(new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.REQUEST_TIMEOUT));
      }, this.#requestTimeoutMs);
      timeout.unref();
      this.#pending.set(id, { resolve, reject, timeout });

      try {
        this.#write({ method, id, params });
        onWritten?.();
      } catch (error: unknown) {
        clearTimeout(timeout);
        this.#pending.delete(id);
        reject(
          error instanceof CodexAdapterError
            ? error
            : new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROCESS_EXITED),
        );
      }
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#rejectPending(new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.CLOSED));
    this.#child.kill("SIGTERM");
  }

  #consumeStdout(chunk: Buffer): void {
    this.#stdoutBuffer = Buffer.concat([this.#stdoutBuffer, chunk]);

    for (;;) {
      if (this.#closed) return;
      const newline = this.#stdoutBuffer.indexOf(0x0a);
      if (newline === -1) {
        if (this.#stdoutBuffer.byteLength > this.#maximumLineBytes) {
          this.#fail(new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL));
        }
        return;
      }
      if (newline > this.#maximumLineBytes) {
        this.#fail(new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL));
        return;
      }

      const line = this.#stdoutBuffer.subarray(0, newline);
      this.#stdoutBuffer = this.#stdoutBuffer.subarray(newline + 1);
      if (line.byteLength === 0) {
        this.#fail(new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL));
        return;
      }

      try {
        this.#handleMessage(JSON.parse(line.toString("utf8")) as unknown);
      } catch (error: unknown) {
        this.#fail(
          error instanceof CodexAdapterError
            ? error
            : new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL),
        );
      }
    }
  }

  #handleMessage(value: unknown): void {
    if (!isRecord(value)) {
      throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL);
    }

    if ("id" in value && "method" in value) {
      if (
        !hasExactKeys(value, ["id", "method", "params"]) ||
        !isRequestId(value.id) ||
        typeof value.method !== "string"
      ) {
        throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL);
      }
      this.#respondToReverseRequest(value.id, value.method);
      return;
    }

    if ("id" in value) {
      if (!isRequestId(value.id) || typeof value.id !== "number") {
        throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL);
      }
      const pending = this.#pending.get(value.id);
      if (pending === undefined) {
        throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL);
      }
      this.#pending.delete(value.id);
      clearTimeout(pending.timeout);

      if (hasExactKeys(value, ["id", "result"])) {
        pending.resolve(value.result);
        return;
      }
      if (
        hasExactKeys(value, ["id", "error"]) &&
        isRecord(value.error) &&
        typeof value.error.code === "number" &&
        typeof value.error.message === "string"
      ) {
        pending.reject(
          new CodexRemoteRequestError(value.error.code, value.error.message),
        );
        return;
      }
      throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL);
    }

    if (!isNotificationEnvelope(value)) {
      throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL);
    }
    this.#onNotification(value.method, value.params);
  }

  #respondToReverseRequest(id: number | string, method: string): void {
    const response = reverseRequestResult(method);
    if (response.kind === "result") {
      this.#write({ id, result: response.value });
      return;
    }
    this.#write({
      id,
      error: { code: response.code, message: response.message },
    });
  }

  #write(value: unknown): void {
    if (this.#closed) {
      throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.CLOSED);
    }
    const payload = `${JSON.stringify(value)}\n`;
    if (Buffer.byteLength(payload, "utf8") > this.#maximumLineBytes) {
      throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL);
    }
    this.#child.stdin.write(payload);
  }

  #fail(error: CodexAdapterError): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#rejectPending(error);
    this.#onFatal(error);
  }

  #rejectPending(error: CodexAdapterError): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
