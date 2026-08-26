import { rm } from "node:fs/promises";
import path from "node:path";

import { EXTERNAL_AGENT_MANAGED_PROFILE } from "@spotpatch/shared";
import { computeExternalHandoffProjectKey } from "@spotpatch/shared/external-agent-node";
import { z } from "zod";

import {
  ensurePrivateDirectory,
  readPrivateJson,
  resolvePrivateConfigBase,
  writePrivateJsonAtomic,
} from "./private-store.js";

const GRANT_SCHEMA_VERSION = 1;
const GRANT_POLICY_VERSION = 1;

const grantSchema = z.strictObject({
  schemaVersion: z.literal(GRANT_SCHEMA_VERSION),
  projectKey: z.string().regex(/^[a-f0-9]{64}$/u),
  adapterKind: z.literal("codex"),
  profile: z.literal(EXTERNAL_AGENT_MANAGED_PROFILE),
  policyVersion: z.literal(GRANT_POLICY_VERSION),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
});

export type ManagedGrantState = "missing" | "valid" | "invalid";

export interface ManagedGrantStore {
  readonly projectKey: string;
  read(): Promise<ManagedGrantState>;
  grant(): Promise<void>;
  touch(): Promise<void>;
  revoke(): Promise<void>;
}

export interface CreateManagedGrantStoreOptions {
  readonly configBase?: string;
  readonly now?: () => Date;
  readonly root: string;
}

async function readSecureGrant(filePath: string): Promise<unknown> {
  return readPrivateJson(filePath, 4_096);
}

async function writeAtomicGrant(filePath: string, value: unknown): Promise<void> {
  await writePrivateJsonAtomic(filePath, "grant", value);
}

export async function createManagedGrantStore(
  options: CreateManagedGrantStoreOptions,
): Promise<ManagedGrantStore> {
  const projectKey = await computeExternalHandoffProjectKey(options.root);
  const canonicalBase = await resolvePrivateConfigBase(options.configBase);
  const directory = path.join(canonicalBase, "external-agent-grants");
  await ensurePrivateDirectory(directory);
  const filePath = path.join(directory, `${projectKey}.json`);
  const now = options.now ?? (() => new Date());

  const record = (createdAt: string) =>
    Object.freeze({
      schemaVersion: GRANT_SCHEMA_VERSION,
      projectKey,
      adapterKind: "codex",
      profile: EXTERNAL_AGENT_MANAGED_PROFILE,
      policyVersion: GRANT_POLICY_VERSION,
      createdAt,
      lastUsedAt: now().toISOString(),
    } as const);

  return Object.freeze({
    projectKey,
    async read(): Promise<ManagedGrantState> {
      try {
        const value = await readSecureGrant(filePath);
        if (value === undefined) return "missing";
        const parsed = grantSchema.safeParse(value);
        return parsed.success && parsed.data.projectKey === projectKey
          ? "valid"
          : "invalid";
      } catch {
        return "invalid";
      }
    },
    async grant(): Promise<void> {
      const timestamp = now().toISOString();
      await writeAtomicGrant(filePath, record(timestamp));
    },
    async touch(): Promise<void> {
      const value = await readSecureGrant(filePath);
      const parsed = grantSchema.safeParse(value);
      if (!parsed.success || parsed.data.projectKey !== projectKey) {
        throw new Error("Managed grant is invalid.");
      }
      await writeAtomicGrant(filePath, record(parsed.data.createdAt));
    },
    async revoke(): Promise<void> {
      await rm(filePath, { force: true });
    },
  });
}
