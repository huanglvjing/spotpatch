import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";

import { generateStressFixture, STRESS_ROUTE_SEGMENT } from "./stress-fixture.js";

const execFileAsync = promisify(execFile);
const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const ORIGINAL_CONFIG_FILENAME = ".spotpatch-original-next-config.ts";
const REQUIRED_CONFIG_FILENAME = "next.config.ts";
const EXCLUDED_BASENAMES = new Set([
  ".git",
  ".next",
  ".npmrc",
  ".vercel",
  "coverage",
  "node_modules",
  "out",
]);

interface PackageManifest {
  readonly nextVersion: string;
  readonly reactVersion: string;
}

export interface RealHostSnapshot {
  readonly gitRevision: string;
  readonly gitStatus: string;
  readonly nextVersion: string;
  readonly reactVersion: string;
  readonly root: string;
}

export interface PreparedRealHost {
  readonly inputSha256: string;
  readonly outputSha256: string;
}

function hashSource(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function parsePackageManifest(value: unknown): PackageManifest {
  if (!isUnknownRecord(value)) {
    throw new TypeError("The real-host package.json must contain a JSON object.");
  }

  const { dependencies, name, private: isPrivate } = value;
  const nextVersion = isUnknownRecord(dependencies) ? dependencies.next : undefined;
  const reactVersion = isUnknownRecord(dependencies) ? dependencies.react : undefined;

  if (
    typeof name !== "string" ||
    name === "" ||
    isPrivate !== true ||
    typeof nextVersion !== "string" ||
    typeof reactVersion !== "string" ||
    !EXACT_VERSION_PATTERN.test(nextVersion) ||
    !EXACT_VERSION_PATTERN.test(reactVersion) ||
    !nextVersion.startsWith("16.") ||
    !reactVersion.startsWith("19.")
  ) {
    throw new TypeError(
      "The real-host package.json must describe a private Next 16/React 19 project with exact dependency versions.",
    );
  }

  return Object.freeze({
    nextVersion,
    reactVersion,
  });
}

function shouldCopySource(source: string): boolean {
  const basename = path.basename(source);

  return !EXCLUDED_BASENAMES.has(basename) && !basename.startsWith(".env");
}

async function assertDirectory(absolutePath: string, label: string): Promise<void> {
  const stat = await lstat(absolutePath);

  if (!stat.isDirectory()) {
    throw new TypeError(`${label} must be a directory: ${absolutePath}`);
  }
}

async function readGitSnapshot(
  projectRoot: string,
): Promise<Pick<RealHostSnapshot, "gitRevision" | "gitStatus">> {
  const [revisionResult, statusResult] = await Promise.all([
    execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8",
    }),
    execFileAsync("git", ["status", "--porcelain=v1", "-uall"], {
      cwd: projectRoot,
      encoding: "utf8",
    }),
  ]);

  return Object.freeze({
    gitRevision: revisionResult.stdout.trim(),
    gitStatus: statusResult.stdout,
  });
}

export async function inspectRealHost(projectRoot: string): Promise<RealHostSnapshot> {
  const resolvedRoot = await realpath(path.resolve(projectRoot));
  await assertDirectory(resolvedRoot, "The real-host root");
  await assertDirectory(
    path.join(resolvedRoot, "app"),
    "The real-host App Router root",
  );
  await assertDirectory(
    path.join(resolvedRoot, "node_modules"),
    "The real-host dependency directory",
  );

  const configPath = path.join(resolvedRoot, REQUIRED_CONFIG_FILENAME);
  const stressRoutePath = path.join(resolvedRoot, "app", STRESS_ROUTE_SEGMENT);
  const packageJson = await readFile(path.join(resolvedRoot, "package.json"), "utf8");
  const manifest = parsePackageManifest(JSON.parse(packageJson) as unknown);
  await lstat(configPath);

  try {
    await lstat(stressRoutePath);
    throw new Error(
      `The host already contains the reserved POC route /${STRESS_ROUTE_SEGMENT}.`,
    );
  } catch (error: unknown) {
    if (isUnknownRecord(error) && error.code === "ENOENT") {
      // The reserved route is intentionally absent from the source project.
    } else {
      throw error;
    }
  }

  const gitSnapshot = await readGitSnapshot(resolvedRoot);

  if (gitSnapshot.gitStatus !== "") {
    throw new Error(
      "The real-host evidence run requires a clean Git worktree so its source revision is reproducible.",
    );
  }

  return Object.freeze({
    ...gitSnapshot,
    nextVersion: manifest.nextVersion,
    reactVersion: manifest.reactVersion,
    root: resolvedRoot,
  });
}

