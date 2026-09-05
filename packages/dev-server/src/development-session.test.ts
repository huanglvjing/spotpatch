import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextualAskExecutor } from "@spotpatch/agent";

import { createDevelopmentSession } from "./development-session.js";
import type { ExternalAgentControlPort } from "./external-agent/control-port.js";
import { resolveOptions } from "./options.js";
import { createSourceRegistry } from "./registry/source-registry.js";
import { createSession } from "./session/session.js";

const fake = vi.hoisted(() => {
  const order: string[] = [];
  const agent = {
    close: vi.fn(() => {
      order.push("agent");
      return Promise.resolve();
    }),
  };
  const ask = {
    close: vi.fn(() => {
      order.push("ask");
      return Promise.resolve();
    }),
  };
  const handoff = {
    start: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => {
      order.push("handoff");
      return Promise.resolve();
    }),
    capability: () => ({ brokerReady: true }),
  };
  const middleware = Object.assign(vi.fn(), {
    dispose: vi.fn(() => {
      order.push("middleware");
    }),
  });
  return {
    order,
    agent,
    ask,
    handoff,
    middleware,
    createAgent: vi.fn<(_input: unknown) => typeof agent>(() => agent),
    createAsk: vi.fn<(_input: unknown) => typeof ask>(() => ask),
    createHandoff: vi.fn<(_input: unknown) => typeof handoff>(() => handoff),
    createMiddleware: vi.fn<(_input: unknown) => typeof middleware>(() => middleware),
  };
});
vi.mock("./agent/job-manager.js", () => ({ createAgentJobManager: fake.createAgent }));
vi.mock("./contextual-ask/manager.js", () => ({
  createContextualAskManager: fake.createAsk,
}));
vi.mock("./contextual-ask/configured-key-executors.js", () => ({
  createConfiguredKeyAskExecutors: () => [],
}));
vi.mock("./external-handoff/service.js", () => ({
  createExternalHandoffService: fake.createHandoff,
}));
vi.mock("./server/middleware.js", () => ({
  createSpotPatchMiddleware: fake.createMiddleware,
}));

beforeEach(() => {
  vi.clearAllMocks();
  fake.order.length = 0;
});

describe("shared development session", () => {
  it.each(["vite", "next", "astro"] as const)(
    "gives %s the same coordinator and idempotent reverse-order cleanup",
    async (framework) => {
      const clear = vi.fn();
      const registry = { ...createSourceRegistry(), clear };
      const managed = { executorId: "fixture" } as ContextualAskExecutor;
      const control = {
        dispose: vi.fn(() => {
          fake.order.push("control");
          return Promise.resolve();
        }),
      } as unknown as ExternalAgentControlPort;
      const options = resolveOptions({
        ai: { baseURL: "https://provider.example.test/v1", model: "fixture" },
        contextualAsk: {},
        externalAgent: true,
      });
      if (options.ai === false) throw new Error("AI expected");
      const limits = options.ai.execution.limits;
      const session = createSession();
      const services = await createDevelopmentSession({
        framework,
        root: "/app",
        executionRoot: "/workspace",
        options,
        registry,
        session,
        environment: { TEST_SECRET: "never-forward-to-http" },
        createManagedAskExecutor: () => managed,
        createExternalAgentControl: () => Promise.resolve(control),
        resolveValidation: () => Promise.resolve({ checks: {}, limits }),
      });
      const agentInput = fake.createAgent.mock.calls[0]?.[0];
      const askInput = fake.createAsk.mock.calls[0]?.[0];
      if (
        typeof agentInput !== "object" ||
        agentInput === null ||
        !("coordinator" in agentInput) ||
        typeof askInput !== "object" ||
        askInput === null ||
        !("coordinator" in askInput)
      )
        throw new Error("Missing service inputs");
      expect(agentInput.coordinator).toBe(askInput.coordinator);
      expect(agentInput).toMatchObject({ root: "/workspace" });
      expect(fake.createHandoff).toHaveBeenCalledWith({
        framework,
        root: "/app",
        sessionId: session.id,
      });
      expect(fake.createMiddleware.mock.calls[0]?.[0]).not.toHaveProperty(
        "environment",
      );
      const closing = services.close();
      expect(services.close()).toBe(closing);
      await closing;
      expect(fake.order).toEqual(["middleware", "control", "handoff", "ask", "agent"]);
      expect(clear).toHaveBeenCalledOnce();
    },
  );

  it("continues cleanup after a failing resource and does not start disabled features", async () => {
    const clear = vi.fn();
    const registry = { ...createSourceRegistry(), clear };
    const createManagedAskExecutor = vi.fn<() => ContextualAskExecutor>();
    const createExternalAgentControl = vi.fn<() => Promise<ExternalAgentControlPort>>();
    const services = await createDevelopmentSession({
      framework: "astro",
      root: "/app",
      options: resolveOptions({
        ai: false,
        contextualAsk: false,
        externalAgent: false,
      }),
      registry,
      session: createSession(),
      environment: {},
      createManagedAskExecutor,
      createExternalAgentControl,
    });
    fake.middleware.dispose.mockImplementationOnce(() => {
      throw new Error("fixture cleanup failure");
    });
    await expect(services.close()).rejects.toThrow("cleanup failed");
    expect(clear).toHaveBeenCalledOnce();
    expect(createManagedAskExecutor).not.toHaveBeenCalled();
    expect(createExternalAgentControl).not.toHaveBeenCalled();
    expect(fake.createAgent).not.toHaveBeenCalled();
    expect(fake.createAsk).not.toHaveBeenCalled();
    expect(fake.createHandoff).not.toHaveBeenCalled();
  });
});
