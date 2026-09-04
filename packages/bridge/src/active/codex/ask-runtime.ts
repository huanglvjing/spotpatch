import { createHash, randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ContextualAskExecutorError,
  type ContextualAskExecutorInput,
} from "@spotpatch/agent";
import { CONTEXTUAL_ASK_PERMISSION_PROFILE } from "@spotpatch/shared";

import {
  prepareManagedCodexRuntimeHome,
  removeManagedCodexRuntimeHome,
} from "./managed-runtime.js";

type JsonRecord = Readonly<Record<string, unknown>>;

const PROTECTED_FILE_NAMES = new Set([
  "bun.lock",
  "bun.lockb",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);
const FORWARDED_ENVIRONMENT_NAMES = Object.freeze([
  "ALL_PROXY",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "LANG",
  "LC_ALL",
  "PATH",
  "PATHEXT",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "all_proxy",
  "http_proxy",
  "https_proxy",
] as const);
const ASK_SHELL_ENVIRONMENT_NAMES = Object.freeze([
  "LANG",
  "LC_ALL",
  "NODE_ENV",
  "NO_COLOR",
  "PATH",
  "PATHEXT",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
] as const);
const ASK_SHELL_ENVIRONMENT_FILTERS = Object.freeze(
  Object.fromEntries(
    ASK_SHELL_ENVIRONMENT_NAMES.map((name) => [name, "include"] as const),
  ),
);
const ASK_SHELL_ENVIRONMENT_POLICY = Object.freeze({
  inherit: "all",
  ignore_default_excludes: false,
  filters: ASK_SHELL_ENVIRONMENT_FILTERS,
});
const ASK_SHELL_ENVIRONMENT_POLICY_TOML = `{ inherit="all", ignore_default_excludes=false, filters={ ${ASK_SHELL_ENVIRONMENT_NAMES.map(
  (name) => `${name}="include"`,
).join(", ")} } }`;

export interface ManagedCodexAskProjection {
  readonly workspaceRoot: string;
  dispose(): Promise<void>;
  verifyUnchanged(): Promise<void>;
}

export interface ManagedCodexAskRuntime {
  readonly codexHome: string;
  readonly environment: NodeJS.ProcessEnv;
  dispose(): Promise<void>;
}

export async function createManagedCodexAskProbeProjection(): Promise<ManagedCodexAskProjection> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "spotpatch-ask-probe-"));
  const workspaceRoot = path.join(temporaryRoot, "workspace");
  try {
    await mkdir(workspaceRoot, { mode: 0o500 });
    const canonicalRoot = await realpath(workspaceRoot);
    return Object.freeze({
      workspaceRoot: canonicalRoot,
      async dispose() {
        await makeTreeWritable(temporaryRoot);
        await rm(temporaryRoot, { recursive: true, force: true });
      },
      async verifyUnchanged() {
        if ((await collectProjectionFiles(canonicalRoot)).size !== 0) {
          throw new ContextualAskExecutorError("ASK_WRITE_ATTEMPTED");
        }
      },
    });
  } catch (error: unknown) {
    await makeTreeWritable(temporaryRoot);
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error instanceof ContextualAskExecutorError ? error : projectionError(error);
  }
}

function isSensitivePath(relativePath: string): boolean {
  const segments = relativePath.split("/");
  return segments.some(
    (segment) =>
      segment === ".git" ||
      segment === ".codex" ||
      segment === "AGENTS.md" ||
      segment === "CLAUDE.md" ||
      segment === "node_modules" ||
      segment.startsWith(".env") ||
      PROTECTED_FILE_NAMES.has(segment),
  );
}

function projectionError(cause?: unknown): ContextualAskExecutorError {
  return new ContextualAskExecutorError("ASK_SOURCE_SCOPE_DENIED", {
    ...(cause === undefined ? {} : { cause }),
  });
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function resolveProjectionPath(root: string, relativePath: string): string {
  if (
    relativePath.length === 0 ||
    relativePath.includes("\\") ||
    path.posix.isAbsolute(relativePath) ||
    isSensitivePath(relativePath)
  ) {
    throw projectionError();
  }
  const normalized = path.posix.normalize(relativePath);
  if (
    normalized !== relativePath ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw projectionError();
  }
  const target = path.join(root, ...relativePath.split("/"));
  const fromRoot = path.relative(root, target);
  if (fromRoot === ".." || fromRoot.startsWith(`..${path.sep}`)) {
    throw projectionError();
  }
  return target;
}

async function makeTreeWritable(root: string): Promise<void> {
  const metadata = await lstat(root).catch(() => undefined);
  if (metadata === undefined || metadata.isSymbolicLink()) return;
  if (!metadata.isDirectory()) {
    await chmod(root, 0o600).catch(() => undefined);
    return;
  }
  await chmod(root, 0o700).catch(() => undefined);
  for (const entry of await readdir(root)) {
    await makeTreeWritable(path.join(root, entry));
  }
}

async function collectProjectionFiles(
  root: string,
  current = root,
): Promise<ReadonlyMap<string, string>> {
  const files = new Map<string, string>();
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isSymbolicLink()) throw projectionError();
    if (entry.isDirectory()) {
      const nested = await collectProjectionFiles(root, absolute);
      for (const [name, hash] of nested) files.set(name, hash);
      continue;
    }
    if (!entry.isFile()) throw projectionError();
    files.set(
      path.relative(root, absolute).split(path.sep).join("/"),
      sha256(await readFile(absolute)),
    );
  }
  return files;
}