function hasSpotPatchAdapterImport(source: string): boolean {
  return /\bfrom\s*["']@spotpatch\/next["']/u.test(source);
}

function createWrapperConfigSource(disableHostSpotPatch: boolean): string {
  return `import { realpathSync } from "node:fs";
import path from "node:path";

import type { NextConfig } from "next";
import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
} from "next/constants.js";

import originalConfig from "./.spotpatch-original-next-config";

interface NextConfigContext {
  readonly defaultConfig: NextConfig;
}

type NextConfigFactory = (
  phase: string,
  context: NextConfigContext,
) => NextConfig | Promise<NextConfig>;

type TurbopackRules = NonNullable<
  NonNullable<NextConfig["turbopack"]>["rules"]
>;
type WebpackConfig = Parameters<NonNullable<NextConfig["webpack"]>>[0];

const SPOTPATCH_RULE_KEY = "*.tsx";

const configExport: NextConfig | NextConfigFactory = originalConfig;

async function resolveOriginalConfig(
  phase: string,
  context: NextConfigContext,
): Promise<NextConfig> {
  // The historical Loader POC must not start the host's installed SpotPatch
  // adapter or Sidecar. Resolve that wrapper through its production/noop path
  // while preserving the host configuration beneath it.
  const originalPhase =
    ${disableHostSpotPatch ? "true" : "false"} && phase === PHASE_DEVELOPMENT_SERVER
      ? PHASE_PRODUCTION_BUILD
      : phase;

  return typeof configExport === "function"
    ? await configExport(originalPhase, context)
    : configExport;
}

function readRequiredEnvironment(name: string): string {
  const value = process.env[name];

  if (typeof value !== "string" || value === "") {
    throw new Error(\`Missing required real-host POC environment: \${name}\`);
  }

  return value;
}

function readOptionalEnvironment(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function findCommonFilesystemRoot(paths: readonly string[]): string {
  const normalizedPaths = paths.map((value) => path.resolve(value));
  const firstPath = normalizedPaths[0];

  if (firstPath === undefined) {
    throw new Error("The real-host POC requires at least one filesystem path.");
  }

  let candidate = firstPath;

  while (!normalizedPaths.every((value) => isWithinRoot(candidate, value))) {
    const parent = path.dirname(candidate);

    if (parent === candidate) {
      throw new Error("The real-host POC paths do not share a safe filesystem root.");
    }

    candidate = parent;
  }

  if (candidate === path.parse(candidate).root) {
    throw new Error("The real-host POC refuses to use the filesystem root for Turbopack.");
  }

  return candidate;
}

function scopeWebpackFilesystemCache(
  config: WebpackConfig,
  cacheIdentity: string,
): void {
  const { cache } = config;

  if (
    cache !== null &&
    typeof cache === "object" &&
    cache.type === "filesystem"
  ) {
    const existingVersion =
      typeof cache.version === "string" ? cache.version : "";
    cache.version = [existingVersion, \`spotpatch:\${cacheIdentity}\`]
      .filter(Boolean)
      .join("|");
  }
}

export default async function createNextConfig(
  phase: string,
  context: NextConfigContext,
): Promise<NextConfig> {
  const resolved = await resolveOriginalConfig(phase, context);
  const dependencyRoot = realpathSync(path.join(process.cwd(), "node_modules"));
  const isDevelopment = phase === PHASE_DEVELOPMENT_SERVER;
  const loader = isDevelopment
    ? readRequiredEnvironment("SPOTPATCH_POC_LOADER_PATH")
    : null;
  const probeId = isDevelopment
    ? readRequiredEnvironment("SPOTPATCH_POC_PROBE_ID")
    : null;
  const turbopackRoot = findCommonFilesystemRoot(
    loader === null
      ? [process.cwd(), dependencyRoot]
      : [process.cwd(), dependencyRoot, loader],
  );
  const existingRoot = resolved.turbopack?.root;

  if (
    existingRoot !== undefined &&
    path.resolve(existingRoot) !== path.resolve(turbopackRoot)
  ) {
    throw new Error(
      "The real-host POC will not overwrite an existing incompatible turbopack.root.",
    );
  }

  if (!isDevelopment || loader === null || probeId === null) {
    return {
      ...resolved,
      turbopack: {
        ...resolved.turbopack,
        root: turbopackRoot,
      },
    };
  }

  const turbopackSourceMapMode = readRequiredEnvironment(
    "SPOTPATCH_POC_TURBOPACK_SOURCE_MAP_MODE",
  );
  const webpackSourceMapMode = readRequiredEnvironment(
    "SPOTPATCH_POC_WEBPACK_SOURCE_MAP_MODE",
  );
  const registryEpoch = readOptionalEnvironment("SPOTPATCH_POC_REGISTRY_EPOCH");
  const sourceMarkerAttribute = readOptionalEnvironment(
    "SPOTPATCH_POC_SOURCE_MARKER_ATTRIBUTE",
  );
  const hasRegistrationOptions =
    registryEpoch !== undefined && sourceMarkerAttribute !== undefined;

  if (
    (registryEpoch === undefined) !== (sourceMarkerAttribute === undefined)
  ) {
    throw new Error(
      "The real-host POC registration Loader options must be configured together.",
    );
  }

  const createLoaderOptions = (sourceMapMode: string) => ({
    probeId,
    sourceMapMode,
    ...(hasRegistrationOptions
      ? { registryEpoch, sourceMarkerAttribute }
      : {}),
  });
  const existingRules = resolved.turbopack?.rules ?? {};
  const existingSpotPatchRule = existingRules[SPOTPATCH_RULE_KEY];

  if (existingSpotPatchRule !== undefined) {
    throw new Error(
      \`The real-host already defines turbopack.rules[\${SPOTPATCH_RULE_KEY}]; the POC refuses to overwrite it.\`,
    );
  }

  const spotPatchTsxRule: TurbopackRules[string] = {
    condition: {
      all: ["development", { not: "foreign" }],
    },
    loaders: [
      {
        loader,
        options: createLoaderOptions(turbopackSourceMapMode),
      },
    ],
  };
  const originalWebpack = resolved.webpack;
  const runtimeClientModule = readOptionalEnvironment(
    "SPOTPATCH_POC_RUNTIME_CLIENT_MODULE",
  );
  const sidecarOriginValue = readOptionalEnvironment("SPOTPATCH_POC_SIDECAR_ORIGIN");
  const runtimeEnabled =
    runtimeClientModule !== undefined && sidecarOriginValue !== undefined;

  if (
    (runtimeClientModule === undefined) !== (sidecarOriginValue === undefined)
  ) {
    throw new Error(
      "The real-host POC Runtime client and Sidecar origin must be configured together.",
    );
  }

  let runtimeConfig: Pick<
    NextConfig,
    "instrumentationClientInject" | "rewrites"
  > = {};

  if (runtimeEnabled) {
    if (
      !runtimeClientModule.startsWith("./") ||
      runtimeClientModule.includes("..") ||
      runtimeClientModule.includes("\\0")
    ) {
      throw new Error("The real-host POC Runtime client path is invalid.");
    }

    const sidecarOrigin = new URL(sidecarOriginValue);

    if (
      sidecarOrigin.protocol !== "http:" ||
      sidecarOrigin.hostname !== "127.0.0.1" ||
      sidecarOrigin.username !== "" ||
      sidecarOrigin.password !== "" ||
      sidecarOrigin.pathname !== "/" ||
      sidecarOrigin.search !== "" ||
      sidecarOrigin.hash !== ""
    ) {
      throw new Error("The real-host POC Sidecar origin must be a loopback HTTP origin.");
    }

    const runtimeRewrite = {
      source: "/__spotpatch/v1/:path*",
      destination: \`\${sidecarOrigin.origin}/__spotpatch/v1/:path*\`,
      basePath: false,
    } as const;
    runtimeConfig = {
      instrumentationClientInject: [
        ...(resolved.instrumentationClientInject ?? []),
        runtimeClientModule,
      ],
      async rewrites() {
        const original = await resolved.rewrites?.();

        if (original === undefined) {
          return {
            beforeFiles: [runtimeRewrite],
            afterFiles: [],
            fallback: [],
          };
        }

        if (Array.isArray(original)) {
          return {
            beforeFiles: [runtimeRewrite],
            afterFiles: original,
            fallback: [],
          };
        }

        return {
          beforeFiles: [runtimeRewrite, ...(original.beforeFiles ?? [])],
          afterFiles: original.afterFiles ?? [],
          fallback: original.fallback ?? [],
        };
      },
    };
  }

  return {
    ...resolved,
    ...runtimeConfig,
    turbopack: {
      ...resolved.turbopack,
      root: turbopackRoot,
      rules: {
        ...existingRules,
        [SPOTPATCH_RULE_KEY]: spotPatchTsxRule,
      },
    },
    webpack(config, options) {
      const configured = originalWebpack?.(config, options) ?? config;

      if (!options.dev) {
        return configured;
      }

      scopeWebpackFilesystemCache(configured, registryEpoch ?? probeId);
      configured.module.rules.push({
        enforce: "pre",
        include: path.resolve(process.cwd(), "app"),
        test: /\\.[jt]sx$/u,
        use: [
          {
            loader,
            options: createLoaderOptions(webpackSourceMapMode),
          },
        ],
      });
      return configured;
    },
  };
}
`;
}

export async function prepareRealHostWorkDirectory(
  snapshot: RealHostSnapshot,
  workDirectory: string,
): Promise<PreparedRealHost> {
  await rm(workDirectory, { recursive: true, force: true });
  await mkdir(path.dirname(workDirectory), { recursive: true });
  await cp(snapshot.root, workDirectory, {
    recursive: true,
    filter: shouldCopySource,
  });
  await symlink(
    path.join(snapshot.root, "node_modules"),
    path.join(workDirectory, "node_modules"),
    "dir",
  );

  const configPath = path.join(workDirectory, REQUIRED_CONFIG_FILENAME);
  const originalConfigSource = await readFile(configPath, "utf8");
  const wrapperConfigSource = createWrapperConfigSource(
    hasSpotPatchAdapterImport(originalConfigSource),
  );
  await rename(configPath, path.join(workDirectory, ORIGINAL_CONFIG_FILENAME));
  await writeFile(configPath, wrapperConfigSource, "utf8");
  await generateStressFixture(workDirectory);

  return Object.freeze({
    inputSha256: hashSource(originalConfigSource),
    outputSha256: hashSource(wrapperConfigSource),
  });
}

export async function assertRealHostUnchanged(
  expected: RealHostSnapshot,
): Promise<void> {
  const actual = await readGitSnapshot(expected.root);

  if (
    actual.gitRevision !== expected.gitRevision ||
    actual.gitStatus !== expected.gitStatus
  ) {
    throw new Error("The real-host source repository changed during the POC run.");
  }
}
