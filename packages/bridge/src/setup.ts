import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";

import {
  ERROR_CODES,
  EXTERNAL_HANDOFF_LIMITS,
  SpotPatchError,
} from "@spotpatch/shared";

export type BridgeCliAdapter = "bridge" | "next" | "vite";
export type BridgeSetupClient = "claude" | "codex" | "cursor";
export type BridgeSetupMode = "active" | "inbox";
export const BRIDGE_MCP_TOOL_TIMEOUT_SECONDS = 30;
/**
 * Environment inputs used by the POSIX runtime-directory resolver. SpotPatch
 * asks Codex to forward only these path-related variables; it does not add the
 * connector's complete environment to the MCP configuration.
 */
export const CODEX_BRIDGE_RUNTIME_ENV_VARIABLE_NAMES = Object.freeze([
  "XDG_RUNTIME_DIR",
  "TMPDIR",
  "TMP",
  "TEMP",
] as const);

export interface BridgeMcpServerConfiguration {
  readonly args: readonly string[];
  readonly command: "node";
}

export interface BridgeSetupPlan {
  readonly client: BridgeSetupClient;
  readonly content: string;
  readonly legacyCodexContent?: string;
  readonly legacySpotPatch?: BridgeMcpServerConfiguration;
  readonly mode: BridgeSetupMode;
  readonly path: string;
}

function connectorArguments(
  adapter: BridgeCliAdapter,
  mode: BridgeSetupMode,
): readonly string[] {
  const command = mode === "active" ? ["channel", "claude"] : ["mcp"];

  if (adapter === "vite") {
    return Object.freeze([
      "./node_modules/@spotpatch/vite/dist/cli.js",
      "bridge",
      ...command,
    ]);
  }

  if (adapter === "next") {
    return Object.freeze([
      "./node_modules/@spotpatch/next/dist/cli.js",
      "bridge",
      ...command,
    ]);
  }

  return Object.freeze(["./node_modules/@spotpatch/bridge/dist/cli.js", ...command]);
}

export function createBridgeMcpServerConfiguration(
  adapter: BridgeCliAdapter,
  mode: BridgeSetupMode,
): BridgeMcpServerConfiguration {
  return Object.freeze({
    command: "node",
    args: connectorArguments(adapter, mode),
  });
}

function quotedToml(value: string): string {
  return JSON.stringify(value);
}

