import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export interface BoundedProcessOptions {
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly outputLimitBytes: number;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly stdin?: string;
  /**
   * Receives each complete stdout line as it arrives. Returning `false`
   * stops the process early and resolves with `stopped: true`.
   */
  readonly onLine?: (line: string) => boolean | undefined;
}

export interface BoundedProcessResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stopped: boolean;
}

export type BoundedProcessFailure = "aborted" | "output-limit" | "spawn" | "timeout";

export class BoundedProcessError extends Error {
  readonly reason: BoundedProcessFailure;

  constructor(
    reason: BoundedProcessFailure,
    options: Readonly<{ cause?: unknown }> = {},
  ) {
    super(reason, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "BoundedProcessError";
    this.reason = reason;
  }
}

function terminate(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform !== "win32" && child.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // The process group may already have exited.
    }
  }
  child.kill("SIGKILL");
}

/**
 * Runs an executable without a shell, bounding its combined output and
 * lifetime. The whole process group is killed on timeout, cancellation, an
 * output overflow, or an early stop requested by `onLine`.
 */
export function runBoundedProcess(
  executable: string,
  arguments_: readonly string[],
  options: BoundedProcessOptions,
): Promise<BoundedProcessResult> {
  return new Promise<BoundedProcessResult>((resolve, reject) => {
    if (options.signal?.aborted === true) {
      reject(new BoundedProcessError("aborted"));
      return;
    }
    const child = spawn(executable, arguments_, {
      cwd: options.cwd,
      detached: process.platform !== "win32",
      env: options.environment,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    let outputBytes = 0;
    let pendingLine = "";
    let stopped = false;
    let settled = false;

    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const fail = (reason: BoundedProcessFailure, cause?: unknown): void => {
      terminate(child);
      settle(() => {
        reject(new BoundedProcessError(reason, cause === undefined ? {} : { cause }));
      });
    };
    const onAbort = (): void => {
      fail("aborted", options.signal?.reason);
    };
    const count = (chunk: Buffer): boolean => {
      outputBytes += chunk.byteLength;
      if (outputBytes <= options.outputLimitBytes) return true;
      fail("output-limit");
      return false;
    };

    child.stdout.on("data", (chunk: Buffer) => {
      if (settled || stopped || !count(chunk)) return;
      stdout.push(Buffer.from(chunk));
      if (options.onLine === undefined) return;
      pendingLine += chunk.toString("utf8");
      let newline = pendingLine.indexOf("\n");
      while (newline !== -1 && !stopped) {
        const line = pendingLine.slice(0, newline).trim();
        pendingLine = pendingLine.slice(newline + 1);
        if (line.length > 0 && options.onLine(line) === false) {
          stopped = true;
          terminate(child);
        }
        newline = pendingLine.indexOf("\n");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (!settled) count(chunk);
    });
    child.once("error", (error) => {
      fail("spawn", error);
    });
    child.once("close", (exitCode) => {
      settle(() => {
        resolve(
          Object.freeze({
            exitCode,
            stdout: Buffer.concat(stdout).toString("utf8"),
            stopped,
          }),
        );
      });
    });

    const timeout = setTimeout(() => {
      fail("timeout");
    }, options.timeoutMs);
    timeout.unref();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    // A process that exits before reading its input raises EPIPE here; the
    // exit itself is reported through "close".
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.stdin ?? "");
  });
}
