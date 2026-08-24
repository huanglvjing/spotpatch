import { constants as fsConstants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { CODEX_ADAPTER_ERROR_CODES, CodexAdapterError } from "./errors.js";

export const SUPPORTED_CODEX_VERSION = "0.149.0";

const VERSION_OUTPUT_LIMIT_BYTES = 8 * 1_024;
const VERSION_PROBE_TIMEOUT_MS = 5_000;

export interface ResolvedCodexExecutable {
  readonly path: string;
  readonly version: typeof SUPPORTED_CODEX_VERSION;
}

export interface ResolveCodexExecutableOptions {
  readonly pathValue?: string | undefined;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..")
  );
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR" || error.code === "EACCES")
  );
}

async function findOnTrustedPath(pathValue: string): Promise<string> {
  const executableNames = process.platform === "win32" ? ["codex.exe"] : ["codex"];

  for (const entry of pathValue.split(path.delimiter)) {
    if (entry.length === 0 || !path.isAbsolute(entry)) continue;

    for (const executableName of executableNames) {
      const candidate = path.join(entry, executableName);

      try {
        const canonical = await realpath(candidate);
        const metadata = await stat(canonical);
        if (!metadata.isFile()) continue;
        await access(canonical, fsConstants.X_OK);
        return canonical;
      } catch (error: unknown) {
        if (isMissingFileError(error)) continue;
        throw new CodexAdapterError(
          CODEX_ADAPTER_ERROR_CODES.EXECUTABLE_UNTRUSTED,
          error,
        );
      }
    }
  }

  throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.EXECUTABLE_NOT_FOUND);
}

async function readCodexVersion(executable: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable, ["--version"], {
      cwd: path.dirname(executable),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;

    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const collect = (chunk: Buffer, retain: boolean): void => {
      if (settled) return;
      outputBytes += chunk.byteLength;
      if (outputBytes > VERSION_OUTPUT_LIMIT_BYTES) {
        child.kill("SIGKILL");
        finish(() => {
          reject(new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.UNSUPPORTED_VERSION));
        });
        return;
      }
      if (retain) stdout.push(Buffer.from(chunk));
    };

    child.stdout.on("data", (chunk: Buffer) => {
      collect(chunk, true);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      collect(chunk, false);
    });
    child.once("error", (error) => {
      finish(() => {
        reject(
          new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.EXECUTABLE_UNTRUSTED, error),
        );
      });
    });
    child.once("exit", (code, signal) => {
      finish(() => {
        if (code !== 0 || signal !== null) {
          reject(new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.UNSUPPORTED_VERSION));
          return;
        }
        resolve(Buffer.concat(stdout).toString("utf8").trim());
      });
    });

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => {
        reject(new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.UNSUPPORTED_VERSION));
      });
    }, VERSION_PROBE_TIMEOUT_MS);
    timeout.unref();
  });
}

export async function resolveCodexExecutable(
  projectRoot: string,
  options: ResolveCodexExecutableOptions = {},
): Promise<ResolvedCodexExecutable> {
  const canonicalRoot = await realpath(projectRoot);
  if (!(await stat(canonicalRoot)).isDirectory()) {
    throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.EXECUTABLE_UNTRUSTED);
  }
  const executable = await findOnTrustedPath(
    options.pathValue ?? process.env.PATH ?? "",
  );

  if (isWithin(canonicalRoot, executable)) {
    throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.EXECUTABLE_UNTRUSTED);
  }

  const output = await readCodexVersion(executable);
  const expectedOutput = `codex-cli ${SUPPORTED_CODEX_VERSION}`;
  if (output !== expectedOutput) {
    throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.UNSUPPORTED_VERSION);
  }

  return Object.freeze({
    path: executable,
    version: SUPPORTED_CODEX_VERSION,
  });
}
