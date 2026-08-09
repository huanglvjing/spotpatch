export const NEXT_IPC_PROTOCOL_VERSION = 1 as const;
export const NEXT_IPC_MESSAGE_LIMIT_BYTES = 256 * 1024;
export const NEXT_IPC_TIMEOUT_MS = 15_000;
export const NEXT_INTERNAL_REGISTRATION_PATH =
  "/__spotpatch-internal/register" as const;
export const NEXT_INTERNAL_CONFIGURATION_PATH =
  "/__spotpatch-internal/configure" as const;

export const NEXT_ENVIRONMENT_KEYS = Object.freeze({
  appRoot: "SPOTPATCH_NEXT_APP_ROOT",
  bundler: "SPOTPATCH_NEXT_BUNDLER",
  configurationSecret: "SPOTPATCH_NEXT_CONFIGURATION_SECRET",
  internalOrigin: "SPOTPATCH_NEXT_INTERNAL_ORIGIN",
  internalSecret: "SPOTPATCH_NEXT_INTERNAL_SECRET",
  launchNonce: "SPOTPATCH_NEXT_LAUNCH_NONCE",
  registryEpoch: "SPOTPATCH_NEXT_REGISTRY_EPOCH",
  sidecarOrigin: "SPOTPATCH_NEXT_SIDECAR_ORIGIN",
} as const);

export const NEXT_SOURCE_RULE_KEYS = Object.freeze(["*.jsx", "*.tsx"] as const);
export const NEXT_CLIENT_MODULE_ID = "@spotpatch/next/client" as const;

export const NEXT_DEFAULT_INCLUDE = Object.freeze([/\.(?:jsx|tsx)$/u]);
