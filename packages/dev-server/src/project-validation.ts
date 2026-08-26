import { execFile } from "node:child_process";
import { access, lstat, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

import {
  DEFAULT_AGENT_LIMITS,
  type AgentLimits,
  type ResolvedAgentCheckDefinition,
  type ResolvedAiOptions,
} from "@spotpatch/shared";

const execFileAsync = promisify(execFile);
const TYPESCRIPT_CHECK_ID = "spotpatch-typecheck";
const TYPESCRIPT_CHECK_LABEL = "TypeScript";

interface ProjectManifest {
  readonly dependencies?: Readonly<Record<string, unknown>>;
  readonly devDependencies?: Readonly<Record<string, unknown>>;
  readonly peerDependencies?: Readonly<Record<string, unknown>>;
}

export interface DiscoverProjectValidationCheckOptions {
  readonly appRoot: string;
  readonly timeoutMs: number;
}

export interface ResolveProjectValidationChecksOptions extends DiscoverProjectValidationCheckOptions {
  readonly checks: Readonly<Record<string, ResolvedAgentCheckDefinition>>;
}

export interface ResolveManagedExecutionValidationOptions {
  readonly ai: false | ResolvedAiOptions;
  readonly appRoot: string;
}

export interface ResolvedManagedExecutionValidation {
  readonly checks: Readonly<Record<string, ResolvedAgentCheckDefinition>>;
  readonly limits: Readonly<AgentLimits>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function isRegularFile(absolutePath: string): Promise<boolean> {
  try {
    const metadata = await lstat(absolutePath);
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

async function readManifest(appRoot: string): Promise<ProjectManifest | undefined> {
  const manifestPath = path.join(appRoot, "package.json");

  if (!(await isRegularFile(manifestPath))) {
    return undefined;
  }

  try {
    const value = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function declaresTypeScript(manifest: ProjectManifest): boolean {
  return [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.peerDependencies,
  ].some(
    (dependencies) =>
      isRecord(dependencies) && typeof dependencies.typescript === "string",
  );
}

async function findGitRoot(appRoot: string): Promise<string | undefined> {
  try {
    const result = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: appRoot,
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    });
    const root = await realpath(result.stdout.trim());
    const relative = path.relative(root, appRoot);

    if (
      relative === "" ||
      (!relative.startsWith(`..${path.sep}`) &&
        relative !== ".." &&
        !path.isAbsolute(relative))
    ) {
      return root;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

async function resolveTypeScriptCli(appRoot: string): Promise<string | undefined> {
  const resolveFromApplication = createRequire(path.join(appRoot, "package.json"));

  try {
    const packagePath = resolveFromApplication.resolve("typescript/package.json");
    const cliPath = path.join(path.dirname(packagePath), "bin", "tsc");
    await access(cliPath);
    return await realpath(cliPath);
  } catch {
    return undefined;
  }
}

function portableRelativePath(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join("/");
}

function hasRequiredCheck(
  checks: Readonly<Record<string, ResolvedAgentCheckDefinition>>,
): boolean {
  return Object.values(checks).some((check) => check.required);
}

function availableCheckId(
  checks: Readonly<Record<string, ResolvedAgentCheckDefinition>>,
  preferred: string,
): string {
  if (checks[preferred] === undefined) return preferred;

  let suffix = 2;
  while (checks[`${preferred}-${String(suffix)}`] !== undefined) suffix += 1;
  return `${preferred}-${String(suffix)}`;
}

export async function discoverProjectValidationCheck(
  options: DiscoverProjectValidationCheckOptions,
): Promise<ResolvedAgentCheckDefinition | undefined> {
  const appRoot = await realpath(options.appRoot);
  const tsconfigPath = path.join(appRoot, "tsconfig.json");
  const [manifest, projectRoot, hasTsconfig] = await Promise.all([
    readManifest(appRoot),
    findGitRoot(appRoot),
    isRegularFile(tsconfigPath),
  ]);

  if (
    manifest === undefined ||
    projectRoot === undefined ||
    !hasTsconfig ||
    !declaresTypeScript(manifest)
  ) {
    return undefined;
  }

  const cliPath = await resolveTypeScriptCli(appRoot);

  if (cliPath === undefined) {
    return undefined;
  }

  const projectPath = portableRelativePath(projectRoot, tsconfigPath);

  if (projectPath.length === 0 || projectPath.startsWith("../")) {
    return undefined;
  }

  return Object.freeze({
    id: TYPESCRIPT_CHECK_ID,
    label: TYPESCRIPT_CHECK_LABEL,
    command: process.execPath,
    args: Object.freeze([
      cliPath,
      "--noEmit",
      "--pretty",
      "false",
      "--incremental",
      "false",
      "--project",
      projectPath,
    ]),
    required: true,
    timeoutMs: options.timeoutMs,
  });
}

export async function resolveProjectValidationChecks(
  options: ResolveProjectValidationChecksOptions,
): Promise<Readonly<Record<string, ResolvedAgentCheckDefinition>>> {
  if (hasRequiredCheck(options.checks)) return options.checks;

  const discovered = await discoverProjectValidationCheck(options);
  if (discovered === undefined) return options.checks;

  const id = availableCheckId(options.checks, discovered.id);
  return Object.freeze({
    ...options.checks,
    [id]: Object.freeze({ ...discovered, id }),
  });
}

export async function resolveManagedExecutionValidation(
  options: ResolveManagedExecutionValidationOptions,
): Promise<ResolvedManagedExecutionValidation> {
  const checks = options.ai === false ? Object.freeze({}) : options.ai.execution.checks;
  const limits =
    options.ai === false ? DEFAULT_AGENT_LIMITS : options.ai.execution.limits;

  return Object.freeze({
    checks: await resolveProjectValidationChecks({
      appRoot: options.appRoot,
      checks,
      timeoutMs: limits.checkTimeoutMs,
    }),
    limits,
  });
}
