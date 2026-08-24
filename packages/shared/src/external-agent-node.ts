/// <reference types="node" />

import { createHash } from "node:crypto";
import { lstat, mkdir, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import {
  EXTERNAL_HANDOFF_ACTIVE_ADAPTER_KINDS,
  EXTERNAL_HANDOFF_BROKER_PROTOCOL_VERSION,
  EXTERNAL_HANDOFF_FRAMEWORKS,
  EXTERNAL_HANDOFF_LIMITS,
  activeAdapterSummarySchema,
  dispatchSummarySchema,
  externalHandoffReportableDispatchPhaseSchema,
  externalHandoffSnapshotSchema,
  externalHandoffSummarySchema,
  type ActiveAdapterSummary,
  type DispatchSummary,
  type ExternalHandoffSnapshot,
} from "./protocol/external-handoff.js";
import { ERROR_CODES } from "./errors/error-code.js";
import { SpotPatchError } from "./errors/spotpatch-error.js";

export const SPOTPATCH_BRIDGE_TOKEN_HEADER = "X-SpotPatch-Bridge-Token" as const;
export const SPOTPATCH_BRIDGE_PATHS = Object.freeze({
  status: "/bridge/v1/status",
  current: "/bridge/v1/handoff/current",
  wait: "/bridge/v1/handoff/wait",
  ack: "/bridge/v1/handoff/ack",
  activeClaim: "/bridge/v1/active/claim",
  activeHeartbeat: "/bridge/v1/active/heartbeat",
  activeReport: "/bridge/v1/active/report",
  activeRelease: "/bridge/v1/active/release",
});
export const EXTERNAL_HANDOFF_PROJECT_KEY_SALT =
  "spotpatch-external-agent-project-v1" as const;

const opaqueIdSchema = z
  .string()
  .min(22)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/u);
const projectKeySchema = z
  .string()
  .length(64)
  .regex(/^[a-f0-9]+$/u);
const loopbackEndpointSchema = z.url().refine((value) => {
  const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/u.exec(value);

  if (match?.[1] === undefined) {
    return false;
  }

  const port = Number(match[1]);
  return Number.isSafeInteger(port) && port <= 65_535;
});

export const externalHandoffDescriptorSchema = z.strictObject({
  schemaVersion: z.literal(1),
  brokerProtocolVersion: z.literal(EXTERNAL_HANDOFF_BROKER_PROTOCOL_VERSION),
  projectKey: projectKeySchema,
  sessionId: opaqueIdSchema,
  framework: z.enum(EXTERNAL_HANDOFF_FRAMEWORKS),
  endpoint: loopbackEndpointSchema,
  bridgeToken: z
    .string()
    .min(43)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/u),
  pid: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});

export const bridgeStatusRequestSchema = z.strictObject({});
export const bridgeCurrentRequestSchema = z.strictObject({
  cursor: opaqueIdSchema.optional(),
});
export const bridgeWaitRequestSchema = z.strictObject({
  afterCursor: opaqueIdSchema.optional(),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(EXTERNAL_HANDOFF_LIMITS.maximumWaitMs)
    .default(EXTERNAL_HANDOFF_LIMITS.defaultWaitMs),
});
export const bridgeAckRequestSchema = z.strictObject({
  cursor: opaqueIdSchema,
  connectorInstanceId: opaqueIdSchema,
});
export const bridgeActiveClaimRequestSchema = z.strictObject({
  adapterKind: z.enum(EXTERNAL_HANDOFF_ACTIVE_ADAPTER_KINDS),
  connectorInstanceId: opaqueIdSchema,
});
export const bridgeActiveHeartbeatRequestSchema = z.strictObject({
  leaseToken: opaqueIdSchema,
});
export const bridgeActiveReportRequestSchema = z.strictObject({
  leaseToken: opaqueIdSchema,
  cursor: opaqueIdSchema,
  phase: externalHandoffReportableDispatchPhaseSchema,
});
export const bridgeActiveReleaseRequestSchema = z.strictObject({
  leaseToken: opaqueIdSchema,
});
export const bridgeStatusSchema = z.strictObject({
  brokerProtocolVersion: z.literal(EXTERNAL_HANDOFF_BROKER_PROTOCOL_VERSION),
  projectKey: projectKeySchema,
  sessionId: opaqueIdSchema,
  framework: z.enum(EXTERNAL_HANDOFF_FRAMEWORKS),
  current: externalHandoffSummarySchema.nullable(),
});
export const bridgeCurrentResultSchema = z.strictObject({
  outcome: z.literal("handoff"),
  snapshot: externalHandoffSnapshotSchema,
});
export const bridgeWaitResultSchema = z.discriminatedUnion("outcome", [
  bridgeCurrentResultSchema,
  z.strictObject({ outcome: z.literal("timeout") }),
]);
export const bridgeAckResultSchema = z.strictObject({
  summary: externalHandoffSummarySchema,
});
export const bridgeActiveClaimResultSchema = z.strictObject({
  leaseToken: opaqueIdSchema,
  heartbeatIntervalMs: z.literal(EXTERNAL_HANDOFF_LIMITS.activeHeartbeatIntervalMs),
  baselineCursor: opaqueIdSchema.nullable(),
  activeAdapter: activeAdapterSummarySchema,
});
export const bridgeActiveStateResultSchema = z.strictObject({
  activeAdapter: activeAdapterSummarySchema.nullable(),
  dispatch: dispatchSummarySchema.nullable(),
});
export const bridgeActiveHeartbeatResultSchema = bridgeActiveStateResultSchema;
export const bridgeActiveReportResultSchema = bridgeActiveStateResultSchema;
export const bridgeActiveReleaseResultSchema = bridgeActiveStateResultSchema;