export async function createManagedCodexAskProjection(
  input: ContextualAskExecutorInput,
): Promise<ManagedCodexAskProjection> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "spotpatch-ask-"));
  const workspaceRoot = path.join(temporaryRoot, "workspace");
  const expected = new Map<string, string>();
  const handles = new Set<string>();
  try {
    await mkdir(workspaceRoot, { recursive: true, mode: 0o700 });
    for (const source of input.grant.sources) {
      if (handles.has(source.handleId) || expected.has(source.relativePath)) {
        throw projectionError();
      }
      handles.add(source.handleId);
      const absolute = resolveProjectionPath(workspaceRoot, source.relativePath);
      const read = input.snapshot.read(source.handleId, {
        startLine: 1,
        endLine: source.lineCount,
      });
      if (
        read.handleId !== source.handleId ||
        read.startLine !== 1 ||
        read.endLine !== source.lineCount ||
        sha256(read.content) !== source.contentHash
      ) {
        throw projectionError();
      }
      await mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 });
      await writeFile(absolute, read.content, { encoding: "utf8", mode: 0o400 });
      await chmod(absolute, 0o400);
      expected.set(source.relativePath, source.contentHash);
    }
    const directories = new Set<string>([workspaceRoot]);
    for (const relativePath of expected.keys()) {
      let directory = path.dirname(resolveProjectionPath(workspaceRoot, relativePath));
      while (directory !== path.dirname(workspaceRoot)) {
        directories.add(directory);
        if (directory === workspaceRoot) break;
        directory = path.dirname(directory);
      }
    }
    for (const directory of [...directories].sort(
      (left, right) => right.length - left.length,
    )) {
      await chmod(directory, 0o500);
    }
    const canonicalRoot = await realpath(workspaceRoot);
    const dispose = async (): Promise<void> => {
      await makeTreeWritable(temporaryRoot);
      await rm(temporaryRoot, { recursive: true, force: true });
    };
    return Object.freeze({
      workspaceRoot: canonicalRoot,
      dispose,
      async verifyUnchanged() {
        const actual = await collectProjectionFiles(canonicalRoot);
        if (
          actual.size !== expected.size ||
          [...expected].some(([name, hash]) => actual.get(name) !== hash)
        ) {
          throw new ContextualAskExecutorError("ASK_WRITE_ATTEMPTED");
        }
      },
    });
  } catch (error: unknown) {
    await makeTreeWritable(temporaryRoot);
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error instanceof ContextualAskExecutorError ? error : projectionError(error);
  }
}

export function createManagedCodexAskEnvironment(
  codexHome: string,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    CODEX_HOME: codexHome,
    HOME: codexHome,
    NODE_ENV: source.NODE_ENV ?? "development",
    NO_COLOR: "1",
    USERPROFILE: codexHome,
  };
  for (const name of FORWARDED_ENVIRONMENT_NAMES) {
    const value = source[name];
    if (value !== undefined) environment[name] = value;
  }
  const loopback = "localhost,127.0.0.1,::1";
  const existing = source.NO_PROXY ?? source.no_proxy;
  environment.NO_PROXY = existing === undefined ? loopback : `${loopback},${existing}`;
  environment.no_proxy = environment.NO_PROXY;
  return environment;
}

export function managedCodexAskThreadConfig(): JsonRecord {
  return Object.freeze({
    agents: Object.freeze({ enabled: false }),
    default_permissions: CONTEXTUAL_ASK_PERMISSION_PROFILE,
    features: Object.freeze({
      apps: false,
      hooks: false,
      plugins: false,
      remote_plugin: false,
    }),
    mcp_servers: Object.freeze({}),
    permissions: Object.freeze({
      [CONTEXTUAL_ASK_PERMISSION_PROFILE]: Object.freeze({
        filesystem: Object.freeze({
          ":root": "deny",
          ":minimal": "read",
          ":workspace_roots": Object.freeze({ ".": "read" }),
        }),
        network: Object.freeze({ enabled: false }),
      }),
    }),
    shell_environment_policy: ASK_SHELL_ENVIRONMENT_POLICY,
    web_search: "disabled",
  });
}

export const MANAGED_CODEX_ASK_CONFIG_OVERRIDES = Object.freeze([
  "agents.enabled=false",
  "features.apps=false",
  "features.hooks=false",
  "features.plugins=false",
  "features.remote_plugin=false",
  'web_search="disabled"',
  "mcp_servers={}",
  `shell_environment_policy=${ASK_SHELL_ENVIRONMENT_POLICY_TOML}`,
] as const);

export async function createManagedCodexAskRuntime(options: {
  readonly projectRoot: string;
  readonly privateRuntimeBase?: string;
}): Promise<ManagedCodexAskRuntime> {
  const runtimeKey = randomBytes(32).toString("hex");
  try {
    const codexHome = await prepareManagedCodexRuntimeHome({
      excludedRoot: options.projectRoot,
      ...(options.privateRuntimeBase === undefined
        ? {}
        : { runtimeBase: options.privateRuntimeBase }),
      runtimeKey,
    });
    return Object.freeze({
      codexHome,
      environment: createManagedCodexAskEnvironment(codexHome),
      async dispose() {
        await removeManagedCodexRuntimeHome({
          ...(options.privateRuntimeBase === undefined
            ? {}
            : { runtimeBase: options.privateRuntimeBase }),
          runtimeKey,
        });
      },
    });
  } catch (error: unknown) {
    throw new ContextualAskExecutorError("ASK_EXECUTOR_UNAVAILABLE", {
      cause: error,
    });
  }
}
