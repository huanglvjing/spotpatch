import { createRequire } from "node:module";
import { realpath } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

import {
  resolveCredentialEnvironment,
  resolveEnvironmentAiConfiguration,
  resolveProjectOptions,
  type SpotPatchOptions,
} from "@spotpatch/dev-server";
import { SPOTPATCH_API_BASE } from "@spotpatch/shared";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

import {
  NEXT_CLIENT_MODULE_ID,
  NEXT_DEFAULT_INCLUDE,
  NEXT_SOURCE_RULE_KEYS,
} from "../internal/constants.js";
import { configureNextRuntime } from "./handshake.js";

export type NextSpotPatchOptions = Omit<SpotPatchOptions, "allowLan" | "dataFlow"> &
  Readonly<{
    allowLan?: false;
    dataFlow?: false;
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
  readonly loader: string;
  readonly noop: string;
  readonly turbopackClient: string;
  readonly turbopackLoader: string;
  readonly turbopackNoop: string;
}

type WebpackConfig = Record<string, unknown>;
type WebpackHandler = (config: unknown, context: unknown) => unknown;

interface WebpackContext extends Readonly<Record<string, unknown>> {
  readonly dev: boolean;
}

type TurbopackRules = NonNullable<NonNullable<NextConfig["turbopack"]>["rules"]>;

const configuredWebpackConfigs = new WeakSet();

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
  if (!isRecord(value) || typeof value.dev !== "boolean") {
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
  const loader = resolveFromApplication.resolve("@spotpatch/next/loader");
  const resolvedAdapterRoot = path.dirname(loader);
  const noop = path.join(resolvedAdapterRoot, "dist", "noop.cjs");
  const logicalAdapterRoot = findLogicalAdapterRoot(appRoot, resolvedAdapterRoot);
  const logicalClient =
    logicalAdapterRoot === undefined
      ? undefined
      : path.join(logicalAdapterRoot, "dist", "client.js");
  const logicalNoop =
    logicalAdapterRoot === undefined
      ? undefined
      : path.join(logicalAdapterRoot, "dist", "noop.js");

  return Object.freeze({
    client,
    loader,
    noop,
    turbopackClient:
      logicalClient === undefined ? client : relativeModulePath(appRoot, logicalClient),
    turbopackLoader:
      logicalAdapterRoot === undefined
        ? loader
        : path.join(logicalAdapterRoot, "loader.cjs"),
    turbopackNoop:
      logicalNoop === undefined ? noop : relativeModulePath(appRoot, logicalNoop),
  });
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
  noopPath: string,
): NonNullable<NextConfig["turbopack"]> {
  const aliases = config.turbopack?.resolveAlias ?? {};
  const existing = aliases[NEXT_CLIENT_MODULE_ID];

  if (existing !== undefined && existing !== noopPath) {
    throw new Error(
      `SpotPatch cannot replace turbopack.resolveAlias[${NEXT_CLIENT_MODULE_ID}].`,
    );
  }

  return {
    ...config.turbopack,
    resolveAlias: {
      ...aliases,
      [NEXT_CLIENT_MODULE_ID]: noopPath,
    },
  };
}

function mergeWebpackAlias(config: WebpackConfig, noopPath: string): void {
  const resolveValue = config.resolve;

  if (resolveValue !== undefined && !isRecord(resolveValue)) {
    throw new Error("SpotPatch requires webpack resolve to be an object.");
  }

  const resolve = resolveValue ?? {};
  const alias = resolve.alias ?? {};

  if (!isRecord(alias)) {
    throw new Error("SpotPatch requires webpack resolve.alias to be an object.");
  }

  const existing = alias[NEXT_CLIENT_MODULE_ID];

  if (existing !== undefined && existing !== noopPath) {
    throw new Error(
      `SpotPatch cannot replace webpack resolve.alias[${NEXT_CLIENT_MODULE_ID}].`,
    );
  }

  resolve.alias = { ...alias, [NEXT_CLIENT_MODULE_ID]: noopPath };
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
  const rule = {
    enforce: "pre" as const,
    include: appRoot,
    test: /\.(?:jsx|tsx)$/u,
    use: [
      {
        loader: loaderPath,
        options: { registryEpoch },
      },
    ],
  };
  module.rules.push(rule);
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
      );
    } else {
      mergeWebpackAlias(configured, input.noopPath);
    }

    return configured;
  };
}

function mergeProductionConfig(
  config: NextConfig,
  appRoot: string,
  paths: AdapterModulePaths,
): NextConfig {
  const turbopackRoot = mergeTurbopackRoot(config, [appRoot, paths.noop]);

  return {
    ...config,
    turbopack: {
      ...mergeTurbopackAlias(config, paths.turbopackNoop),
      root: turbopackRoot,
    },
    webpack: createWebpackWrapper({
      appRoot,
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
): NextConfig {
  const turbopackRoot = mergeTurbopackRoot(config, [
    appRoot,
    paths.client,
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

    spotPatchRules[key] = {
      condition: { all: ["development", { not: "foreign" }] },
      loaders: [
        {
          loader: paths.turbopackLoader,
          options: { registryEpoch },
        },
      ],
    };
  }

  return {
    ...config,
    rewrites: createRewrites(config, sidecarOrigin),
    turbopack: {
      ...mergeTurbopackAlias(config, paths.turbopackClient),
      root: turbopackRoot,
      rules: { ...existingRules, ...spotPatchRules },
    },
    webpack: createWebpackWrapper({
      appRoot,
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
  const requestedDataFlow = (userOptions as Readonly<Record<string, unknown>>).dataFlow;

  if (requestedDataFlow !== undefined && requestedDataFlow !== false) {
    throw new RangeError(
      "SpotPatch Next does not support component dataFlow yet; use dataFlow only with @spotpatch/vite.",
    );
  }

  return <Config extends object = Readonly<Record<string, unknown>>>(
      input?: NextConfigInput<Config>,
    ): NextConfigFactory<Config> =>
    async (phase, context): Promise<Config> => {
      const inputConfig = await resolveInputConfig(input, phase, context);
      const config = inputConfig as unknown as NextConfig;
      const appRoot = await realpath(process.cwd());
      const paths = resolveAdapterModulePaths(appRoot);

      if (phase !== PHASE_DEVELOPMENT_SERVER) {
        return mergeProductionConfig(config, appRoot, paths) as unknown as Config;
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
        return mergeProductionConfig(config, appRoot, paths) as unknown as Config;
      }

      return mergeDevelopmentConfig(
        config,
        appRoot,
        paths,
        carrier.registryEpoch,
        carrier.sidecarOrigin,
      ) as unknown as Config;
    };
}
