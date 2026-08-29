import { constants as fsConstants } from "node:fs";
import { access, lstat, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { CODEX_ADAPTER_ERROR_CODES, CodexAdapterError } from "./errors.js";

interface SemanticVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const MINIMUM_CODEX_VERSION = Object.freeze({ major: 0, minor: 149, patch: 0 });

export const SUPPORTED_CODEX_VERSION_RANGE = `>=${formatVersion(MINIMUM_CODEX_VERSION)}`;

const VERSION_OUTPUT_LIMIT_BYTES = 8 * 1_024;
const VERSION_PROBE_TIMEOUT_MS = 5_000;
const SCHEMA_OUTPUT_LIMIT_BYTES = 8 * 1_024;
const SCHEMA_FILE_LIMIT_BYTES = 1_048_576;
const SCHEMA_PROBE_TIMEOUT_MS = 10_000;

export const REQUIRED_CODEX_SCHEMA_METHODS = Object.freeze({
  "ClientNotification.json": Object.freeze(["initialized"]),
  "ClientRequest.json": Object.freeze([
    "account/read",
    "configRequirements/read",
    "hooks/list",
    "initialize",
    "mcpServer/tool/call",
    "mcpServerStatus/list",
    "model/list",
    "thread/delete",
    "thread/start",
    "turn/interrupt",
    "turn/start",
  ]),
  "ServerNotification.json": Object.freeze(["turn/completed", "turn/started"]),
  "ServerRequest.json": Object.freeze([
    "account/chatgptAuthTokens/refresh",
    "applyPatchApproval",
    "attestation/generate",
    "execCommandApproval",
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "item/permissions/requestApproval",
    "item/tool/call",
    "item/tool/requestUserInput",
    "mcpServer/elicitation/request",
  ]),
} as const);

export interface ResolvedCodexExecutable {
  readonly path: string;
  readonly version: string;
}

function isSafeInteger(value: number | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function parseVersionOutput(value: string): SemanticVersion | undefined {
  const match = /^codex-cli ((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/u.exec(
    value,
  );
  if (match === null) return undefined;
  const [major, minor, patchVersion] = match[1]?.split(".").map(Number) ?? [];
  if (!isSafeInteger(major) || !isSafeInteger(minor) || !isSafeInteger(patchVersion)) {
    return undefined;
  }
  return Object.freeze({
    major,
    minor,
    patch: patchVersion,
  });
}

function compareVersions(left: SemanticVersion, right: SemanticVersion): number {
  return (
    left.major - right.major || left.minor - right.minor || left.patch - right.patch
  );
}

function formatVersion(version: SemanticVersion): string {
  return [version.major, version.minor, version.patch].join(".");
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

async function runCodexProbe(
  executable: string,
  arguments_: readonly string[],
  outputLimitBytes: number,
  timeoutMs: number,
  errorCode:
    | typeof CODEX_ADAPTER_ERROR_CODES.SCHEMA_INCOMPATIBLE
    | typeof CODEX_ADAPTER_ERROR_CODES.UNSUPPORTED_VERSION,
  environment?: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable, arguments_, {
      cwd: path.dirname(executable),
      ...(environment === undefined ? {} : { env: environment }),
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
      if (outputBytes > outputLimitBytes) {
        child.kill("SIGKILL");
        finish(() => {
          reject(new CodexAdapterError(errorCode));
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
          reject(new CodexAdapterError(errorCode));
          return;
        }
        resolve(Buffer.concat(stdout).toString("utf8").trim());
      });
    });

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => {
        reject(new CodexAdapterError(errorCode));
      });
    }, timeoutMs);
    timeout.unref();
  });
}

