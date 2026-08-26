import { rm } from "node:fs/promises";
import path from "node:path";

import { computeExternalHandoffProjectKey } from "@spotpatch/shared/external-agent-node";
import { z } from "zod";

import {
  ensurePrivateDirectory,
  readPrivateJson,
  resolvePrivateConfigBase,
  writePrivateJsonAtomic,
} from "./private-store.js";

const CLEANUP_JOURNAL_SCHEMA_VERSION = 1;
const MAXIMUM_THREAD_RECORDS = 32;
const MAXIMUM_JOURNAL_BYTES = 16 * 1_024;
function hasOnlyPrintableCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) return false;
  }
  return true;
}

const threadIdSchema = z.string().min(1).max(256).refine(hasOnlyPrintableCharacters);
const journalSchema = z.strictObject({
  schemaVersion: z.literal(CLEANUP_JOURNAL_SCHEMA_VERSION),
  projectKey: z.string().regex(/^[a-f0-9]{64}$/u),
  threads: z
    .array(
      z.strictObject({
        threadId: threadIdSchema,
        createdAt: z.iso.datetime(),
      }),
    )
    .max(MAXIMUM_THREAD_RECORDS),
});

export interface ManagedThreadCleanupEntry {
  readonly threadId: string;
  readonly createdAt: string;
}

export interface ManagedThreadCleanupJournal {
  list(): Promise<readonly ManagedThreadCleanupEntry[]>;
  add(threadId: string): Promise<void>;
  remove(threadId: string): Promise<void>;
}

export interface CreateManagedThreadCleanupJournalOptions {
  readonly configBase?: string;
  readonly now?: () => Date;
  readonly root: string;
}

export async function createManagedThreadCleanupJournal(
  options: CreateManagedThreadCleanupJournalOptions,
): Promise<ManagedThreadCleanupJournal> {
  const projectKey = await computeExternalHandoffProjectKey(options.root);
  const canonicalBase = await resolvePrivateConfigBase(options.configBase);
  const directory = path.join(canonicalBase, "external-agent-cleanup");
  await ensurePrivateDirectory(directory);
  const filePath = path.join(directory, `${projectKey}.json`);
  const now = options.now ?? (() => new Date());
  let operationTail: Promise<void> = Promise.resolve();

  const readEntries = async (): Promise<readonly ManagedThreadCleanupEntry[]> => {
    const value = await readPrivateJson(filePath, MAXIMUM_JOURNAL_BYTES);
    if (value === undefined) return Object.freeze([]);
    const parsed = journalSchema.safeParse(value);
    if (!parsed.success || parsed.data.projectKey !== projectKey) {
      throw new Error("Managed thread cleanup journal is invalid.");
    }
    return Object.freeze(
      parsed.data.threads.map((entry) => Object.freeze({ ...entry })),
    );
  };
  const writeEntries = async (
    entries: readonly ManagedThreadCleanupEntry[],
  ): Promise<void> => {
    if (entries.length === 0) {
      await rm(filePath, { force: true });
      return;
    }
    await writePrivateJsonAtomic(filePath, "cleanup", {
      schemaVersion: CLEANUP_JOURNAL_SCHEMA_VERSION,
      projectKey,
      threads: entries,
    });
  };
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operationTail.then(operation, operation);
    operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  return Object.freeze({
    list: () => serialize(readEntries),
    add(threadId: string): Promise<void> {
      return serialize(async () => {
        const parsedThreadId = threadIdSchema.parse(threadId);
        const entries = await readEntries();
        if (entries.some((entry) => entry.threadId === parsedThreadId)) return;
        if (entries.length >= MAXIMUM_THREAD_RECORDS) {
          throw new Error("Managed thread cleanup journal is full.");
        }
        await writeEntries([
          ...entries,
          Object.freeze({
            threadId: parsedThreadId,
            createdAt: now().toISOString(),
          }),
        ]);
      });
    },
    remove(threadId: string): Promise<void> {
      return serialize(async () => {
        const parsedThreadId = threadIdSchema.parse(threadId);
        const entries = await readEntries();
        await writeEntries(
          entries.filter((entry) => entry.threadId !== parsedThreadId),
        );
      });
    },
  });
}
