import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface JsonObject {
  readonly [key: string]: unknown;
}

export interface CodexSchemaPocReport {
  readonly appServerMethods: Readonly<{
    itemAgentMessageDelta: boolean;
    itemCompleted: boolean;
    threadDelete: boolean;
    turnCompleted: boolean;
    turnStarted: boolean;
  }>;
  readonly executable: string;
  readonly generatedSchemaSha256: string;
  readonly managedAskSchemaCandidate: boolean;
  readonly schema: Readonly<{
    agentMessageFinalItem: boolean;
    namedPermissionProfilesSelectable: boolean;
    readOnlySandbox: boolean;
    readOnlySandboxHasRestrictedRoots: boolean;
    threadStartEphemeral: boolean;
    turnOutputSchema: boolean;
  }>;
  readonly version: string;
}

function jsonObject(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid generated Codex schema: ${label}`);
  }
  return value as JsonObject;
}

async function readJson(filePath: string): Promise<JsonObject> {
  return jsonObject(JSON.parse(await readFile(filePath, "utf8")) as unknown, filePath);
}

function property(schema: JsonObject, name: string): unknown {
  const properties = jsonObject(schema.properties, "properties");
  return properties[name];
}

function includesExact(serialized: string, value: string): boolean {
  return serialized.includes(JSON.stringify(value));
}

export async function inspectCodexAppServerSchema(
  executable: string,
): Promise<CodexSchemaPocReport> {
  const schemaRoot = await mkdtemp(path.join(os.tmpdir(), "spotpatch-ask-schema-"));
  try {
    const versionResult = await execFileAsync(executable, ["--version"], {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 16 * 1024,
    });
    const version = versionResult.stdout.trim();
    if (!/^codex-cli \d+\.\d+\.\d+(?:[-+][\w.-]+)?$/u.test(version)) {
      throw new Error("The Codex version output is not recognized.");
    }
    await execFileAsync(
      executable,
      ["app-server", "generate-json-schema", "--experimental", "--out", schemaRoot],
      { encoding: "utf8", timeout: 30_000, maxBuffer: 64 * 1024 },
    );

    const bundlePath = path.join(schemaRoot, "codex_app_server_protocol.schemas.json");
    const v2BundlePath = path.join(
      schemaRoot,
      "codex_app_server_protocol.v2.schemas.json",
    );
    const [bundleText, v2BundleText, threadStart, turnStart, itemCompleted] =
      await Promise.all([
        readFile(bundlePath, "utf8"),
        readFile(v2BundlePath, "utf8"),
        readJson(path.join(schemaRoot, "v2", "ThreadStartParams.json")),
        readJson(path.join(schemaRoot, "v2", "TurnStartParams.json")),
        readJson(path.join(schemaRoot, "v2", "ItemCompletedNotification.json")),
      ]);
    const combined = `${bundleText}\n${v2BundleText}`;
    const turnText = JSON.stringify(turnStart);
    const itemText = JSON.stringify(itemCompleted);
    const permissionsText = JSON.stringify(property(turnStart, "permissions"));
    const schema = Object.freeze({
      agentMessageFinalItem:
        includesExact(itemText, "agentMessage") &&
        includesExact(itemText, "text") &&
        includesExact(itemText, "phase"),
      namedPermissionProfilesSelectable:
        permissionsText.includes("permission") && permissionsText.includes('"string"'),
      readOnlySandbox: includesExact(turnText, "readOnly"),
      readOnlySandboxHasRestrictedRoots:
        includesExact(turnText, "readableRoots") &&
        includesExact(turnText, "restricted"),
      threadStartEphemeral: property(threadStart, "ephemeral") !== undefined,
      turnOutputSchema: property(turnStart, "outputSchema") !== undefined,
    });
    const appServerMethods = Object.freeze({
      itemAgentMessageDelta: includesExact(bundleText, "item/agentMessage/delta"),
      itemCompleted: includesExact(bundleText, "item/completed"),
      threadDelete: includesExact(bundleText, "thread/delete"),
      turnCompleted: includesExact(bundleText, "turn/completed"),
      turnStarted: includesExact(bundleText, "turn/started"),
    });
    const allMethods = Object.values(appServerMethods).every(Boolean);
    const constrainedReadCandidate =
      schema.readOnlySandboxHasRestrictedRoots ||
      schema.namedPermissionProfilesSelectable;

    return Object.freeze({
      executable,
      version,
      generatedSchemaSha256: createHash("sha256").update(combined).digest("hex"),
      appServerMethods,
      schema,
      managedAskSchemaCandidate:
        allMethods &&
        schema.agentMessageFinalItem &&
        schema.readOnlySandbox &&
        schema.threadStartEphemeral &&
        schema.turnOutputSchema &&
        constrainedReadCandidate,
    });
  } finally {
    await rm(schemaRoot, { recursive: true, force: true });
  }
}
