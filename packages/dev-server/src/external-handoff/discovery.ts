import { randomBytes } from "node:crypto";
import { lstat, open, rename, unlink } from "node:fs/promises";
import path from "node:path";

import {
  EXTERNAL_HANDOFF_BROKER_PROTOCOL_VERSION,
  EXTERNAL_HANDOFF_LIMITS,
  type ExternalHandoffFramework,
} from "@spotpatch/shared";
import {
  computeExternalHandoffProjectKey,
  externalHandoffDescriptorSchema,
  resolveExternalHandoffRuntimeDirectory,
  type ExternalHandoffDescriptor,
} from "@spotpatch/shared/external-agent-node";

export interface PublishedExternalHandoffDescriptor {
  readonly close: () => Promise<void>;
  readonly descriptor: ExternalHandoffDescriptor;
}

export interface PublishExternalHandoffDescriptorOptions {
  readonly bridgeToken: string;
  readonly endpoint: string;
  readonly framework: ExternalHandoffFramework;
  readonly root: string;
  readonly sessionId: string;
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");

  try {
    await handle.sync();
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code !== "EINVAL" && code !== "ENOTSUP") {
      throw error;
    }
  } finally {
    await handle.close();
  }
}

export async function publishExternalHandoffDescriptor(
  options: PublishExternalHandoffDescriptorOptions,
): Promise<PublishedExternalHandoffDescriptor> {
  const directory = await resolveExternalHandoffRuntimeDirectory(true);
  const descriptor = externalHandoffDescriptorSchema.parse({
    schemaVersion: 1,
    brokerProtocolVersion: EXTERNAL_HANDOFF_BROKER_PROTOCOL_VERSION,
    projectKey: await computeExternalHandoffProjectKey(options.root),
    sessionId: options.sessionId,
    framework: options.framework,
    endpoint: options.endpoint,
    bridgeToken: options.bridgeToken,
    pid: process.pid,
    createdAt: new Date().toISOString(),
  });
  const serialized = JSON.stringify(descriptor);

  if (
    Buffer.byteLength(serialized, "utf8") >
    EXTERNAL_HANDOFF_LIMITS.maximumDescriptorBytes
  ) {
    throw new RangeError("SpotPatch external Agent descriptor exceeds its limit.");
  }

  const destination = path.join(directory, `${descriptor.sessionId}.json`);
  const temporary = path.join(
    directory,
    `.${descriptor.sessionId}.${randomBytes(8).toString("hex")}.tmp`,
  );
  let temporaryExists = false;
  let published = false;
  let descriptorIdentity: Readonly<{ device: number; inode: number }> = Object.freeze({
    device: -1,
    inode: -1,
  });

  try {
    const handle = await open(temporary, "wx", 0o600);
    temporaryExists = true;

    try {
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    await rename(temporary, destination);
    temporaryExists = false;
    published = true;
    const status = await lstat(destination);
    const uid = process.getuid?.();

    if (
      !status.isFile() ||
      status.isSymbolicLink() ||
      uid === undefined ||
      status.uid !== uid ||
      (status.mode & 0o077) !== 0
    ) {
      throw new Error("SpotPatch external Agent descriptor is not private.");
    }

    descriptorIdentity = Object.freeze({ device: status.dev, inode: status.ino });

    await syncDirectory(directory);
  } catch (error: unknown) {
    if (temporaryExists) {
      await unlink(temporary).catch(() => undefined);
    }

    if (published) {
      await unlink(destination).catch(() => undefined);
    }

    throw error;
  }

  let closed = false;
  return Object.freeze({
    descriptor,
    async close() {
      if (closed) return;
      closed = true;
      await lstat(destination)
        .then(async (status) => {
          if (
            status.dev === descriptorIdentity.device &&
            status.ino === descriptorIdentity.inode
          ) {
            await unlink(destination);
          }
        })
        .catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
        });
      await syncDirectory(directory);
    },
  });
}
