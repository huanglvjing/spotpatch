import path from "node:path";

import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

const REQUIRED_ENVIRONMENT_KEYS = [
  "SPOTPATCH_POC_LOADER_PATH",
  "SPOTPATCH_POC_PROBE_ID",
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

export default function createNextConfig(phase) {
  if (phase !== PHASE_DEVELOPMENT_SERVER) {
    return {};
  }

  const environment = readDevelopmentEnvironment();
  const loader = environment.SPOTPATCH_POC_LOADER_PATH;
  const probeId = environment.SPOTPATCH_POC_PROBE_ID;

  return {
    turbopack: {
      rules: {
        "*.tsx": {
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
