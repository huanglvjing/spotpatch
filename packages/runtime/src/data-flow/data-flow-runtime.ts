import {
  DATA_FLOW_SCHEMA_VERSION,
  DATA_FLOW_URL_QUERY_KEY_LIMIT,
  SPOTPATCH_API_BASE,
  type NetworkObservation,
  type RuntimeDataFlowConfig,
  type RuntimeDataFlowLimits,
  type SanitizedObservedUrl,
} from "@spotpatch/shared/data-flow-runtime";

export interface DataFlowComponentRegistration {
  readonly componentSourceId: string;
  readonly sourceVersion: string;
}

export interface DataFlowInvocationToken {
  readonly invocationId: string;
  readonly componentSourceId: string;
  readonly triggerCallsiteId: string;
  readonly sourceVersion: string;
}

export interface DataFlowRequestFrame {
  readonly requestCallsiteId: string;
  readonly sourceVersion: string;
  readonly invocationToken?: DataFlowInvocationToken;
}

export interface DataFlowTriggerMetadata {
  readonly componentSourceId: string;
  readonly triggerCallsiteId: string;
  readonly sourceVersion: string;
}

export interface DataFlowRequestMetadata {
  readonly requestCallsiteId: string;
  readonly sourceVersion: string;
}

export interface DataFlowRuntime {
  readonly beginInvocation: (
    metadata: DataFlowTriggerMetadata,
  ) => DataFlowInvocationToken;
  readonly bindInvocation: <Arguments extends readonly unknown[], Result>(
    token: DataFlowInvocationToken | undefined,
    callback: (...args: Arguments) => Result,
  ) => (...args: Arguments) => Result;
  readonly bindTrigger: <Callback>(
    metadata: DataFlowTriggerMetadata,
    callback: Callback,
  ) => Callback;
  readonly captureInvocation: () => DataFlowInvocationToken | undefined;
  readonly clear: () => void;
  readonly createTrpcLink: () => DataFlowTrpcLink;
  readonly dispose: () => void;
  readonly getComponentRegistration: (
    component: object,
  ) => DataFlowComponentRegistration | undefined;
  readonly getCurrentRequestFrame: () => DataFlowRequestFrame | undefined;
  readonly observations: () => readonly NetworkObservation[];
  readonly updateRoute: (routeKey: string) => void;
  readonly registerComponent: (
    component: object,
    componentSourceId: string,
    sourceVersion: string,
  ) => void;
  readonly withInvocation: <Result>(
    token: DataFlowInvocationToken | undefined,
    callback: () => Result,
  ) => Result;
  readonly withRequestFrame: <Result>(
    token: DataFlowInvocationToken | undefined,
    metadata: DataFlowRequestMetadata,
    callback: () => Result,
  ) => Result;
}

export interface DataFlowObservationPolicy {
  readonly shouldObserveFetch?: (
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    baseUrl: string,
  ) => boolean;
  readonly shouldObserveXhr?: (url: string, baseUrl: string) => boolean;
}

export interface DataFlowTrpcOperation {
  readonly path: unknown;
  readonly type: unknown;
}

export interface DataFlowTrpcLinkOptions<
  Operation extends DataFlowTrpcOperation,
  Result,
> {
  readonly next: (operation: Operation) => Result;
  readonly op: Operation;
}

export type DataFlowTrpcLink = (
  runtime: unknown,
) => <Operation extends DataFlowTrpcOperation, Result>(
  options: DataFlowTrpcLinkOptions<Operation, Result>,
) => Result;

interface DataFlowGlobal {
  readonly fetch?: typeof globalThis.fetch;
  readonly location?: Location;
  readonly performance?: Performance;
  readonly XMLHttpRequest?: typeof globalThis.XMLHttpRequest;
}

interface MutableDataFlowGlobal extends DataFlowGlobal {
  fetch?: typeof globalThis.fetch;
}

interface XhrMetadata {
  readonly method: string;
  readonly url: string;
}

interface RingEntry {
  readonly bytes: number;
  readonly observation: NetworkObservation;
  readonly recordedAt: number;
}