async function readCodexVersion(executable: string): Promise<string> {
  return runCodexProbe(
    executable,
    ["--version"],
    VERSION_OUTPUT_LIMIT_BYTES,
    VERSION_PROBE_TIMEOUT_MS,
    CODEX_ADAPTER_ERROR_CODES.UNSUPPORTED_VERSION,
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaMethods(value: unknown): ReadonlySet<string> | undefined {
  if (!isRecord(value)) return undefined;
  const variants = Array.isArray(value.oneOf)
    ? value.oneOf
    : Array.isArray(value.anyOf)
      ? value.anyOf
      : undefined;
  if (variants === undefined) return undefined;

  const methods = new Set<string>();
  for (const variant of variants) {
    if (!isRecord(variant) || !isRecord(variant.properties)) continue;
    const method = variant.properties.method;
    if (!isRecord(method)) continue;
    if (typeof method.const === "string") methods.add(method.const);
    if (
      Array.isArray(method.enum) &&
      method.enum.length === 1 &&
      typeof method.enum[0] === "string"
    ) {
      methods.add(method.enum[0]);
    }
  }
  return methods;
}

async function verifySchemaFile(
  schemaRoot: string,
  fileName: keyof typeof REQUIRED_CODEX_SCHEMA_METHODS,
): Promise<void> {
  const schemaPath = path.join(schemaRoot, fileName);
  const metadata = await lstat(schemaPath);
  if (!metadata.isFile() || metadata.size > SCHEMA_FILE_LIMIT_BYTES) {
    throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.SCHEMA_INCOMPATIBLE);
  }
  const value: unknown = JSON.parse(await readFile(schemaPath, "utf8"));
  const methods = schemaMethods(value);
  if (
    methods === undefined ||
    REQUIRED_CODEX_SCHEMA_METHODS[fileName].some((method) => !methods.has(method))
  ) {
    throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.SCHEMA_INCOMPATIBLE);
  }
}

async function verifyCodexSchema(executable: string): Promise<void> {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "spotpatch-codex-schema-"),
  );
  const canonicalTemporaryRoot = await realpath(temporaryRoot);
  const schemaRoot = path.join(canonicalTemporaryRoot, "schema");
  try {
    await runCodexProbe(
      executable,
      ["app-server", "generate-json-schema", "--experimental", "--out", schemaRoot],
      SCHEMA_OUTPUT_LIMIT_BYTES,
      SCHEMA_PROBE_TIMEOUT_MS,
      CODEX_ADAPTER_ERROR_CODES.SCHEMA_INCOMPATIBLE,
      {
        ...process.env,
        CODEX_HOME: canonicalTemporaryRoot,
        HOME: canonicalTemporaryRoot,
        NO_COLOR: "1",
        USERPROFILE: canonicalTemporaryRoot,
      },
    );
    const canonicalSchemaRoot = await realpath(schemaRoot);
    if (
      !(await lstat(schemaRoot)).isDirectory() ||
      !isWithin(canonicalTemporaryRoot, canonicalSchemaRoot)
    ) {
      throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.SCHEMA_INCOMPATIBLE);
    }
    await Promise.all(
      (
        Object.keys(
          REQUIRED_CODEX_SCHEMA_METHODS,
        ) as (keyof typeof REQUIRED_CODEX_SCHEMA_METHODS)[]
      ).map((fileName) => verifySchemaFile(canonicalSchemaRoot, fileName)),
    );
  } catch (error: unknown) {
    if (
      error instanceof CodexAdapterError &&
      error.code === CODEX_ADAPTER_ERROR_CODES.SCHEMA_INCOMPATIBLE
    ) {
      throw error;
    }
    throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.SCHEMA_INCOMPATIBLE, error);
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
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
  const parsedVersion = parseVersionOutput(output);
  if (
    parsedVersion === undefined ||
    compareVersions(parsedVersion, MINIMUM_CODEX_VERSION) < 0
  ) {
    throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.UNSUPPORTED_VERSION);
  }
  await verifyCodexSchema(executable);

  return Object.freeze({
    path: executable,
    version: formatVersion(parsedVersion),
  });
}
