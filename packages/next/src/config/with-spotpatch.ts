import { createRequire } from "node:module";
import { realpath } from "node:fs/promises";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

import {
  resolveCredentialEnvironment,
  resolveEnvironmentAiConfiguration,
  resolveProjectOptions,
  type SpotPatchOptions,
} from "@spotpatch/dev-server";
import { SPOTPATCH_API_BASE } from "@spotpatch/shared";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

import {
  NEXT_CLIENT_MODULE_ID,
  NEXT_DATA_FLOW_MODULE_ID,
  NEXT_DATA_FLOW_RULE_KEYS,
  NEXT_DEFAULT_INCLUDE,
  NEXT_SOURCE_RULE_KEYS,
} from "../internal/constants.js";
import { configureNextRuntime } from "./handshake.js";

export type NextSpotPatchOptions = Omit<SpotPatchOptions, "allowLan"> &
  Readonly<{
    allowLan?: false;
  }>;

export interface NextConfigContext<
  Config extends object = Readonly<Record<string, unknown>>,
> {
  readonly defaultConfig: Config;
}

export type NextConfigFactory<
  Config extends object = Readonly<Record<string, unknown>>,
> = (phase: string, context: NextConfigContext<Config>) => Config | Promise<Config>;

export type NextConfigInput<Config extends object = Readonly<Record<string, unknown>>> =
  Config | NextConfigFactory<Config>;

export type NextConfigEnhancer = <
  Config extends object = Readonly<Record<string, unknown>>,
>(
  input?: NextConfigInput<Config>,
) => NextConfigFactory<Config>;

interface AdapterModulePaths {
  readonly client: string;
  readonly dataFlow: string;
  readonly loader: string;
  readonly noop: string;
  readonly turbopackClient: string;
  readonly turbopackDataFlow: string;
  readonly turbopackLoader: string;
  readonly turbopackNoop: string;
}

interface NextHostCapabilities {
  readonly turbopackRoot: boolean;
}

type WebpackConfig = Record<string, unknown>;
type WebpackHandler = (config: unknown, context: unknown) => unknown;

interface WebpackContext extends Readonly<Record<string, unknown>> {
  readonly dev: boolean;
  readonly isServer: boolean;
}

type TurbopackRules = NonNullable<NonNullable<NextConfig["turbopack"]>["rules"]>;

const configuredWebpackConfigs = new WeakSet();
const WEBPACK_EXCLUDED_DIRECTORY_PATTERN = /[\\/](?:\.next|node_modules)[\\/]/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readWebpackHandler(config: NextConfig): WebpackHandler | undefined {
  const value = (config as unknown as Readonly<Record<string, unknown>>).webpack;

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "function") {
    throw new TypeError("SpotPatch requires nextConfig.webpack to be a function.");
  }

  return value as WebpackHandler;
}

function requireWebpackConfig(value: unknown): WebpackConfig {
  if (!isRecord(value)) {
    throw new TypeError("SpotPatch received an invalid webpack configuration.");
  }

  return value;
}