const RUNTIME_KEY: unique symbol = Symbol.for(
  "spotpatch.data-flow.runtime.v1",
) as never;
const REACT_MEMO_TYPE = Symbol.for("react.memo");
const REACT_FORWARD_REF_TYPE = Symbol.for("react.forward_ref");

type DataFlowRuntimeStore = Partial<Record<symbol, DataFlowRuntime>>;
type GlobalWithDataFlow = MutableDataFlowGlobal & DataFlowRuntimeStore;

function positiveNow(target: DataFlowGlobal): number {
  return target.performance?.now() ?? Date.now();
}

function createOpaqueSequence(prefix: string): () => string {
  let sequence = 0;
  const randomPrefix = (() => {
    try {
      const bytes = new Uint8Array(8);
      globalThis.crypto.getRandomValues(bytes);
      return Array.from(bytes, (value) => value.toString(36).padStart(2, "0")).join("");
    } catch {
      return "local";
    }
  })();

  return () => {
    sequence += 1;
    return `${prefix}_${randomPrefix}_${sequence.toString(36)}`;
  };
}

function freezeUrl(value: string, baseUrl: string): SanitizedObservedUrl {
  try {
    const url = new URL(value, baseUrl);
    return Object.freeze({
      origin: url.origin,
      pathname: url.pathname,
      queryKeys: Object.freeze(
        [...new Set(url.searchParams.keys())]
          .sort()
          .slice(0, DATA_FLOW_URL_QUERY_KEY_LIMIT),
      ),
    });
  } catch {
    return Object.freeze({
      pathname: value.split(/[?#]/u, 1)[0] ?? "{invalid}",
      queryKeys: Object.freeze([]),
    });
  }
}

function readFetchUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function readFetchMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method !== undefined) return init.method.toUpperCase();
  return typeof Request !== "undefined" && input instanceof Request
    ? input.method.toUpperCase()
    : "GET";
}

function isSpotPatchInternalUrl(value: string, baseUrl: string): boolean {
  try {
    const pathname = new URL(value, baseUrl).pathname;
    return (
      pathname === SPOTPATCH_API_BASE || pathname.startsWith(`${SPOTPATCH_API_BASE}/`)
    );
  } catch {
    return false;
  }
}

function approximateBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function createRingStore(
  limits: RuntimeDataFlowLimits,
  target: DataFlowGlobal,
): Readonly<{
  add: (observation: NetworkObservation) => void;
  clear: () => void;
  values: () => readonly NetworkObservation[];
}> {
  const entries: RingEntry[] = [];
  let totalBytes = 0;

  function removeExpired(now: number): void {
    while (
      entries[0] !== undefined &&
      now - entries[0].recordedAt > limits.observationTtlMs
    ) {
      const removed = entries.shift();
      if (removed !== undefined) totalBytes -= removed.bytes;
    }
  }

  return Object.freeze({
    add(observation): void {
      const now = positiveNow(target);
      removeExpired(now);
      const bytes = approximateBytes(observation);
      if (bytes > limits.observationMaxBytes) return;
      entries.push(Object.freeze({ bytes, observation, recordedAt: now }));
      totalBytes += bytes;

      while (
        entries.length > limits.observationMaxEntries ||
        totalBytes > limits.observationMaxBytes
      ) {
        const removed = entries.shift();
        if (removed !== undefined) totalBytes -= removed.bytes;
      }
    },
    clear(): void {
      entries.length = 0;
      totalBytes = 0;
    },
    values(): readonly NetworkObservation[] {
      removeExpired(positiveNow(target));
      return Object.freeze(entries.map(({ observation }) => observation));
    },
  });
}

function ownPropertyDescriptor(
  target: object,
  key: PropertyKey,
): PropertyDescriptor | undefined {
  try {
    return Object.getOwnPropertyDescriptor(target, key);
  } catch {
    return undefined;
  }
}

function nestedReactWrapperComponent(candidate: object): object | undefined {
  const marker: unknown = ownPropertyDescriptor(candidate, "$$typeof")?.value;
  const key =
    marker === REACT_MEMO_TYPE
      ? "type"
      : marker === REACT_FORWARD_REF_TYPE
        ? "render"
        : undefined;
  if (key === undefined) return undefined;
  const nested: unknown = ownPropertyDescriptor(candidate, key)?.value;
  return (typeof nested === "object" && nested !== null) || typeof nested === "function"
    ? nested
    : undefined;
}

