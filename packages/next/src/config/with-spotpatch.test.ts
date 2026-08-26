import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";

import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  NEXT_CLIENT_MODULE_ID,
  NEXT_ENVIRONMENT_KEYS,
  NEXT_IPC_PROTOCOL_VERSION,
  NEXT_SOURCE_RULE_KEYS,
} from "../internal/constants.js";
import { createConfigurationRequestHandler } from "../internal/configuration-server.js";
import { parseNextConfigureMessage } from "../internal/ipc.js";
import {
  withSpotPatch,
  type NextConfigContext,
  type NextConfigFactory,
} from "./with-spotpatch.js";

const originalCwd = process.cwd();
const configurationSecret = "configuration_secret_for_spotpatch_tests_01";
const launchNonce = "launch_nonce_for_tests_001";
const registryEpoch = "registry_epoch_for_tests_01";
let appRoot = "";
let configurationCount = 0;
let server: Server;

async function createApplicationFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "spotpatch-next-config-"));
  const adapterRoot = path.join(root, "node_modules", "@spotpatch", "next");
  const distributionRoot = path.join(adapterRoot, "dist");
  await mkdir(distributionRoot, { recursive: true });
  await Promise.all([
    writeFile(path.join(root, "package.json"), '{"private":true}\n'),
    writeFile(
      path.join(adapterRoot, "package.json"),
      `${JSON.stringify({
        name: "@spotpatch/next",
        exports: {
          "./client": { require: "./dist/client.cjs" },
          "./loader": "./loader.cjs",
        },
      })}\n`,
    ),
    writeFile(path.join(adapterRoot, "loader.cjs"), "module.exports = {};\n"),
    writeFile(path.join(distributionRoot, "client.cjs"), "module.exports = {};\n"),
    writeFile(path.join(distributionRoot, "client.js"), "export {};\n"),
    writeFile(path.join(distributionRoot, "noop.cjs"), "module.exports = {};\n"),
    writeFile(path.join(distributionRoot, "noop.js"), "export {};\n"),
  ]);
  return realpath(root);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function closeServer(value: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    value.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

function listen(value: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    value.once("error", reject);
    value.listen(0, "127.0.0.1", () => {
      value.removeListener("error", reject);
      const address = value.address();

      if (address === null || typeof address === "string") {
        reject(new Error("Expected the configuration fixture to use TCP."));
        return;
      }

      resolve(`http://127.0.0.1:${String(address.port)}`);
    });
  });
}

function createFactory(
  input: NextConfig | NextConfigFactory<NextConfig>,
): NextConfigFactory<NextConfig> {
  return withSpotPatch({ ai: false })<NextConfig>(input);
}

beforeAll(async () => {
  appRoot = await createApplicationFixture();
  process.chdir(appRoot);
  const handler = createConfigurationRequestHandler({
    configurationSecret,
    onConfiguration(value) {
      const message = parseNextConfigureMessage(value);
      configurationCount += 1;
      return Promise.resolve(
        Object.freeze({
          nonce: message.nonce,
          ok: true,
          protocolVersion: NEXT_IPC_PROTOCOL_VERSION,
          requestId: message.requestId,
          type: "spotpatch:next:configure-ack",
        }),
      );
    },
  });
  server = createServer((request, response) => {
    handler(request, response);
  });
  const origin = await listen(server);
  vi.stubEnv(NEXT_ENVIRONMENT_KEYS.appRoot, appRoot);
  vi.stubEnv(NEXT_ENVIRONMENT_KEYS.bundler, "webpack");
  vi.stubEnv(NEXT_ENVIRONMENT_KEYS.configurationSecret, configurationSecret);
  vi.stubEnv(NEXT_ENVIRONMENT_KEYS.internalOrigin, origin);
  vi.stubEnv(NEXT_ENVIRONMENT_KEYS.internalSecret, "registration-secret-for-tests");
  vi.stubEnv(NEXT_ENVIRONMENT_KEYS.launchNonce, launchNonce);
  vi.stubEnv(NEXT_ENVIRONMENT_KEYS.registryEpoch, registryEpoch);
  vi.stubEnv(NEXT_ENVIRONMENT_KEYS.sidecarOrigin, origin);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  process.chdir(originalCwd);
  await closeServer(server);
  await rm(appRoot, { recursive: true, force: true });
});