function requireWebpackContext(value: unknown): WebpackContext {
  if (
    !isRecord(value) ||
    typeof value.dev !== "boolean" ||
    typeof value.isServer !== "boolean"
  ) {
    throw new TypeError("SpotPatch received an invalid webpack context.");
  }

  return value as WebpackContext;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function findCommonFilesystemRoot(paths: readonly string[]): string {
  const normalized = paths.map((value) => path.resolve(value));
  const firstPath = normalized[0];

  if (firstPath === undefined) {
    throw new Error("SpotPatch requires at least one filesystem path.");
  }

  let candidate = firstPath;

  while (!normalized.every((value) => isWithinRoot(candidate, value))) {
    const parent = path.dirname(candidate);

    if (parent === candidate) {
      throw new Error("SpotPatch paths do not share a safe filesystem root.");
    }

    candidate = parent;
  }

  if (candidate === path.parse(candidate).root) {
    throw new Error("SpotPatch refuses to configure the filesystem root.");
  }

  return candidate;
}

function findLogicalAdapterRoot(
  appRoot: string,
  resolvedAdapterRoot: string,
): string | undefined {
  let directory = appRoot;

  while (directory !== path.dirname(directory)) {
    const candidate = path.join(directory, "node_modules", "@spotpatch", "next");

    if (existsSync(candidate) && realpathSync(candidate) === resolvedAdapterRoot) {
      return candidate;
    }

    directory = path.dirname(directory);
  }

  return undefined;
}

function relativeModulePath(appRoot: string, target: string): string {
  const relative = path.relative(appRoot, target).split(path.sep).join("/");
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function resolveAdapterModulePaths(appRoot: string): AdapterModulePaths {
  const resolveFromApplication = createRequire(path.join(appRoot, "package.json"));
  const client = resolveFromApplication.resolve("@spotpatch/next/client");
  const dataFlow = resolveFromApplication.resolve("@spotpatch/next/data-flow-runtime");
  const loader = resolveFromApplication.resolve("@spotpatch/next/loader");
  const resolvedAdapterRoot = path.dirname(loader);
  const noop = path.join(resolvedAdapterRoot, "dist", "noop.cjs");
  const logicalAdapterRoot = findLogicalAdapterRoot(appRoot, resolvedAdapterRoot);
  const logicalClient =
    logicalAdapterRoot === undefined
      ? undefined
      : path.join(logicalAdapterRoot, "dist", "client.js");
  const logicalDataFlow =
    logicalAdapterRoot === undefined
      ? undefined
      : path.join(logicalAdapterRoot, "dist", "data-flow-runtime.js");
  const logicalNoop =
    logicalAdapterRoot === undefined
      ? undefined
      : path.join(logicalAdapterRoot, "dist", "noop.js");

  return Object.freeze({
    client,
    dataFlow,
    loader,
    noop,
    turbopackClient:
      logicalClient === undefined ? client : relativeModulePath(appRoot, logicalClient),
    turbopackDataFlow:
      logicalDataFlow === undefined
        ? dataFlow
        : relativeModulePath(appRoot, logicalDataFlow),
    turbopackLoader:
      logicalAdapterRoot === undefined
        ? loader
        : path.join(logicalAdapterRoot, "loader.cjs"),
    turbopackNoop:
      logicalNoop === undefined ? noop : relativeModulePath(appRoot, logicalNoop),
  });
}

export function resolveNextHostCapabilities(version: string): NextHostCapabilities {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/u.exec(version);
  const major = Number(match?.[1]);
  if (match === null || !Number.isSafeInteger(major)) {
    throw new TypeError("SpotPatch could not determine the installed Next.js version.");
  }
  return Object.freeze({ turbopackRoot: major >= 16 });
}

function readNextHostCapabilities(appRoot: string): NextHostCapabilities {
  const resolveFromApplication = createRequire(path.join(appRoot, "package.json"));
  const manifest = JSON.parse(
    readFileSync(resolveFromApplication.resolve("next/package.json"), "utf8"),
  ) as unknown;
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("version" in manifest) ||
    typeof manifest.version !== "string"
  ) {
    throw new TypeError("SpotPatch found invalid Next.js package metadata.");
  }
  return resolveNextHostCapabilities(manifest.version);
}

function mergeTurbopackRoot(
  config: NextConfig,
  requiredPaths: readonly string[],
): string {
  const commonRoot = findCommonFilesystemRoot(requiredPaths);
  const existingRoot = config.turbopack?.root;

  if (
    existingRoot !== undefined &&
    !requiredPaths.every((value) => isWithinRoot(existingRoot, value))
  ) {
    throw new Error(
      "SpotPatch cannot use the existing turbopack.root because it excludes an adapter module.",
    );
  }

  return existingRoot ?? commonRoot;
}

function mergeTurbopackAlias(
  config: NextConfig,
  desired: Readonly<Record<string, string>>,
): NonNullable<NextConfig["turbopack"]> {
  const aliases = config.turbopack?.resolveAlias ?? {};
  for (const [moduleId, target] of Object.entries(desired)) {
    const existing = aliases[moduleId];
    if (existing !== undefined && existing !== target) {
      throw new Error(`SpotPatch cannot replace turbopack.resolveAlias[${moduleId}].`);
    }
  }

  return {
    ...config.turbopack,
    resolveAlias: {
      ...aliases,
      ...desired,
    },
  };
}

function mergeWebpackAlias(
  config: WebpackConfig,
  desired: Readonly<Record<string, string>>,
): void {
  const resolveValue = config.resolve;

  if (resolveValue !== undefined && !isRecord(resolveValue)) {
    throw new Error("SpotPatch requires webpack resolve to be an object.");
  }

  const resolve = resolveValue ?? {};
  const alias = resolve.alias ?? {};

  if (!isRecord(alias)) {
    throw new Error("SpotPatch requires webpack resolve.alias to be an object.");
  }

  for (const [moduleId, target] of Object.entries(desired)) {
    const existing = alias[moduleId];
    if (existing !== undefined && existing !== target) {
      throw new Error(`SpotPatch cannot replace webpack resolve.alias[${moduleId}].`);
    }
  }

  resolve.alias = { ...alias, ...desired };
  config.resolve = resolve;
}

function scopeWebpackFilesystemCache(
  config: WebpackConfig,
  registryEpoch: string,
): void {
  const cache = config.cache;

  if (isRecord(cache) && cache.type === "filesystem") {
    const currentVersion = typeof cache.version === "string" ? cache.version : "";
    cache.version = [currentVersion, `spotpatch:${registryEpoch}`]
      .filter(Boolean)
      .join("|");
  }
}

function appendWebpackLoader(
  config: WebpackConfig,
  context: WebpackContext,
  loaderPath: string,
  registryEpoch: string,
  appRoot: string,
  dataFlowEnabled: boolean,
): void {
  if (!context.dev) {
    return;
  }

  const module = config.module;

  if (!isRecord(module) || !Array.isArray(module.rules)) {
    throw new Error("SpotPatch requires webpack module.rules to be an array.");
  }

  if (configuredWebpackConfigs.has(config)) {
    return;
  }

  scopeWebpackFilesystemCache(config, registryEpoch);
  const sourceRule = {
    enforce: "pre" as const,
    exclude: WEBPACK_EXCLUDED_DIRECTORY_PATTERN,
    include: appRoot,
    test: /\.(?:jsx|tsx)$/u,
    use: [
      {
        loader: loaderPath,
        options: {
          mode:
            dataFlowEnabled && !context.isServer ? "source-and-data-flow" : "source",
          registryEpoch,
        },
      },
    ],
  };
  module.rules.push(sourceRule);
  if (dataFlowEnabled && !context.isServer) {
    module.rules.push({
      enforce: "pre" as const,
      exclude: WEBPACK_EXCLUDED_DIRECTORY_PATTERN,
      include: appRoot,
      test: /\.(?:js|ts)$/u,
      use: [
        {
          loader: loaderPath,
          options: { mode: "data-flow", registryEpoch },
        },
      ],
    });
  }
  configuredWebpackConfigs.add(config);
}

function rewriteCanClaimPrivateApi(source: string): boolean {
  return (
    source === SPOTPATCH_API_BASE ||
    source.startsWith(`${SPOTPATCH_API_BASE}/`) ||
    source.startsWith("/:path") ||
    source.startsWith("/:slug") ||
    source.includes("(.*)")
  );
}

function assertRewriteCompatibility(
  rewrites: readonly Readonly<{ source: string }>[] | undefined,
): void {
  const conflict = rewrites?.find(({ source }) => rewriteCanClaimPrivateApi(source));

  if (conflict !== undefined) {
    throw new Error(
      `SpotPatch API prefix conflicts with the host rewrite ${conflict.source}.`,
    );
  }
}

function createRewrites(
  config: NextConfig,
  sidecarOrigin: string,
): NonNullable<NextConfig["rewrites"]> {
  return async () => {
    const spotPatchRewrite = {
      basePath: false as const,
      destination: `${sidecarOrigin}${SPOTPATCH_API_BASE}/:path*`,
      source: `${SPOTPATCH_API_BASE}/:path*`,
    };
    const original = await config.rewrites?.();

    if (original === undefined) {
      return {
        beforeFiles: [spotPatchRewrite],
        afterFiles: [],
        fallback: [],
      };
    }

    if (Array.isArray(original)) {
      assertRewriteCompatibility(original);
      return {
        beforeFiles: [spotPatchRewrite],
        afterFiles: original,
        fallback: [],
      };
    }

    const beforeFiles = original.beforeFiles ?? [];
    const afterFiles = original.afterFiles ?? [];
    const fallback = original.fallback ?? [];
    assertRewriteCompatibility([...beforeFiles, ...afterFiles, ...fallback]);
    return {
      beforeFiles: [spotPatchRewrite, ...beforeFiles],
      afterFiles,
      fallback,
    };
  };
}

function createWebpackWrapper(input: {
  readonly appRoot: string;
  readonly development: boolean;
  readonly dataFlowEnabled: boolean;
  readonly dataFlowPath: string;
  readonly loaderPath: string;
  readonly noopPath: string;
  readonly original: WebpackHandler | undefined;
  readonly registryEpoch?: string;
}): WebpackHandler {
  return (configValue, contextValue) => {
    const config = requireWebpackConfig(configValue);
    const context = requireWebpackContext(contextValue);
    const configuredValue = input.original?.(configValue, contextValue);
    const configured =
      configuredValue === undefined ? config : requireWebpackConfig(configuredValue);

    if (input.development) {
      if (input.registryEpoch === undefined) {
        throw new Error("SpotPatch is missing the development registry epoch.");
      }

      appendWebpackLoader(
        configured,
        context,
        input.loaderPath,
        input.registryEpoch,
        input.appRoot,
        input.dataFlowEnabled,
      );
    } else {
      mergeWebpackAlias(configured, {
        [NEXT_CLIENT_MODULE_ID]: input.noopPath,
        [NEXT_DATA_FLOW_MODULE_ID]: input.noopPath,
      });
    }

    if (input.development) {
      mergeWebpackAlias(configured, {
        [NEXT_DATA_FLOW_MODULE_ID]: input.dataFlowEnabled
          ? input.dataFlowPath
          : input.noopPath,
      });
    }

    return configured;
  };
}

function mergeProductionConfig(
  config: NextConfig,
  appRoot: string,
  paths: AdapterModulePaths,
  capabilities: NextHostCapabilities,
): NextConfig {
  const turbopackRoot = mergeTurbopackRoot(config, [appRoot, paths.noop]);

  return {
    ...config,
    turbopack: {
      ...mergeTurbopackAlias(config, {
        [NEXT_CLIENT_MODULE_ID]: paths.turbopackNoop,
        [NEXT_DATA_FLOW_MODULE_ID]: paths.turbopackNoop,
      }),
      ...(capabilities.turbopackRoot ? { root: turbopackRoot } : {}),
    },
    webpack: createWebpackWrapper({
      appRoot,
      dataFlowEnabled: false,
      dataFlowPath: paths.dataFlow,
      development: false,
      loaderPath: paths.loader,
      noopPath: paths.noop,
      original: readWebpackHandler(config),
    }),
  };
}

function mergeDevelopmentConfig(
  config: NextConfig,
  appRoot: string,
  paths: AdapterModulePaths,
  registryEpoch: string,
  sidecarOrigin: string,
  dataFlowEnabled: boolean,
  capabilities: NextHostCapabilities,
): NextConfig {
  const turbopackRoot = mergeTurbopackRoot(config, [
    appRoot,
    paths.client,
    paths.dataFlow,
    paths.loader,
  ]);
  const existingRules = config.turbopack?.rules ?? {};
  const spotPatchRules: TurbopackRules = {};

  for (const key of NEXT_SOURCE_RULE_KEYS) {
    if (existingRules[key] !== undefined) {
      throw new Error(
        `SpotPatch cannot replace turbopack.rules[${JSON.stringify(key)}].`,
      );
    }

    const sourceRule = {
      condition: {
        all: [
          "development" as const,
          { not: "foreign" as const },
          ...(dataFlowEnabled ? [{ not: "browser" as const }] : []),
        ],
      },
      loaders: [
        {
          loader: paths.turbopackLoader,
          options: { mode: "source", registryEpoch },
        },
      ],
    };
    spotPatchRules[key] = dataFlowEnabled
      ? [
          {
            condition: {
              all: ["development", { not: "foreign" }, "browser"],
            },
            loaders: [
              {
                loader: paths.turbopackLoader,
                options: { mode: "source-and-data-flow", registryEpoch },
              },
            ],
          },
          sourceRule,
        ]
      : sourceRule;
  }

  if (dataFlowEnabled) {
    for (const key of NEXT_DATA_FLOW_RULE_KEYS) {
      if (existingRules[key] !== undefined) {
        throw new Error(
          `SpotPatch cannot replace turbopack.rules[${JSON.stringify(key)}].`,
        );
      }
      spotPatchRules[key] = {
        condition: {
          all: ["development", { not: "foreign" }, "browser"],
        },
        loaders: [
          {
            loader: paths.turbopackLoader,
            options: { mode: "data-flow", registryEpoch },
          },
        ],
      };
    }
  }

  return {
    ...config,
    rewrites: createRewrites(config, sidecarOrigin),
    turbopack: {
      ...mergeTurbopackAlias(config, {
        [NEXT_CLIENT_MODULE_ID]: paths.turbopackClient,
        [NEXT_DATA_FLOW_MODULE_ID]: dataFlowEnabled
          ? paths.turbopackDataFlow
          : paths.turbopackNoop,
      }),
      ...(capabilities.turbopackRoot ? { root: turbopackRoot } : {}),
      rules: { ...existingRules, ...spotPatchRules },
    },
    webpack: createWebpackWrapper({
      appRoot,
      dataFlowEnabled,
      dataFlowPath: paths.dataFlow,
      development: true,
      loaderPath: paths.loader,
      noopPath: paths.noop,
      original: readWebpackHandler(config),
      registryEpoch,
    }),
  };
}

async function resolveInputConfig<Config extends object>(
  input: NextConfigInput<Config> | undefined,
  phase: string,
  context: NextConfigContext<Config>,
): Promise<Config> {
  if (typeof input === "function") {
    return await input(phase, context);
  }

  return input ?? ({} as Config);
}

export function withSpotPatch(
  userOptions: NextSpotPatchOptions = {},
): NextConfigEnhancer {
  return <Config extends object = Readonly<Record<string, unknown>>>(
      input?: NextConfigInput<Config>,
    ): NextConfigFactory<Config> =>
    async (phase, context): Promise<Config> => {
      const inputConfig = await resolveInputConfig(input, phase, context);
      const config = inputConfig as unknown as NextConfig;
      const appRoot = await realpath(process.cwd());
      const paths = resolveAdapterModulePaths(appRoot);
      const capabilities = readNextHostCapabilities(appRoot);

      if (phase !== PHASE_DEVELOPMENT_SERVER) {
        return mergeProductionConfig(
          config,
          appRoot,
          paths,
          capabilities,
        ) as unknown as Config;
      }

      const environmentAi =
        userOptions.ai === undefined
          ? resolveEnvironmentAiConfiguration(process.env).ai
          : false;
      const options = await resolveProjectOptions({
        appRoot,
        environmentAi,
        options: {
          ...userOptions,
          include: userOptions.include ?? NEXT_DEFAULT_INCLUDE,
        },
      });

      if (options.allowLan) {
        throw new RangeError(
          "SpotPatch Next does not support allowLan; use a loopback development host.",
        );
      }

      const carrier = await configureNextRuntime({
        appRoot,
        credentials: resolveCredentialEnvironment(options, process.env),
        options,
      });

      if (!options.enabled) {
        return mergeProductionConfig(
          config,
          appRoot,
          paths,
          capabilities,
        ) as unknown as Config;
      }

      return mergeDevelopmentConfig(
        config,
        appRoot,
        paths,
        carrier.registryEpoch,
        carrier.sidecarOrigin,
        options.dataFlow.enabled,
        capabilities,
      ) as unknown as Config;
    };
}
