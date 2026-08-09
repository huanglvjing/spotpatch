import path from "node:path";

import { createRandomSourceId, type SourceIdFactory } from "./source-id.js";

export interface SourceRegistry {
  register(absolutePath: string): string;
  resolve(fileId: string): string | undefined;
  clear(): void;
}

interface SourceRegistryOptions {
  readonly createId?: SourceIdFactory;
}

function normalizeAbsolutePath(absolutePath: string): string {
  return path.normalize(path.resolve(absolutePath));
}

export function createSourceRegistry(
  options: SourceRegistryOptions = {},
): SourceRegistry {
  const createId = options.createId ?? createRandomSourceId;
  const pathToId = new Map<string, string>();
  const idToPath = new Map<string, string>();

  return Object.freeze({
    register(absolutePath: string): string {
      const normalizedPath = normalizeAbsolutePath(absolutePath);
      const existingId = pathToId.get(normalizedPath);

      if (existingId !== undefined) {
        return existingId;
      }

      let fileId = createId();

      while (idToPath.has(fileId)) {
        fileId = createId();
      }

      pathToId.set(normalizedPath, fileId);
      idToPath.set(fileId, normalizedPath);
      return fileId;
    },

    resolve(fileId: string): string | undefined {
      return idToPath.get(fileId);
    },

    clear(): void {
      pathToId.clear();
      idToPath.clear();
    },
  });
}
