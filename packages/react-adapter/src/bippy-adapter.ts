import type { ReactContext, SourceRef } from "@spotpatch/shared";

import { createBippyBridge } from "./fiber/bippy-bridge.js";
import type { FiberBridge, FiberSourceLocation } from "./fiber/fiber-bridge.js";
import type { ReactAdapter } from "./react-adapter.js";
import {
  isThirdPartySource,
  toSafeRelativeSourcePath,
} from "./source/safe-source-path.js";

const SUPPORTED_REACT_VERSION = /^18\.(?:2|3)\./;
const NOISE_COMPONENT_NAMES = new Set([
  "Fragment",
  "StrictMode",
  "Suspense",
  "Context.Consumer",
  "Context.Provider",
]);

interface ComponentEntry {
  readonly name: string;
  readonly source?: FiberSourceLocation;
  readonly registration?: ComponentRegistration;
}

export interface ComponentRegistration {
  readonly componentSourceId: string;
  readonly sourceVersion: string;
}

interface CollectedComponents {
  readonly businessComponent?: ComponentEntry;
  readonly firstComponent?: ComponentEntry;
  readonly stack: readonly string[];
}

export interface CreateReact18AdapterOptions {
  readonly bridge?: FiberBridge;
  readonly getComponentRegistration?: (
    component: object,
  ) => ComponentRegistration | undefined;
  readonly maxComponentDepth: number;
}

function isSupportedVersion(version: string | undefined): version is string {
  return version !== undefined && SUPPORTED_REACT_VERSION.test(version);
}

function isNoiseName(name: string): boolean {
  return (
    NOISE_COMPONENT_NAMES.has(name) ||
    name.endsWith(".Provider") ||
    name.endsWith(".Consumer")
  );
}

function collectComponents(
  bridge: FiberBridge,
  node: unknown,
  maxDepth: number,
  getComponentRegistration?: CreateReact18AdapterOptions["getComponentRegistration"],
): CollectedComponents {
  const stack: string[] = [];
  let firstComponent: ComponentEntry | undefined;
  let registeredComponent: ComponentEntry | undefined;
  let sourceComponent: ComponentEntry | undefined;

  for (const ancestor of bridge.getAncestors(node)) {
    if (!bridge.isComposite(ancestor)) {
      continue;
    }

    const name = bridge.getDisplayName(ancestor);

    if (name === undefined || name.length === 0 || isNoiseName(name)) {
      continue;
    }

    const source = bridge.getSource(ancestor);
    const componentType = bridge.getComponentType?.(ancestor);
    const registration =
      componentType === undefined
        ? undefined
        : getComponentRegistration?.(componentType);
    const component = Object.freeze({
      name,
      ...(source === undefined ? {} : { source }),
      ...(registration === undefined ? {} : { registration }),
    });
    firstComponent ??= component;

    if (stack.length < maxDepth) {
      stack.push(name);
    }

    if (registration !== undefined && registeredComponent === undefined) {
      registeredComponent = component;
    }
    if (
      sourceComponent === undefined &&
      source !== undefined &&
      !isThirdPartySource(source.fileName) &&
      toSafeRelativeSourcePath(source.fileName) !== undefined
    ) {
      sourceComponent = component;
    }

    if (registeredComponent !== undefined && stack.length >= maxDepth) {
      break;
    }
  }

  const businessComponent = registeredComponent ?? sourceComponent;

  return Object.freeze({
    ...(businessComponent === undefined ? {} : { businessComponent }),
    ...(firstComponent === undefined ? {} : { firstComponent }),
    stack: Object.freeze(stack),
  });
}

function toProbableSource(
  source: FiberSourceLocation | undefined,
): SourceRef | undefined {
  if (source === undefined) {
    return undefined;
  }

  const relativePath = toSafeRelativeSourcePath(source.fileName);

  if (relativePath === undefined) {
    return undefined;
  }

  return Object.freeze({
    relativePath,
    ...(source.line === undefined ? {} : { line: source.line }),
    ...(source.column === undefined ? {} : { column: source.column }),
    origin: "react-fiber",
    confidence: "probable",
  });
}

export function createReact18Adapter(
  options: CreateReact18AdapterOptions,
): ReactAdapter {
  if (
    !Number.isSafeInteger(options.maxComponentDepth) ||
    options.maxComponentDepth <= 0
  ) {
    throw new RangeError("React component depth must be a positive integer.");
  }

  const bridge = options.bridge ?? createBippyBridge();
  let disposed = false;

  function inspect(element: Element): ReactContext {
    if (disposed) {
      return Object.freeze({ supported: false, componentStack: [] });
    }

    const match = bridge.find(element);

    if (match === undefined || !isSupportedVersion(match.version)) {
      return Object.freeze({
        supported: false,
        ...(match?.version === undefined ? {} : { version: match.version }),
        componentStack: [],
      });
    }

    const components = collectComponents(
      bridge,
      match.node,
      options.maxComponentDepth,
      options.getComponentRegistration,
    );
    const componentName =
      components.businessComponent?.name ?? components.firstComponent?.name;
    const source = toProbableSource(components.businessComponent?.source);
    const registration = components.businessComponent?.registration;

    return Object.freeze({
      supported: true,
      version: match.version,
      ...(componentName === undefined ? {} : { componentName }),
      ...(registration ?? {}),
      componentStack: components.stack,
      ...(source === undefined ? {} : { source }),
    });
  }

  return Object.freeze({
    name: "bippy-react-18",

    supports(element: Element): boolean {
      if (disposed) {
        return false;
      }

      return isSupportedVersion(bridge.find(element)?.version);
    },

    inspect,

    dispose(): void {
      disposed = true;
    },
  });
}
