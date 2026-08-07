import { spawn } from "node:child_process";

export interface CommandResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly cancelled: boolean;
  readonly timedOut: boolean;
}

export interface RunCommandOptions {
  readonly args: readonly string[];
  readonly command: string;
  readonly cwd: string;
  readonly env: Readonly<NodeJS.ProcessEnv>;
  readonly maxOutputCharacters: number;
  readonly signal?: AbortSignal;
  readonly stdin?: string;
  readonly timeoutMs: number;
}

function terminateProcess(
  child: ReturnType<typeof spawn>,
  signal: NodeJS.Signals,
): void {
  if (child.pid === undefined) {
    return;
  }

  try {
    if (process.platform === "win32") {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch {
    child.kill(signal);
  }
}

function createBoundedCollector(maximum: number): {
  append(value: string): void;
  value(): string;
} {
  let content = "";
  let truncated = false;

  return {
    append(value) {
      if (content.length >= maximum) {
        truncated = true;
        return;
      }

      const remaining = maximum - content.length;
      content += value.slice(0, remaining);
      truncated ||= value.length > remaining;
    },
    value() {
      return truncated ? `${content}\n[output truncated]` : content;
    },
  };
}

export async function runCommand(options: RunCommandOptions): Promise<CommandResult> {
  if (options.signal?.aborted === true) {
    return Object.freeze({
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: "",
      cancelled: true,
      timedOut: false,
    });
  }

  return new Promise<CommandResult>((resolve) => {
    const stdout = createBoundedCollector(options.maxOutputCharacters);
    const stderr = createBoundedCollector(options.maxOutputCharacters);
    const child = spawn(options.command, [...options.args], {
      cwd: options.cwd,
      detached: process.platform !== "win32",
      env: { ...options.env },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let cancelled = false;
    let settled = false;
    let stopping = false;
    let timedOut = false;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout.append(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr.append(chunk);
    });
    child.stdin.on("error", () => {
      // A short-lived command can close stdin before the bounded input is written.
    });

    const forceKill = (): void => {
      terminateProcess(child, "SIGKILL");
    };
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (): void => {
      if (stopping) {
        return;
      }

      stopping = true;
      terminateProcess(child, "SIGTERM");
      forceKillTimer = setTimeout(forceKill, 1_000);
      forceKillTimer.unref();
    };
    const onAbort = (): void => {
      cancelled = true;
      stop();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      stop();
    }, options.timeoutMs);
    timeout.unref();

    if (options.signal?.aborted === true) {
      onAbort();
    }

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (forceKillTimer !== undefined) {
        clearTimeout(forceKillTimer);
      }

      options.signal?.removeEventListener("abort", onAbort);
      resolve(
        Object.freeze({
          exitCode,
          signal,
          stdout: stdout.value(),
          stderr: stderr.value(),
          cancelled,
          timedOut,
        }),
      );
    };

    child.once("error", (error) => {
      stderr.append(error.message);
      finish(null, null);
    });
    child.once("close", finish);

    if (options.stdin === undefined) {
      child.stdin.end();
    } else {
      child.stdin.end(options.stdin, "utf8");
    }
  });
}

export function minimalProcessEnvironment(): NodeJS.ProcessEnv {
  const allowedNames = [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "SYSTEMROOT",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
  ] as const;
  const environment: NodeJS.ProcessEnv = { CI: "1", NO_COLOR: "1" };

  for (const name of allowedNames) {
    const value = process.env[name];

    if (value !== undefined) {
      environment[name] = value;
    }
  }

  return environment;
}
