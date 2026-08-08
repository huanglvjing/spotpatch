import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import net from "node:net";

const CHILD_ENVIRONMENT_KEYS = Object.freeze([
  "HOME",
  "PATH",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WINDIR",
]);

const PROCESS_STOP_TIMEOUT_MS = 10_000;

export interface CommandResult {
  readonly exitCode: number | null;
  readonly logs: string;
}

export interface RunningProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly command: string;
  readonly getLogs: () => string;
}

function createChildEnvironment(
  additions: Readonly<Record<string, string>>,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    NEXT_TELEMETRY_DISABLED: "1",
    ...additions,
  };

  for (const key of CHILD_ENVIRONMENT_KEYS) {
    const value = process.env[key];

    if (value !== undefined) {
      environment[key] = value;
    }
  }

  return environment;
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  if (child.exitCode !== null) {
    return Promise.resolve(child.exitCode);
  }

  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      child.off("exit", onExit);
      reject(error);
    };
    const onExit = (code: number | null): void => {
      child.off("error", onError);
      resolve(code);
    };

    child.once("error", onError);
    child.once("exit", onExit);
  });
}

async function waitForExitBefore(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<boolean> {
  let timeout: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      waitForExit(child).then(() => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => {
          resolve(false);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

export function startNodeCommand(input: {
  readonly additions?: Readonly<Record<string, string>>;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly entry: string;
}): RunningProcess {
  const command = [process.execPath, input.entry, ...input.args].join(" ");
  const child = spawn(process.execPath, [input.entry, ...input.args], {
    cwd: input.cwd,
    env: createChildEnvironment(input.additions ?? {}),
    shell: false,
    stdio: "pipe",
  });
  const chunks: string[] = [];
  const append = (chunk: Buffer): void => {
    chunks.push(chunk.toString("utf8"));
  };

  child.stdout.on("data", append);
  child.stderr.on("data", append);

  return Object.freeze({
    child,
    command,
    getLogs: () => chunks.join(""),
  });
}

export async function runNodeCommand(input: {
  readonly additions?: Readonly<Record<string, string>>;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly entry: string;
  readonly timeoutMs: number;
}): Promise<CommandResult> {
  const running = startNodeCommand(input);
  let timeout: NodeJS.Timeout | undefined;

  try {
    const exitCode = await Promise.race([
      waitForExit(running.child),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Command timed out after ${String(input.timeoutMs)}ms.`));
        }, input.timeoutMs);
      }),
    ]);

    return Object.freeze({ exitCode, logs: running.getLogs() });
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    await stopNodeCommand(running);
  }
}

export async function stopNodeCommand(running: RunningProcess): Promise<void> {
  const { child } = running;

  if (child.exitCode !== null || child.killed) {
    return;
  }

  child.kill("SIGTERM");
  const didExit = await waitForExitBefore(child, PROCESS_STOP_TIMEOUT_MS);

  if (!didExit) {
    child.kill("SIGKILL");
    await waitForExit(child);
  }
}

export async function reserveLoopbackPort(): Promise<number> {
  const server = net.createServer();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();

  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Unable to reserve a loopback TCP port.");
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });

  return address.port;
}
