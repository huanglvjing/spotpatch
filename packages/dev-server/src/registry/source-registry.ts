import path from "node:path";

import { createRandomSourceId, type SourceIdFactory } from "./source-id.js";

export interface SourceRegistry {
  register(absolutePath: string): string;
  registerDataFlowComponents(
    absolutePath: string,
    sourceVersion: string,
    components: readonly DataFlowComponentAnchorInput[],
  ): void;
  resolve(fileId: string): string | undefined;
  resolveDataFlowComponent(
    componentSourceId: string,
  ): DataFlowComponentAnchor | undefined;
  clear(): void;
}

export interface DataFlowComponentAnchorInput {
  readonly componentSourceId: string;
  readonly line: number;
  readonly column: number;
}

export interface DataFlowComponentAnchor extends DataFlowComponentAnchorInput {
  readonly fileId: string;
  readonly sourceVersion: string;
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
  const componentAnchors = new Map<string, DataFlowComponentAnchor>();
  const componentIdsByPath = new Map<string, Set<string>>();

  function registerSourcePath(absolutePath: string): string {
    const normalizedPath = normalizeAbsolutePath(absolutePath);
    const existingId = pathToId.get(normalizedPath);

    if (existingId !== undefined) {
      return existingId;
    }

    let fileId = createId();
    while (idToPath.has(fileId)) fileId = createId();
    pathToId.set(normalizedPath, fileId);
    idToPath.set(fileId, normalizedPath);
    return fileId;
  }

  return Object.freeze({
    register(absolutePath: string): string {
      return registerSourcePath(absolutePath);
    },

    registerDataFlowComponents(
      absolutePath: string,
      sourceVersion: string,
      components: readonly DataFlowComponentAnchorInput[],
    ): void {
      const normalizedPath = normalizeAbsolutePath(absolutePath);
      const previousIds = componentIdsByPath.get(normalizedPath);
      for (const componentSourceId of previousIds ?? []) {
        componentAnchors.delete(componentSourceId);
      }

      const fileId = registerSourcePath(normalizedPath);
      const currentIds = new Set<string>();
      for (const component of components) {
        currentIds.add(component.componentSourceId);
        componentAnchors.set(
          component.componentSourceId,
          Object.freeze({ ...component, fileId, sourceVersion }),
        );
      }
      componentIdsByPath.set(normalizedPath, currentIds);
    },

    resolve(fileId: string): string | undefined {
      return idToPath.get(fileId);
    },

    resolveDataFlowComponent(
      componentSourceId: string,
    ): DataFlowComponentAnchor | undefined {
      return componentAnchors.get(componentSourceId);
    },

    clear(): void {
      pathToId.clear();
      idToPath.clear();
      componentAnchors.clear();
      componentIdsByPath.clear();
    },
  });
}
