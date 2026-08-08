import path from "node:path";

import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

const REQUIRED_ENVIRONMENT_KEYS = [
  "SPOTPATCH_POC_LOADER_PATH",
  "SPOTPATCH_POC_PROBE_ID",
  "SPOTPATCH_POC_TURBOPACK_ROOT",
  "SPOTPATCH_POC_TURBOPACK_SOURCE_MAP_MODE",
  "SPOTPATCH_POC_WEBPACK_SOURCE_MAP_MODE",
];

function readDevelopmentEnvironment() {
  const values = Object.fromEntries(
    REQUIRED_ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]),
  );
  const missingKey = REQUIRED_ENVIRONMENT_KEYS.find(
    (key) => typeof values[key] !== "string" || values[key] === "",
  );

  if (missingKey !== undefined) {
    throw new Error(`Missing required Loader POC environment: ${missingKey}`);
  }

  return values;
}

function scopeWebpackFilesystemCache(config, probeId) {
  if (
    config.cache !== null &&
    typeof config.cache === "object" &&
    config.cache.type === "filesystem"
  ) {
    const existingVersion =
      typeof config.cache.version === "string" ? config.cache.version : "";
    config.cache.version = [existingVersion, `spotpatch:${probeId}`]
      .filter(Boolean)
      .join("|");
  }
}

export default function createNextConfig(phase) {
  if (phase !== PHASE_DEVELOPMENT_SERVER) {
    return {};
  }

  const environment = readDevelopmentEnvironment();
  const loader = environment.SPOTPATCH_POC_LOADER_PATH;
  const probeId = environment.SPOTPATCH_POC_PROBE_ID;

  return {
    turbopack: {
      root: environment.SPOTPATCH_POC_TURBOPACK_ROOT,
      rules: {
        "*.tsx": {
          condition: {
            all: ["development", { not: "foreign" }],
          },
          loaders: [
            {
              loader,
              options: {
                probeId,
                sourceMapMode: environment.SPOTPATCH_POC_TURBOPACK_SOURCE_MAP_MODE,
              },
            },
          ],
        },
      },
    },
    webpack(config, { dev }) {
      if (!dev) {
        return config;
      }

      scopeWebpackFilesystemCache(config, probeId);

      config.module.rules.push({
        enforce: "pre",
        include: path.resolve(process.cwd(), "app"),
        test: /\.[jt]sx$/u,
        use: [
          {
            loader,
            options: {
              probeId,
              sourceMapMode: environment.SPOTPATCH_POC_WEBPACK_SOURCE_MAP_MODE,
            },
          },
        ],
      });
      return config;
    },
  };
}