export function createBridgeSetupPlan(
  client: BridgeSetupClient,
  adapter: BridgeCliAdapter,
  cwd = process.cwd(),
  mode: BridgeSetupMode = "inbox",
): BridgeSetupPlan {
  if (mode === "active" && client !== "claude") {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
  }

  const configuration = createBridgeMcpServerConfiguration(adapter, mode);

  if (client === "codex") {
    const args = configuration.args.map(quotedToml).join(", ");
    const environmentVariables =
      CODEX_BRIDGE_RUNTIME_ENV_VARIABLE_NAMES.map(quotedToml).join(", ");
    const commonLines = [
      "[mcp_servers.spotpatch]",
      `command = ${quotedToml(configuration.command)}`,
      `args = [${args}]`,
    ];
    const legacyCodexContent = [
      ...commonLines,
      `tool_timeout_sec = ${String(BRIDGE_MCP_TOOL_TIMEOUT_SECONDS)}`,
      "",
    ].join("\n");
    return Object.freeze({
      client,
      mode,
      path: path.join(cwd, ".codex", "config.toml"),
      legacyCodexContent,
      content: [
        ...commonLines,
        `env_vars = [${environmentVariables}]`,
        `tool_timeout_sec = ${String(BRIDGE_MCP_TOOL_TIMEOUT_SECONDS)}`,
        "",
      ].join("\n"),
    });
  }

  return Object.freeze({
    client,
    mode,
    ...(mode === "active"
      ? {
          legacySpotPatch: createBridgeMcpServerConfiguration(adapter, "inbox"),
        }
      : {}),
    path:
      client === "claude"
        ? path.join(cwd, ".mcp.json")
        : path.join(cwd, ".cursor", "mcp.json"),
    content: `${JSON.stringify({ mcpServers: { spotpatch: configuration } }, null, 2)}\n`,
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readExisting(filePath: string): Promise<string | undefined> {
  let handle: Awaited<ReturnType<typeof open>>;

  try {
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST, undefined, {
      cause: error,
    });
  }

  try {
    const status = await handle.stat();

    if (
      !status.isFile() ||
      status.size > EXTERNAL_HANDOFF_LIMITS.maximumSetupConfigBytes
    ) {
      throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
    }

    return await handle.readFile("utf8");
  } catch (error: unknown) {
    if (error instanceof SpotPatchError) throw error;
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST, undefined, {
      cause: error,
    });
  } finally {
    await handle.close();
  }
}

async function resolveSetupTarget(plan: BridgeSetupPlan): Promise<string> {
  const logicalDirectory = path.dirname(plan.path);
  const logicalRoot =
    plan.client === "claude" ? logicalDirectory : path.dirname(logicalDirectory);
  const root = await realpath(logicalRoot);
  const rootStatus = await lstat(root);

  if (!rootStatus.isDirectory() || rootStatus.isSymbolicLink()) {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
  }

  if (plan.client === "claude") return path.join(root, ".mcp.json");
  const directoryName = plan.client === "cursor" ? ".cursor" : ".codex";
  const directory = path.join(root, directoryName);

  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }

  const status = await lstat(directory);

  if (!status.isDirectory() || status.isSymbolicLink() || (status.mode & 0o022) !== 0) {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
  }

  return path.join(directory, plan.client === "cursor" ? "mcp.json" : "config.toml");
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${randomBytes(8).toString("hex")}.tmp`,
  );
  let renamed = false;

  try {
    const handle = await open(temporary, "wx", 0o600);

    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    await rename(temporary, filePath);
    renamed = true;
  } finally {
    if (!renamed) await unlink(temporary).catch(() => undefined);
  }
}

async function preserveBackup(filePath: string, content: string): Promise<void> {
  const backupPath = `${filePath}.spotpatch.bak`;
  let created = false;

  try {
    const handle = await open(backupPath, "wx", 0o600);
    created = true;

    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    return;
  } catch (error: unknown) {
    if (created) {
      await unlink(backupPath).catch(() => undefined);
      throw error;
    }

    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }

  const handle = await open(backupPath, constants.O_RDONLY | constants.O_NOFOLLOW);

  try {
    const status = await handle.stat();
    const uid = process.getuid?.();

    if (
      !status.isFile() ||
      uid === undefined ||
      status.uid !== uid ||
      (status.mode & 0o077) !== 0 ||
      (await handle.readFile("utf8")) !== content
    ) {
      throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
    }
  } finally {
    await handle.close();
  }
}

export async function applyBridgeSetupPlan(
  plan: BridgeSetupPlan,
): Promise<"created" | "unchanged" | "updated"> {
  const targetPath = await resolveSetupTarget(plan);
  const existing = await readExisting(targetPath);

  if (existing === plan.content) return "unchanged";

  if (plan.client === "codex") {
    if (existing !== undefined && existing !== plan.legacyCodexContent) {
      throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
    }

    if (existing !== undefined) {
      await preserveBackup(targetPath, existing);
      if ((await readExisting(targetPath)) !== existing) {
        throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
      }
    }

    await atomicWrite(targetPath, plan.content);
    return existing === undefined ? "created" : "updated";
  }

  let next = plan.content;

  if (existing !== undefined) {
    let current: unknown;
    let requested: unknown;

    try {
      current = JSON.parse(existing) as unknown;
      requested = JSON.parse(plan.content) as unknown;
    } catch (error: unknown) {
      throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST, undefined, {
        cause: error,
      });
    }

    if (
      !record(current) ||
      !record(current.mcpServers) ||
      !record(requested) ||
      !record(requested.mcpServers)
    ) {
      throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
    }

    const requestedSpotPatch = requested.mcpServers.spotpatch;
    const currentSpotPatch = current.mcpServers.spotpatch;
    const isExactActiveMigration =
      plan.client === "claude" &&
      plan.mode === "active" &&
      plan.legacySpotPatch !== undefined &&
      JSON.stringify(currentSpotPatch) === JSON.stringify(plan.legacySpotPatch);

    if (
      currentSpotPatch !== undefined &&
      JSON.stringify(currentSpotPatch) !== JSON.stringify(requestedSpotPatch) &&
      !isExactActiveMigration
    ) {
      throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
    }

    current.mcpServers.spotpatch = requestedSpotPatch;
    next = `${JSON.stringify(current, null, 2)}\n`;
    if (next === existing) return "unchanged";
  }

  if (existing !== undefined) {
    await preserveBackup(targetPath, existing);

    if ((await readExisting(targetPath)) !== existing) {
      throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
    }
  }

  await atomicWrite(targetPath, next);
  return existing === undefined ? "created" : "updated";
}
