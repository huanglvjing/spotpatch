/// <reference types="node" />

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import type { Stats } from "node:fs";
import { lstat, mkdir, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

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

const execFileAsync = promisify(execFile);
const WINDOWS_ACL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$target = $env:SPOTPATCH_ACL_TARGET
$kind = $env:SPOTPATCH_ACL_KIND
$operation = $env:SPOTPATCH_ACL_OPERATION
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$allowed = @($identity.Value, 'S-1-5-18', 'S-1-5-32-544')
if ($kind -eq 'directory') {
  $item = [System.IO.DirectoryInfo]::new($target)
  if ($operation -eq 'initialize') {
    $security = [System.Security.AccessControl.DirectorySecurity]::new()
    $security.SetOwner($identity)
    foreach ($sidValue in $allowed) {
      $sid = [System.Security.Principal.SecurityIdentifier]::new($sidValue)
      $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
        $sid,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow
      )
      [void]$security.AddAccessRule($rule)
    }
    $security.SetAccessRuleProtection($true, $false)
    $item.SetAccessControl($security)
  }
  $acl = $item.GetAccessControl(
    [System.Security.AccessControl.AccessControlSections]'Access, Owner'
  )
} elseif ($kind -eq 'file') {
  $item = [System.IO.FileInfo]::new($target)
  if ($operation -eq 'initialize') {
    $security = [System.Security.AccessControl.FileSecurity]::new()
    $security.SetOwner($identity)
    foreach ($sidValue in $allowed) {
      $sid = [System.Security.Principal.SecurityIdentifier]::new($sidValue)
      $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
        $sid,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.Security.AccessControl.AccessControlType]::Allow
      )
      [void]$security.AddAccessRule($rule)
    }
    $security.SetAccessRuleProtection($true, $false)
    $item.SetAccessControl($security)
  }
  $acl = $item.GetAccessControl(
    [System.Security.AccessControl.AccessControlSections]'Access, Owner'
  )
} else {
  exit 10
}
if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $identity.Value) {
  exit 11
}
foreach ($rule in $acl.GetAccessRules(
  $true,
  $true,
  [System.Security.Principal.SecurityIdentifier]
)) {
  if (
    $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
    $allowed -notcontains $rule.IdentityReference.Value
  ) {
    exit 12
  }
}
`;

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

function windowsPowerShellExecutable(): string {
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  if (systemRoot === undefined || !path.win32.isAbsolute(systemRoot)) {
    throw new SpotPatchError(ERROR_CODES.BRIDGE_UNAUTHORIZED);
  }
  return path.win32.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
}

async function verifyWindowsAcl(
  candidate: string,
  kind: "directory" | "file",
  initialize: boolean,
): Promise<void> {
  try {
    await execFileAsync(
      windowsPowerShellExecutable(),
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_ACL_SCRIPT],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          SPOTPATCH_ACL_KIND: kind,
          SPOTPATCH_ACL_OPERATION: initialize ? "initialize" : "verify",
          SPOTPATCH_ACL_TARGET: candidate,
        },
        timeout: 10_000,
        windowsHide: true,
      },
    );
  } catch (error: unknown) {
    throw new SpotPatchError(ERROR_CODES.BRIDGE_UNAUTHORIZED, undefined, {
      cause: error,
    });
  }
}

export async function assertPrivateExternalHandoffPath(
  candidate: string,
  kind: "directory" | "file",
): Promise<Stats> {
  const status = await lstat(candidate);
  const correctKind = kind === "directory" ? status.isDirectory() : status.isFile();

  if (!correctKind || status.isSymbolicLink()) {
    throw new SpotPatchError(ERROR_CODES.BRIDGE_UNAUTHORIZED);
  }

  if (process.platform === "win32") {
    await verifyWindowsAcl(candidate, kind, false);
    return status;
  }

  const uid = process.getuid?.();
  if (uid === undefined || status.uid !== uid || (status.mode & 0o077) !== 0) {
    throw new SpotPatchError(ERROR_CODES.BRIDGE_UNAUTHORIZED);
  }

  return status;
}

export async function initializePrivateExternalHandoffFile(
  candidate: string,
): Promise<void> {
  if (process.platform === "win32") {
    await verifyWindowsAcl(candidate, "file", true);
  }
}

async function initializeWindowsDirectory(directory: string): Promise<void> {
  if (process.platform === "win32") {
    await verifyWindowsAcl(directory, "directory", true);
  }
}

async function ensurePrivateSubdirectory(
  base: string,
  create: boolean,
): Promise<string> {
  const directory = path.join(base, "spotpatch");
  let created = false;

  if (create) {
    try {
      await mkdir(directory, { mode: 0o700 });
      created = true;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
  }

  if (created) await initializeWindowsDirectory(directory);
  await assertPrivateExternalHandoffPath(directory, "directory");
  return realpath(directory);
}

async function resolveWindowsRuntimeDirectory(create: boolean): Promise<string> {
  const configuredBase = process.env.LOCALAPPDATA;

  if (configuredBase !== undefined && !path.isAbsolute(configuredBase)) {
    throw new SpotPatchError(ERROR_CODES.BRIDGE_UNAUTHORIZED);
  }

  const base = configuredBase ?? path.join(os.homedir(), "AppData", "Local");
  const directory = path.join(base, "SpotPatch", "external-agent-runtime-v1");
  let created = false;

  if (create) {
    created = (await mkdir(directory, { mode: 0o700, recursive: true })) !== undefined;
  }

  if (created) await initializeWindowsDirectory(directory);
  await assertPrivateExternalHandoffPath(directory, "directory");
  return realpath(directory);
}

export async function resolveExternalHandoffRuntimeDirectory(
  create: boolean,
): Promise<string> {
  const xdgRuntimeDirectory = process.env.XDG_RUNTIME_DIR;

  if (xdgRuntimeDirectory !== undefined && !path.isAbsolute(xdgRuntimeDirectory)) {
    throw new SpotPatchError(ERROR_CODES.BRIDGE_UNAUTHORIZED);
  }

  if (xdgRuntimeDirectory !== undefined) {
    try {
      if (process.platform !== "win32") {
        await assertPrivateExternalHandoffPath(xdgRuntimeDirectory, "directory");
      }
      return await ensurePrivateSubdirectory(xdgRuntimeDirectory, create);
    } catch (error: unknown) {
      if (!create && (error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new SpotPatchError(ERROR_CODES.SESSION_NOT_FOUND);
      }

      throw error;
    }
  }

  if (process.platform === "win32") {
    try {
      return await resolveWindowsRuntimeDirectory(create);
    } catch (error: unknown) {
      if (!create && (error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new SpotPatchError(ERROR_CODES.SESSION_NOT_FOUND);
      }

      throw error;
    }
  }

  const uid = process.getuid?.();
  if (uid === undefined) {
    throw new SpotPatchError(ERROR_CODES.BRIDGE_UNAUTHORIZED);
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
    await assertPrivateExternalHandoffPath(fallback, "directory");
  } catch (error: unknown) {
    if (!create && (error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new SpotPatchError(ERROR_CODES.SESSION_NOT_FOUND);
    }

    throw error;
  }

  return realpath(fallback);
}

export async function computeExternalHandoffProjectKey(root: string): Promise<string> {
  const canonicalRoot = await realpath(root);
  return createHash("sha256")
    .update(`${EXTERNAL_HANDOFF_PROJECT_KEY_SALT}\0${canonicalRoot}`)
    .digest("hex");
}