export type ExternalHandoffDescriptor = z.infer<typeof externalHandoffDescriptorSchema>;
export type BridgeStatus = z.infer<typeof bridgeStatusSchema>;
export type BridgeWaitResult =
  | Readonly<{ outcome: "handoff"; snapshot: ExternalHandoffSnapshot }>
  | Readonly<{ outcome: "timeout" }>;
export interface BridgeActiveClaimResult {
  readonly leaseToken: string;
  readonly heartbeatIntervalMs: typeof EXTERNAL_HANDOFF_LIMITS.activeHeartbeatIntervalMs;
  readonly baselineCursor: string | null;
  readonly activeAdapter: ActiveAdapterSummary;
}
export interface BridgeActiveStateResult {
  readonly activeAdapter: ActiveAdapterSummary | null;
  readonly dispatch: DispatchSummary | null;
}

function currentUid(): number {
  const uid = process.getuid?.();

  if (uid === undefined) {
    throw new SpotPatchError(ERROR_CODES.BRIDGE_UNAUTHORIZED);
  }

  return uid;
}

async function assertPrivateDirectory(directory: string, uid: number): Promise<void> {
  const status = await lstat(directory);

  if (
    !status.isDirectory() ||
    status.isSymbolicLink() ||
    status.uid !== uid ||
    (status.mode & 0o077) !== 0
  ) {
    throw new SpotPatchError(ERROR_CODES.BRIDGE_UNAUTHORIZED);
  }
}

async function ensurePrivateSubdirectory(
  base: string,
  uid: number,
  create: boolean,
): Promise<string> {
  const directory = path.join(base, "spotpatch");

  if (create) {
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
  }

  await assertPrivateDirectory(directory, uid);
  return directory;
}

export async function resolveExternalHandoffRuntimeDirectory(
  create: boolean,
): Promise<string> {
  if (process.platform === "win32") {
    throw new SpotPatchError(ERROR_CODES.BRIDGE_UNAUTHORIZED);
  }

  const uid = currentUid();
  const xdgRuntimeDirectory = process.env.XDG_RUNTIME_DIR;

  if (xdgRuntimeDirectory !== undefined && !path.isAbsolute(xdgRuntimeDirectory)) {
    throw new SpotPatchError(ERROR_CODES.BRIDGE_UNAUTHORIZED);
  }

  if (xdgRuntimeDirectory !== undefined) {
    try {
      await assertPrivateDirectory(xdgRuntimeDirectory, uid);
      return await ensurePrivateSubdirectory(xdgRuntimeDirectory, uid, create);
    } catch (error: unknown) {
      if (!create && (error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new SpotPatchError(ERROR_CODES.SESSION_NOT_FOUND);
      }

      throw error;
    }
  }

  const fallback = path.join(os.tmpdir(), `spotpatch-${String(uid)}`);

  if (create) {
    try {
      await mkdir(fallback, { mode: 0o700 });
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
  }

  try {
    await assertPrivateDirectory(fallback, uid);
  } catch (error: unknown) {
    if (!create && (error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new SpotPatchError(ERROR_CODES.SESSION_NOT_FOUND);
    }

    throw error;
  }

  return fallback;
}

export async function computeExternalHandoffProjectKey(root: string): Promise<string> {
  const canonicalRoot = await realpath(root);
  return createHash("sha256")
    .update(`${EXTERNAL_HANDOFF_PROJECT_KEY_SALT}\0${canonicalRoot}`)
    .digest("hex");
}
