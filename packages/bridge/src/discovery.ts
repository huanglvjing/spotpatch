import { constants } from "node:fs";
import { open, opendir, realpath, unlink } from "node:fs/promises";
import path from "node:path";

import {
  ERROR_CODES,
  EXTERNAL_HANDOFF_LIMITS,
  SpotPatchError,
} from "@spotpatch/shared";
import {
  computeExternalHandoffProjectKey,
  assertPrivateExternalHandoffPath,
  externalHandoffDescriptorSchema,
  resolveExternalHandoffRuntimeDirectory,
  type ExternalHandoffDescriptor,
} from "@spotpatch/shared/external-agent-node";

export interface SecureExternalHandoffDescriptor {
  readonly descriptor: ExternalHandoffDescriptor;
  readonly device: number;
  readonly inode: number;
  readonly path: string;
}

async function projectKeys(cwd: string): Promise<ReadonlySet<string>> {
  const keys = new Set<string>();
  let current = await realpath(cwd);

  for (
    let depth = 0;
    depth < EXTERNAL_HANDOFF_LIMITS.maximumProjectAncestors;
    depth += 1
  ) {
    keys.add(await computeExternalHandoffProjectKey(current));
    const parent = path.dirname(current);
    if (parent === current) return keys;
    current = parent;
  }

  throw new SpotPatchError(ERROR_CODES.BRIDGE_UNAUTHORIZED);
}

async function readSecureDescriptor(
  descriptorPath: string,
): Promise<SecureExternalHandoffDescriptor> {
  const pathStatus = await assertPrivateExternalHandoffPath(descriptorPath, "file");
  const handle = await open(descriptorPath, constants.O_RDONLY | constants.O_NOFOLLOW);

  try {
    const status = await handle.stat();

    if (
      !status.isFile() ||
      status.dev !== pathStatus.dev ||
      status.ino !== pathStatus.ino ||
      status.size <= 0 ||
      status.size > EXTERNAL_HANDOFF_LIMITS.maximumDescriptorBytes
    ) {
      throw new SpotPatchError(ERROR_CODES.BRIDGE_UNAUTHORIZED);
    }

    const descriptor = externalHandoffDescriptorSchema.safeParse(
      JSON.parse(await handle.readFile("utf8")) as unknown,
    );

    if (!descriptor.success) {
      throw new SpotPatchError(ERROR_CODES.BRIDGE_UNAUTHORIZED);
    }

    if (path.basename(descriptorPath) !== `${descriptor.data.sessionId}.json`) {
      throw new SpotPatchError(ERROR_CODES.BRIDGE_UNAUTHORIZED);
    }

    return Object.freeze({
      descriptor: descriptor.data,
      device: status.dev,
      inode: status.ino,
      path: descriptorPath,
    });
  } catch (error: unknown) {
    if (error instanceof SpotPatchError) throw error;
    throw new SpotPatchError(ERROR_CODES.BRIDGE_UNAUTHORIZED, undefined, {
      cause: error,
    });
  } finally {
    await handle.close();
  }
}

export async function removeStaleProjectDescriptor(
  candidate: SecureExternalHandoffDescriptor,
): Promise<void> {
  try {
    const status = await assertPrivateExternalHandoffPath(candidate.path, "file");

    if (status.dev !== candidate.device || status.ino !== candidate.inode) {
      throw new SpotPatchError(ERROR_CODES.BRIDGE_UNAUTHORIZED);
    }

    await unlink(candidate.path);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    if (error instanceof SpotPatchError) throw error;
    throw new SpotPatchError(ERROR_CODES.BRIDGE_UNAUTHORIZED, undefined, {
      cause: error,
    });
  }
}

export async function discoverProjectDescriptors(
  cwd = process.cwd(),
): Promise<readonly SecureExternalHandoffDescriptor[]> {
  const directory = await resolveExternalHandoffRuntimeDirectory(false);
  const keys = await projectKeys(cwd);
  const matched: SecureExternalHandoffDescriptor[] = [];
  const entries = await opendir(directory);

  try {
    for await (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name.endsWith(".tmp")) continue;

      if (!entry.isFile() || !/^[A-Za-z0-9_-]{22,128}\.json$/u.test(entry.name)) {
        throw new SpotPatchError(ERROR_CODES.BRIDGE_UNAUTHORIZED);
      }

      const candidate = await readSecureDescriptor(path.join(directory, entry.name));
      if (!keys.has(candidate.descriptor.projectKey)) continue;

      matched.push(candidate);
      if (matched.length > EXTERNAL_HANDOFF_LIMITS.maximumDescriptorsPerScan) {
        throw new SpotPatchError(ERROR_CODES.BRIDGE_BUSY);
      }
    }
  } finally {
    await entries.close().catch(() => undefined);
  }

  if (matched.length === 0) {
    throw new SpotPatchError(ERROR_CODES.SESSION_NOT_FOUND);
  }

  return Object.freeze(
    matched.sort((left, right) => left.path.localeCompare(right.path)),
  );
}

export async function resolveExactProjectSessionId(
  cwd: string,
  sessionId?: string,
): Promise<string> {
  const exactProjectKey = await computeExternalHandoffProjectKey(cwd);
  const exact = (await discoverProjectDescriptors(cwd)).filter(
    ({ descriptor }) => descriptor.projectKey === exactProjectKey,
  );

  if (sessionId !== undefined) {
    const selected = exact.find(({ descriptor }) => descriptor.sessionId === sessionId);
    if (selected === undefined) {
      throw new SpotPatchError(ERROR_CODES.SESSION_NOT_FOUND);
    }
    return selected.descriptor.sessionId;
  }

  const selected = exact[0];
  if (selected === undefined) {
    throw new SpotPatchError(ERROR_CODES.SESSION_NOT_FOUND);
  }
  if (exact.length > 1) throw new SpotPatchError(ERROR_CODES.SESSION_AMBIGUOUS);
  return selected.descriptor.sessionId;
}