function installWritableDataProperty(
  target: object,
  key: PropertyKey,
  replacement: object,
  original: PropertyDescriptor | undefined = ownPropertyDescriptor(target, key),
): (() => void) | undefined {
  if (original === undefined || !("value" in original) || !original.writable) {
    return undefined;
  }

  try {
    Object.defineProperty(target, key, { ...original, value: replacement });
  } catch {
    return undefined;
  }

  return (): void => {
    try {
      if (ownPropertyDescriptor(target, key)?.value === replacement) {
        Object.defineProperty(target, key, original);
      }
    } catch {
      // A host or later wrapper can make the property non-configurable.
    }
  };
}

function recordWithoutAffectingHost(record: () => void): void {
  try {
    record();
  } catch {
    // Observation is optional; the host transport result is authoritative.
  }
}

export function createDataFlowRuntime(
  config: RuntimeDataFlowConfig,
  target: MutableDataFlowGlobal = globalThis,
  policy: DataFlowObservationPolicy = {},
): DataFlowRuntime {
  const componentRegistry = new WeakMap<object, DataFlowComponentRegistration>();
  const xhrMetadata = new WeakMap<object, XhrMetadata>();
  const store = createRingStore(config.limits, target);
  const nextInvocationId = createOpaqueSequence("invocation");
  const nextObservationId = createOpaqueSequence("observation");
  const pageEpoch = createOpaqueSequence("page")();
  const nextRouteEpoch = createOpaqueSequence("route");
  let routeEpoch = nextRouteEpoch();
  let routeKey: string | undefined;
  let currentInvocation: DataFlowInvocationToken | undefined;
  let currentRequestFrame: DataFlowRequestFrame | undefined;
  let disposed = false;

  const originalFetch = (() => {
    try {
      return target.fetch;
    } catch {
      return undefined;
    }
  })();
  function spotPatchFetch(
    this: typeof globalThis,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    if (originalFetch === undefined) {
      throw new TypeError("Fetch is unavailable.");
    }
    const result = Reflect.apply(originalFetch, this, [input, init]);
    recordWithoutAffectingHost(() => {
      const frame = currentRequestFrame;
      const token = frame?.invocationToken;
      const rawUrl = readFetchUrl(input);
      if (
        isSpotPatchInternalUrl(
          rawUrl,
          target.location?.href ?? "http://spotpatch.invalid/",
        ) ||
        policy.shouldObserveFetch?.(
          input,
          init,
          target.location?.href ?? "http://spotpatch.invalid/",
        ) === false
      ) {
        return;
      }
      store.add(
        Object.freeze({
          schemaVersion: DATA_FLOW_SCHEMA_VERSION,
          id: nextObservationId(),
          pageEpoch,
          routeEpoch,
          ...(frame === undefined
            ? {}
            : {
                requestCallsiteId: frame.requestCallsiteId,
                sourceVersion: frame.sourceVersion,
              }),
          ...(token === undefined
            ? {}
            : {
                invocationId: token.invocationId,
                componentSourceId: token.componentSourceId,
                triggerCallsiteId: token.triggerCallsiteId,
              }),
          transport: "fetch",
          method: readFetchMethod(input, init),
          url: freezeUrl(rawUrl, target.location?.href ?? "http://spotpatch.invalid/"),
          outcome: "dispatched",
          freshness: "current",
          diagnosticIds: Object.freeze([]),
        }),
      );
    });
    return result;
  }

  const restoreFetch =
    originalFetch === undefined
      ? undefined
      : installWritableDataProperty(target, "fetch", spotPatchFetch);

  const xhrPrototype = (() => {
    try {
      return target.XMLHttpRequest?.prototype;
    } catch {
      return undefined;
    }
  })();
  const originalOpenDescriptor =
    xhrPrototype === undefined
      ? undefined
      : ownPropertyDescriptor(xhrPrototype, "open");
  const originalSendDescriptor =
    xhrPrototype === undefined
      ? undefined
      : ownPropertyDescriptor(xhrPrototype, "send");

  function spotPatchOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: readonly unknown[]
  ): void {
    const original: unknown = originalOpenDescriptor?.value;
    if (typeof original === "function") {
      Reflect.apply(original, this, [method, url, ...rest]);
    }
    recordWithoutAffectingHost(() => {
      xhrMetadata.set(this, Object.freeze({ method, url: String(url) }));
    });
  }

  function spotPatchSend(
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ): void {
    const original: unknown = originalSendDescriptor?.value;
    if (typeof original === "function") Reflect.apply(original, this, [body]);
    recordWithoutAffectingHost(() => {
      const metadata = xhrMetadata.get(this);
      if (
        metadata === undefined ||
        isSpotPatchInternalUrl(
          metadata.url,
          target.location?.href ?? "http://spotpatch.invalid/",
        ) ||
        policy.shouldObserveXhr?.(
          metadata.url,
          target.location?.href ?? "http://spotpatch.invalid/",
        ) === false
      ) {
        return;
      }
      const frame = currentRequestFrame;
      const token = frame?.invocationToken;
      store.add(
        Object.freeze({
          schemaVersion: DATA_FLOW_SCHEMA_VERSION,
          id: nextObservationId(),
          pageEpoch,
          routeEpoch,
          ...(frame === undefined
            ? {}
            : {
                requestCallsiteId: frame.requestCallsiteId,
                sourceVersion: frame.sourceVersion,
              }),
          ...(token === undefined
            ? {}
            : {
                invocationId: token.invocationId,
                componentSourceId: token.componentSourceId,
                triggerCallsiteId: token.triggerCallsiteId,
              }),
          transport: "xhr",
          method: metadata.method.toUpperCase(),
          url: freezeUrl(
            metadata.url,
            target.location?.href ?? "http://spotpatch.invalid/",
          ),
          outcome: "dispatched",
          freshness: "current",
          diagnosticIds: Object.freeze([]),
        }),
      );
    });
  }

  const restoreXhrOpen =
    xhrPrototype === undefined || typeof originalOpenDescriptor?.value !== "function"
      ? undefined
      : installWritableDataProperty(
          xhrPrototype,
          "open",
          spotPatchOpen,
          originalOpenDescriptor,
        );
  const restoreXhrSend =
    xhrPrototype === undefined || typeof originalSendDescriptor?.value !== "function"
      ? undefined
      : installWritableDataProperty(
          xhrPrototype,
          "send",
          spotPatchSend,
          originalSendDescriptor,
        );

  const runtime: DataFlowRuntime = Object.freeze({
    beginInvocation(metadata: DataFlowTriggerMetadata): DataFlowInvocationToken {
      return Object.freeze({
        invocationId: nextInvocationId(),
        componentSourceId: metadata.componentSourceId,
        triggerCallsiteId: metadata.triggerCallsiteId,
        sourceVersion: metadata.sourceVersion,
      });
    },
    bindInvocation<Arguments extends readonly unknown[], Result>(
      token: DataFlowInvocationToken | undefined,
      callback: (...args: Arguments) => Result,
    ): (...args: Arguments) => Result {
      return function boundInvocation(this: unknown, ...args: Arguments): Result {
        return runtime.withInvocation(token, () => Reflect.apply(callback, this, args));
      };
    },
    bindTrigger<Callback>(
      metadata: DataFlowTriggerMetadata,
      callback: Callback,
    ): Callback {
      if (typeof callback !== "function") return callback;
      const callable = callback as (...args: readonly unknown[]) => unknown;
      return function boundTrigger(this: unknown, ...args: readonly unknown[]) {
        const token = runtime.beginInvocation(metadata);
        return runtime.withInvocation(token, () => Reflect.apply(callable, this, args));
      } as Callback;
    },
    captureInvocation: () => currentInvocation,
    clear: store.clear,
    createTrpcLink(): DataFlowTrpcLink {
      return () =>
        <Operation extends DataFlowTrpcOperation, Result>(
          options: DataFlowTrpcLinkOptions<Operation, Result>,
        ): Result => {
          recordWithoutAffectingHost(() => {
            const operation = options.op.path;
            const operationType = options.op.type;
            if (
              typeof operation !== "string" ||
              operation.length === 0 ||
              operation.length > 512 ||
              (operationType !== "query" &&
                operationType !== "mutation" &&
                operationType !== "subscription")
            ) {
              return;
            }
            const frame = currentRequestFrame;
            const token = frame?.invocationToken;
            store.add(
              Object.freeze({
                schemaVersion: DATA_FLOW_SCHEMA_VERSION,
                id: nextObservationId(),
                pageEpoch,
                routeEpoch,
                ...(frame === undefined
                  ? {}
                  : {
                      requestCallsiteId: frame.requestCallsiteId,
                      sourceVersion: frame.sourceVersion,
                    }),
                ...(token === undefined
                  ? {}
                  : {
                      invocationId: token.invocationId,
                      componentSourceId: token.componentSourceId,
                      triggerCallsiteId: token.triggerCallsiteId,
                    }),
                transport: "trpc",
                method: operationType.toUpperCase(),
                operation,
                url: Object.freeze({
                  pathname: operation,
                  queryKeys: Object.freeze([]),
                }),
                outcome: "dispatched",
                freshness: "current",
                diagnosticIds: Object.freeze([]),
              }),
            );
          });
          return options.next(options.op);
        };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      store.clear();
      restoreFetch?.();
      restoreXhrOpen?.();
      restoreXhrSend?.();
    },
    getComponentRegistration: (component: object) => componentRegistry.get(component),
    getCurrentRequestFrame: () => currentRequestFrame,
    observations: () =>
      Object.freeze(
        store
          .values()
          .map((observation) =>
            observation.routeEpoch === routeEpoch
              ? observation
              : Object.freeze({ ...observation, freshness: "stale-route" as const }),
          ),
      ),
    registerComponent(
      component: object,
      componentSourceId: string,
      registeredSourceVersion: string,
    ): void {
      const registration = Object.freeze({
        componentSourceId,
        sourceVersion: registeredSourceVersion,
      });
      const pending = [component];
      const registered = new Set<object>();
      while (pending.length > 0) {
        const candidate = pending.pop();
        if (candidate === undefined || registered.has(candidate)) continue;
        registered.add(candidate);
        componentRegistry.set(candidate, registration);

        const nested = nestedReactWrapperComponent(candidate);
        if (nested !== undefined) pending.push(nested);
      }
    },
    updateRoute(nextRouteKey: string): void {
      if (routeKey === undefined) {
        routeKey = nextRouteKey;
      } else if (routeKey !== nextRouteKey) {
        routeKey = nextRouteKey;
        routeEpoch = nextRouteEpoch();
      }
    },
    withInvocation<Result>(
      token: DataFlowInvocationToken | undefined,
      callback: () => Result,
    ): Result {
      const parent = currentInvocation;
      currentInvocation = token;
      try {
        return callback();
      } finally {
        currentInvocation = parent;
      }
    },
    withRequestFrame<Result>(
      token: DataFlowInvocationToken | undefined,
      metadata: DataFlowRequestMetadata,
      callback: () => Result,
    ): Result {
      const parent = currentRequestFrame;
      currentRequestFrame = Object.freeze({
        requestCallsiteId: metadata.requestCallsiteId,
        sourceVersion: metadata.sourceVersion,
        ...(token === undefined ? {} : { invocationToken: token }),
      });
      try {
        return callback();
      } finally {
        currentRequestFrame = parent;
      }
    },
  });

  return runtime;
}

export function installDataFlowPrelude(
  config: RuntimeDataFlowConfig,
  target: GlobalWithDataFlow = globalThis,
  policy: DataFlowObservationPolicy = {},
): DataFlowRuntime | undefined {
  if (!config.enabled) return undefined;
  const runtime = target[RUNTIME_KEY] ?? createDataFlowRuntime(config, target, policy);
  target[RUNTIME_KEY] = runtime;
  return runtime;
}

export function getDataFlowRuntime(
  target: GlobalWithDataFlow = globalThis,
): DataFlowRuntime | undefined {
  return target[RUNTIME_KEY];
}
