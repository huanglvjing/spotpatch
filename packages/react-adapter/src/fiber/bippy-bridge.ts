import {
  _renderers,
  getDisplayName,
  getFiberFromHostInstance,
  getFiberStack,
  isCompositeFiber,
  type Fiber,
} from "bippy";

import type { FiberBridge, FiberMatch, FiberSourceLocation } from "./fiber-bridge.js";

function asFiber(node: unknown): Fiber | undefined {
  return typeof node === "object" && node !== null ? (node as Fiber) : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function readDebugSource(fiber: Fiber): FiberSourceLocation | undefined {
  const source: unknown = fiber._debugSource;

  if (
    typeof source !== "object" ||
    source === null ||
    !("fileName" in source) ||
    typeof source.fileName !== "string"
  ) {
    return undefined;
  }

  const line = "lineNumber" in source ? positiveInteger(source.lineNumber) : undefined;
  const column =
    "columnNumber" in source ? positiveInteger(source.columnNumber) : undefined;

  return Object.freeze({
    fileName: source.fileName,
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
  });
}

function findRendererFiber(element: Element): FiberMatch | undefined {
  for (const renderer of _renderers) {
    try {
      const fiber = renderer.findFiberByHostInstance?.(element);

      if (fiber !== null && fiber !== undefined) {
        return Object.freeze({
          node: fiber,
          version: renderer.reconcilerVersion,
        });
      }
    } catch {
      // A different renderer may own the host instance.
    }
  }

  const fallback = getFiberFromHostInstance(element);
  return fallback === null ? undefined : Object.freeze({ node: fallback });
}

export function createBippyBridge(): FiberBridge {
  return Object.freeze({
    find: findRendererFiber,

    getAncestors(node: unknown): readonly unknown[] {
      const fiber = asFiber(node);
      return fiber === undefined ? [] : getFiberStack(fiber);
    },

    isComposite(node: unknown): boolean {
      const fiber = asFiber(node);
      return fiber !== undefined && isCompositeFiber(fiber);
    },

    getDisplayName(node: unknown): string | undefined {
      const fiber = asFiber(node);
      return fiber === undefined
        ? undefined
        : (getDisplayName(fiber.type) ?? undefined);
    },

    getSource(node: unknown): FiberSourceLocation | undefined {
      const fiber = asFiber(node);
      return fiber === undefined ? undefined : readDebugSource(fiber);
    },
  });
}