describe("withSpotPatch", () => {
  it("rejects component data flow instead of exposing a non-functional panel", () => {
    expect(() =>
      withSpotPatch({ dataFlow: {} } as unknown as Parameters<typeof withSpotPatch>[0]),
    ).toThrow(/does not support component dataFlow/u);
  });

  it("composes object, synchronous, and asynchronous development configs once", async () => {
    const context = Object.freeze({
      defaultConfig: {},
    }) satisfies NextConfigContext<NextConfig>;
    const hostRewrite = Object.freeze({
      destination: "/api/:path*",
      source: "/host/:path*",
    });
    const objectFactory = createFactory({
      distDir: ".next-object",
      rewrites: () => Promise.resolve([hostRewrite]),
    });
    const objectConfig = await objectFactory(PHASE_DEVELOPMENT_SERVER, context);
    const rewrites = await objectConfig.rewrites?.();

    expect(rewrites).toMatchObject({
      beforeFiles: [
        {
          basePath: false,
          source: "/__spotpatch/v1/:path*",
        },
      ],
      afterFiles: [hostRewrite],
      fallback: [],
    });
    expect(objectConfig.turbopack?.root).toBe(appRoot);
    expect(objectConfig.turbopack?.resolveAlias?.[NEXT_CLIENT_MODULE_ID]).toContain(
      "client",
    );

    for (const key of NEXT_SOURCE_RULE_KEYS) {
      expect(objectConfig.turbopack?.rules?.[key]).toMatchObject({
        condition: { all: ["development", { not: "foreign" }] },
        loaders: [
          {
            options: { registryEpoch },
          },
        ],
      });
    }

    const invokeWebpack = objectConfig.webpack as unknown as (
      config: Record<string, unknown>,
      context: Readonly<{ dev: boolean }>,
    ) => Record<string, unknown>;
    const webpackConfig = {
      cache: { type: "filesystem", version: "host" },
      module: { rules: [] },
    };
    const webpackResult = invokeWebpack(webpackConfig, { dev: true });

    expect(webpackResult).toBe(webpackConfig);
    expect(webpackConfig.cache.version).toBe(`host|spotpatch:${registryEpoch}`);
    expect(webpackConfig.module.rules).toHaveLength(1);
    expect(webpackConfig.module.rules[0]).toMatchObject({
      enforce: "pre",
      include: appRoot,
      use: [{ options: { registryEpoch } }],
    });

    const syncInput = vi.fn(
      (phase: string, receivedContext: NextConfigContext<NextConfig>): NextConfig => {
        expect(phase).toBe(PHASE_DEVELOPMENT_SERVER);
        expect(receivedContext).toBe(context);
        return { distDir: ".next-sync" };
      },
    );
    const asyncInput = vi.fn(
      (
        phase: string,
        receivedContext: NextConfigContext<NextConfig>,
      ): Promise<NextConfig> => {
        expect(phase).toBe(PHASE_DEVELOPMENT_SERVER);
        expect(receivedContext).toBe(context);
        return Promise.resolve({ distDir: ".next-async" });
      },
    );
    const syncConfig = await createFactory(syncInput)(
      PHASE_DEVELOPMENT_SERVER,
      context,
    );
    const asyncConfig = await createFactory(asyncInput)(
      PHASE_DEVELOPMENT_SERVER,
      context,
    );

    expect(syncConfig.distDir).toBe(".next-sync");
    expect(asyncConfig.distDir).toBe(".next-async");
    expect(syncInput).toHaveBeenCalledTimes(1);
    expect(asyncInput).toHaveBeenCalledTimes(1);
    expect(configurationCount).toBe(1);
  });

  it("rejects a host rewrite that could claim the private API prefix", async () => {
    const context = Object.freeze({
      defaultConfig: {},
    }) satisfies NextConfigContext<NextConfig>;
    const config = await createFactory({
      rewrites: () =>
        Promise.resolve([{ destination: "/api/:path*", source: "/:path*" }]),
    })(PHASE_DEVELOPMENT_SERVER, context);

    await expect(config.rewrites?.()).rejects.toThrow(/conflicts/u);
  });

  it("uses only noop aliases in production", async () => {
    const context = Object.freeze({
      defaultConfig: {},
    }) satisfies NextConfigContext<NextConfig>;
    const config = await createFactory({})(PHASE_PRODUCTION_BUILD, context);
    const turbopackAlias = config.turbopack?.resolveAlias?.[NEXT_CLIENT_MODULE_ID];

    expect(config.turbopack?.root).toBe(appRoot);
    expect(typeof turbopackAlias).toBe("string");
    expect(turbopackAlias).toContain("noop");

    const invokeWebpack = config.webpack as unknown as (
      config: Record<string, unknown>,
      context: Readonly<{ dev: boolean }>,
    ) => Record<string, unknown>;
    const webpackConfig: Record<string, unknown> = {
      module: { rules: [] },
      resolve: { alias: { host: "/host/module.js" } },
    };
    const webpackResult = invokeWebpack(webpackConfig, { dev: false });
    const resolve = webpackResult.resolve;

    expect(isRecord(resolve)).toBe(true);

    if (!isRecord(resolve) || !isRecord(resolve.alias)) {
      throw new Error("Expected webpack aliases after production composition.");
    }

    expect(resolve.alias.host).toBe("/host/module.js");
    expect(resolve.alias[NEXT_CLIENT_MODULE_ID]).toContain("noop");
    expect((webpackResult.module as { rules: unknown[] }).rules).toHaveLength(0);
  });
});
