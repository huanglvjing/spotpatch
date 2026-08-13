import {
  DATA_FLOW_URL_QUERY_KEY_LIMIT,
  DEFAULT_RUNTIME_DATA_FLOW_LIMITS,
  networkObservationSchema,
  type RuntimeDataFlowConfig,
} from "@spotpatch/shared";
import { describe, expect, it, vi } from "vitest";

import { createDataFlowRuntime } from "./data-flow-runtime.js";

const config = Object.freeze({
  enabled: true,
  runtime: "dispatch",
  limits: DEFAULT_RUNTIME_DATA_FLOW_LIMITS,
}) satisfies RuntimeDataFlowConfig;

function successfulResponse(): Promise<Response> {
  return Promise.resolve(new Response(null, { status: 204 }));
}

describe("data-flow runtime", () => {
  it("records dispatch without changing the original Promise or retaining values", () => {
    const expected = successfulResponse();
    const originalFetch: typeof fetch = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return expected;
      },
    );
    const target = {
      fetch: originalFetch,
      location: { href: "https://example.test/page" } as Location,
      performance: { now: () => 1 } as Performance,
    };
    const runtime = createDataFlowRuntime(config, target);
    const token = runtime.beginInvocation({
      componentSourceId: "component_login",
      triggerCallsiteId: "trigger_submit",
      sourceVersion: "source_login",
    });
    const actual = runtime.withRequestFrame(
      token,
      { requestCallsiteId: "request_login", sourceVersion: "source_login" },
      () =>
        target.fetch("/auth/login?token=secret&session_id=private", {
          method: "POST",
        }),
    );

    expect(actual).toBe(expected);
    expect(originalFetch).toHaveBeenCalledOnce();
    expect(runtime.observations()).toMatchObject([
      {
        componentSourceId: "component_login",
        triggerCallsiteId: "trigger_submit",
        requestCallsiteId: "request_login",
        method: "POST",
        transport: "fetch",
        url: {
          origin: "https://example.test",
          pathname: "/auth/login",
          queryKeys: ["session_id", "token"],
        },
      },
    ]);
    expect(JSON.stringify(runtime.observations())).not.toContain("secret");
    expect(JSON.stringify(runtime.observations())).not.toContain("private");
  });

  it("bounds query-key metadata to the public observation schema", () => {
    const target = {
      fetch: vi.fn<typeof fetch>(() => successfulResponse()),
      location: { href: "https://example.test/page" } as Location,
      performance: { now: () => 1 } as Performance,
    };
    const runtime = createDataFlowRuntime(config, target);
    const query = Array.from(
      { length: DATA_FLOW_URL_QUERY_KEY_LIMIT + 2 },
      (_, index) => `key_${String(index).padStart(3, "0")}=hidden`,
    ).join("&");

    void target.fetch(`/bounded?${query}`);

    const [observation] = runtime.observations();
    expect(observation?.url.queryKeys).toHaveLength(DATA_FLOW_URL_QUERY_KEY_LIMIT);
    expect(networkObservationSchema.safeParse(observation).success).toBe(true);
    expect(JSON.stringify(observation)).not.toContain("hidden");
  });

  it("does not let metadata failures or read-only transports affect fetch", () => {
    const expected = successfulResponse();
    const originalFetch: typeof fetch = vi.fn(() => expected);
    const target = {
      fetch: originalFetch,
      location: { href: "https://example.test/page" } as Location,
      performance: { now: () => 1 } as Performance,
    };
    const runtime = createDataFlowRuntime(config, target);
    const unreadableRequest = new Proxy(
      {},
      {
        get(_object, property) {
          if (property === "url") throw new TypeError("unreadable URL");
          return undefined;
        },
      },
    ) as Request;

    expect(target.fetch(unreadableRequest)).toBe(expected);
    expect(runtime.observations()).toEqual([]);
    runtime.dispose();

    const readOnlyTarget = {
      location: { href: "https://example.test/page" } as Location,
      performance: { now: () => 1 } as Performance,
    } as typeof target;
    Object.defineProperty(readOnlyTarget, "fetch", {
      configurable: false,
      enumerable: true,
      value: originalFetch,
      writable: false,
    });
    const readOnlyRuntime = createDataFlowRuntime(config, readOnlyTarget);

    expect(readOnlyTarget.fetch).toBe(originalFetch);
    expect(() => {
      readOnlyRuntime.dispose();
    }).not.toThrow();
  });

  it("records XHR only after the host send succeeds and restores its methods", () => {
    class FakeXmlHttpRequest {
      readonly calls: string[] = [];
      shouldThrow = false;

      open(method: string, url: string): void {
        this.calls.push(`open:${method}:${url}`);
      }

      send(): void {
        this.calls.push("send");
        if (this.shouldThrow)
          throw new DOMException("invalid state", "InvalidStateError");
      }
    }
    const originalOpen: unknown = Object.getOwnPropertyDescriptor(
      FakeXmlHttpRequest.prototype,
      "open",
    )?.value;
    const originalSend: unknown = Object.getOwnPropertyDescriptor(
      FakeXmlHttpRequest.prototype,
      "send",
    )?.value;
    const target = {
      location: { href: "https://example.test/page" } as Location,
      performance: { now: () => 1 } as Performance,
      XMLHttpRequest: FakeXmlHttpRequest as unknown as typeof globalThis.XMLHttpRequest,
    };
    const runtime = createDataFlowRuntime(config, target);
    const request = new FakeXmlHttpRequest();

    request.open("POST", "/auth/login?token=secret");
    request.send();

    expect(request.calls).toEqual(["open:POST:/auth/login?token=secret", "send"]);
    expect(runtime.observations()).toMatchObject([
      {
        method: "POST",
        transport: "xhr",
        url: { pathname: "/auth/login", queryKeys: ["token"] },
      },
    ]);
    const failingRequest = new FakeXmlHttpRequest();
    failingRequest.open("GET", "/must-not-be-recorded");
    failingRequest.shouldThrow = true;
    expect(() => {
      failingRequest.send();
    }).toThrow(DOMException);
    expect(runtime.observations()).toHaveLength(1);
    runtime.dispose();
    expect(
      Object.getOwnPropertyDescriptor(FakeXmlHttpRequest.prototype, "open")?.value,
    ).toBe(originalOpen);
    expect(
      Object.getOwnPropertyDescriptor(FakeXmlHttpRequest.prototype, "send")?.value,
    ).toBe(originalSend);
  });

  it("keeps concurrent invocation provenance distinct", () => {
    const fetchStub: typeof fetch = vi.fn((input: RequestInfo | URL) => {
      void input;
      return successfulResponse();
    });
    const target = {
      fetch: fetchStub,
      location: { href: "https://example.test/" } as Location,
      performance: { now: () => 1 } as Performance,
    };
    const runtime = createDataFlowRuntime(config, target);

    for (const componentSourceId of ["component_a", "component_b"]) {
      const token = runtime.beginInvocation({
        componentSourceId,
        triggerCallsiteId: `trigger_${componentSourceId}`,
        sourceVersion: "source_shared",
      });
      void runtime.withRequestFrame(
        token,
        { requestCallsiteId: "request_shared", sourceVersion: "source_shared" },
        () => target.fetch("/shared"),
      );
    }

    const observations = runtime.observations();
    expect(new Set(observations.map(({ invocationId }) => invocationId)).size).toBe(2);
    expect(observations.map(({ componentSourceId }) => componentSourceId)).toEqual([
      "component_a",
      "component_b",
    ]);
  });

  it("binds timer callbacks while preserving receiver and arguments", () => {
    const fetchStub: typeof fetch = vi.fn((input: RequestInfo | URL) => {
      void input;
      return successfulResponse();
    });
    const target = {
      fetch: fetchStub,
      location: { href: "https://example.test/" } as Location,
      performance: { now: () => 1 } as Performance,
    };
    const runtime = createDataFlowRuntime(config, target);
    const token = runtime.beginInvocation({
      componentSourceId: "component_poll",
      triggerCallsiteId: "trigger_effect",
      sourceVersion: "source_poll",
    });
    const receiver = { prefix: "value" };
    function callback(this: typeof receiver, suffix: string): string {
      expect(runtime.captureInvocation()).toBe(token);
      return `${this.prefix}-${suffix}`;
    }

    const bound = runtime.bindInvocation(token, callback);

    expect(Reflect.apply(bound, receiver, ["result"])).toBe("value-result");
    expect(runtime.captureInvocation()).toBeUndefined();
  });

  it("creates fresh invocation provenance for every bound trigger call", () => {
    const runtime = createDataFlowRuntime(config, {
      performance: { now: () => 1 } as Performance,
    });
    const receiver = { label: "receiver" };
    function callback(this: typeof receiver): Readonly<{
      invocationId: string | undefined;
      receiver: string;
    }> {
      return Object.freeze({
        invocationId: runtime.captureInvocation()?.invocationId,
        receiver: this.label,
      });
    }
    const bound = runtime.bindTrigger(
      {
        componentSourceId: "component_shared",
        triggerCallsiteId: "trigger_shared",
        sourceVersion: "source_shared",
      },
      callback,
    );

    const first = Reflect.apply(bound, receiver, []);
    const second = Reflect.apply(bound, receiver, []);

    expect(first.receiver).toBe("receiver");
    expect(first.invocationId).toBeTypeOf("string");
    expect(second.invocationId).not.toBe(first.invocationId);
    expect(runtime.captureInvocation()).toBeUndefined();
    const optionalHandler: unknown = undefined;
    const missingHandler: unknown = runtime.bindTrigger(
      {
        componentSourceId: "component_shared",
        triggerCallsiteId: "trigger_shared",
        sourceVersion: "source_shared",
      },
      optionalHandler,
    );
    expect(missingHandler).toBeUndefined();
  });

  it("observes a tRPC operation through a value-free pass-through link", () => {
    const runtime = createDataFlowRuntime(config, {
      performance: { now: () => 1 } as Performance,
    });
    const token = runtime.beginInvocation({
      componentSourceId: "component_profile",
      triggerCallsiteId: "trigger_load_profile",
      sourceVersion: "source_profile",
    });
    const operation = Object.freeze({
      id: 7,
      input: Object.freeze({ token: "must-not-be-retained" }),
      path: "user.byId",
      type: "query",
    });
    const expected = Object.freeze({ subscribe: vi.fn() });
    const next = vi.fn(() => expected);
    const link = runtime.createTrpcLink()(Object.freeze({}));

    const actual = runtime.withRequestFrame(
      token,
      { requestCallsiteId: "request_profile", sourceVersion: "source_profile" },
      () => link({ next, op: operation }),
    );

    expect(actual).toBe(expected);
    expect(next).toHaveBeenCalledWith(operation);
    expect(runtime.observations()).toMatchObject([
      {
        componentSourceId: "component_profile",
        method: "QUERY",
        operation: "user.byId",
        requestCallsiteId: "request_profile",
        transport: "trpc",
        triggerCallsiteId: "trigger_load_profile",
      },
    ]);
    expect(networkObservationSchema.safeParse(runtime.observations()[0]).success).toBe(
      true,
    );
    expect(JSON.stringify(runtime.observations())).not.toContain(
      "must-not-be-retained",
    );
  });

  it("does not record malformed tRPC metadata or interfere with the link result", () => {
    const runtime = createDataFlowRuntime(config, {
      performance: { now: () => 1 } as Performance,
    });
    const operation = Object.freeze({ path: "user.byId", type: "unknown" });
    const expected = Object.freeze({ result: true });
    const next = vi.fn(() => expected);

    expect(runtime.createTrpcLink()(undefined)({ next, op: operation })).toBe(expected);
    expect(next).toHaveBeenCalledWith(operation);
    expect(runtime.observations()).toEqual([]);
  });

  it("maps React memo and forwardRef wrapper identities to one component", () => {
    const runtime = createDataFlowRuntime(config, {
      performance: { now: () => 1 } as Performance,
    });
    const render = (): undefined => undefined;
    const forwardRef = Object.freeze({
      $$typeof: Symbol.for("react.forward_ref"),
      render,
    });
    const memo = Object.freeze({
      $$typeof: Symbol.for("react.memo"),
      type: forwardRef,
    });

    runtime.registerComponent(memo, "component_wrapped", "source_wrapped");

    for (const component of [memo, forwardRef, render]) {
      expect(runtime.getComponentRegistration(component)).toEqual({
        componentSourceId: "component_wrapped",
        sourceVersion: "source_wrapped",
      });
    }
  });

  it("does not follow ordinary type/render properties or execute wrapper getters", () => {
    const runtime = createDataFlowRuntime(config, {
      performance: { now: () => 1 } as Performance,
    });
    const ordinaryNested = {};
    const ordinary = Object.assign(() => undefined, { type: ordinaryNested });
    const getter = vi.fn(() => ordinaryNested);
    const forgedWrapper = { $$typeof: Symbol.for("react.memo") };
    Object.defineProperty(forgedWrapper, "type", { get: getter });

    runtime.registerComponent(ordinary, "component_ordinary", "source_ordinary");
    runtime.registerComponent(forgedWrapper, "component_forged", "source_forged");

    expect(runtime.getComponentRegistration(ordinaryNested)).toBeUndefined();
    expect(getter).not.toHaveBeenCalled();
  });

  it("enforces the centralized entry limit and restores only owned wrappers", () => {
    const limitedConfig = Object.freeze({
      ...config,
      limits: Object.freeze({
        ...DEFAULT_RUNTIME_DATA_FLOW_LIMITS,
        observationMaxEntries: 2,
      }),
    });
    const originalFetch: typeof fetch = vi.fn((input: RequestInfo | URL) => {
      void input;
      return successfulResponse();
    });
    const laterFetch: typeof fetch = vi.fn((input: RequestInfo | URL) => {
      void input;
      return successfulResponse();
    });
    const target = {
      fetch: originalFetch,
      location: { href: "https://example.test/" } as Location,
      performance: { now: () => 1 } as Performance,
    };
    const runtime = createDataFlowRuntime(limitedConfig, target);

    void target.fetch("/first");
    void target.fetch("/second");
    void target.fetch("/third");
    expect(runtime.observations().map(({ url }) => url.pathname)).toEqual([
      "/second",
      "/third",
    ]);

    target.fetch = laterFetch;
    runtime.dispose();
    expect(target.fetch).toBe(laterFetch);
  });

  it("excludes SpotPatch traffic and makes prior-route evidence stale", () => {
    const fetchStub: typeof fetch = vi.fn((input: RequestInfo | URL) => {
      void input;
      return successfulResponse();
    });
    const target = {
      fetch: fetchStub,
      location: { href: "https://example.test/first" } as Location,
      performance: { now: () => 1 } as Performance,
    };
    const runtime = createDataFlowRuntime(config, target);
    runtime.updateRoute("/first");

    void target.fetch("/__spotpatch/v1/data-flow/component-report");
    void target.fetch("/application-data");
    expect(runtime.observations()).toHaveLength(1);
    expect(runtime.observations()[0]?.freshness).toBe("current");

    runtime.updateRoute("/second");
    expect(runtime.observations()[0]?.freshness).toBe("stale-route");
  });
});
