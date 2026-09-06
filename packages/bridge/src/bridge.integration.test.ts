import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import type { Socket } from "node:net";
import os from "node:os";
import path from "node:path";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createExternalHandoffService } from "@spotpatch/dev-server";
import type { ExternalHandoffService } from "@spotpatch/dev-server";
import {
  ERROR_CODES,
  EXTERNAL_HANDOFF_BROKER_PROTOCOL_VERSION,
  spotAnnotationRequestSchema,
  type SpotAnnotation,
} from "@spotpatch/shared";
import {
  computeExternalHandoffProjectKey,
  externalHandoffDescriptorSchema,
  initializePrivateExternalHandoffFile,
  resolveExternalHandoffRuntimeDirectory,
} from "@spotpatch/shared/external-agent-node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSpotPatchBridgeClient } from "./client.js";
import { createActiveEventPump } from "./active/event-pump.js";
import type { AgentAdapter } from "./active/types.js";
import { resolveExactProjectSessionId } from "./discovery.js";
import { createSpotPatchMcpServer } from "./mcp.js";

const SESSION_ID = "0123456789abcdef012345";
const BRIDGE_LIFECYCLE_TIMEOUT_MS = 30_000;
let publishSequence = 0;

async function publishHandoff(service: ExternalHandoffService, value: SpotAnnotation) {
  publishSequence += 1;
  return service.publish(
    {
      requestId: `bridge_publish_request_${String(publishSequence).padStart(4, "0")}`,
      annotation: spotAnnotationRequestSchema.parse(value),
    },
    () => Promise.resolve(value),
  );
}

async function stalledLoopbackBroker(): Promise<
  Readonly<{ close: () => Promise<void>; endpoint: string }>
> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();

  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Expected an IPv4 loopback test address.");
  }

  return Object.freeze({
    endpoint: `http://127.0.0.1:${String(address.port)}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
        for (const socket of sockets) socket.destroy();
      }),
  });
}

function annotation(large = false): SpotAnnotation {
  const matchedRules = large
    ? Object.freeze(
        Array.from({ length: 29 }, (_, index) =>
          Object.freeze({
            selector: `.component-${String(index)}`,
            declarations: `--handoff-test:${"x".repeat(7_980)}`,
          }),
        ),
      )
    : Object.freeze([]);

  return Object.freeze({
    schemaVersion: 3,
    id: "bridge-integration-annotation",
    locale: "en-US",
    page: Object.freeze({
      url: "http://127.0.0.1:5173/settings?secret=not-a-summary",
      pathname: "/settings",
      title: "Settings",
      viewportWidth: 1_440,
      viewportHeight: 900,
      devicePixelRatio: 2,
    }),
    targets: Object.freeze([
      Object.freeze({
        instruction: "Update the selected button.",
        source: Object.freeze({
          fileId: "source-button",
          relativePath: "src/Button.tsx",
          line: 10,
          column: 3,
          origin: "jsx-host",
          confidence: "exact",
        }),
        react: Object.freeze({
          supported: true,
          componentName: "Button",
          componentStack: Object.freeze(["Button"]),
        }),
        element: Object.freeze({
          tagName: "button",
          selector: "button.primary",
          sanitizedHtml: '<button class="primary">Save</button>',
          rect: Object.freeze({ x: 10, y: 20, width: 100, height: 40 }),
        }),
        styles: Object.freeze({
          classNames: Object.freeze(["primary"]),
          matchedRules,
          computed: Object.freeze({ display: "block" }),
          warnings: Object.freeze([]),
        }),
        code: Object.freeze({
          relativePath: "src/Button.tsx",
          language: "tsx",
          startLine: 8,
          endLine: 14,
          excerpt: "export function Button() { return <button>Save</button>; }",
          boundary: "component",
        }),
        warnings: Object.freeze([]),
      }),
    ]),
    createdAt: "2026-08-23T00:00:00.000Z",
  });
}

function structured(result: {
  readonly structuredContent?: unknown;
}): Record<string, unknown> {
  const value = result.structuredContent;

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected MCP structuredContent.");
  }

  return value as Record<string, unknown>;
}

describe.sequential("external Agent bridge integration", () => {
  let projectRoot: string;
  let runtimeRoot: string;
  let service: ExternalHandoffService | undefined;

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "spotpatch-bridge-project-"));
    runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "spotpatch-bridge-runtime-"));
    vi.stubEnv("XDG_RUNTIME_DIR", runtimeRoot);
    service = createExternalHandoffService({
      framework: "vite",
      root: projectRoot,
      sessionId: SESSION_ID,
    });
    await service.start();
  }, BRIDGE_LIFECYCLE_TIMEOUT_MS);

  afterEach(async () => {
    await service?.close();
    service = undefined;
    vi.unstubAllEnvs();
    await Promise.all([
      rm(projectRoot, { force: true, recursive: true }),
      rm(runtimeRoot, { force: true, recursive: true }),
    ]);
  }, BRIDGE_LIFECYCLE_TIMEOUT_MS);

  it("discovers only the current project and treats an empty inbox as normal", async () => {
    const bridge = createSpotPatchBridgeClient(projectRoot);

    await expect(bridge.sessions()).resolves.toEqual([
      expect.objectContaining({
        current: null,
        framework: "vite",
        sessionId: SESSION_ID,
      }),
    ]);
    await expect(bridge.current()).resolves.toEqual({
      outcome: "not-found",
      reason: "empty",
    });

    const waiting = bridge.wait(undefined, undefined, 1_000);
    if (service === undefined) throw new Error("Expected running handoff service.");
    await publishHandoff(service, annotation());
    const delivered = await waiting;
    expect(delivered).toMatchObject({
      outcome: "handoff",
      receiptRecorded: true,
      snapshot: { revision: 1, session: { id: SESSION_ID } },
    });
    expect(service.status().handoff.pickupCount).toBe(1);

    await service.close();
    service = undefined;
    await expect(bridge.sessions()).resolves.toEqual([]);
  });

  it("requires active connectors to start at the exact project root", async () => {
    const nested = path.join(projectRoot, "src");
    await mkdir(nested);

    await expect(resolveExactProjectSessionId(projectRoot, SESSION_ID)).resolves.toBe(
      SESSION_ID,
    );
    await expect(
      resolveExactProjectSessionId(nested, SESSION_ID),
    ).rejects.toMatchObject({ code: ERROR_CODES.SESSION_NOT_FOUND });
  });

  it("pins active discovery to the exact nested Session without ancestor fallback", async () => {
    const nested = path.join(projectRoot, "apps", "web");
    const nestedSessionId = "fedcba9876543210fedcba";
    await mkdir(nested, { recursive: true });
    const nestedService = createExternalHandoffService({
      framework: "vite",
      root: nested,
      sessionId: nestedSessionId,
    });
    await nestedService.start();

    try {
      const selectedSessionId = await resolveExactProjectSessionId(nested);
      expect(selectedSessionId).toBe(nestedSessionId);

      const client = createSpotPatchBridgeClient(nested);
      const lease = await client.activeClaim("claude-channel", selectedSessionId);
      expect(lease.sessionId).toBe(nestedSessionId);
      await client.activeRelease(lease);

      await nestedService.close();
      await expect(
        createSpotPatchBridgeClient(nested).activeClaim(
          "claude-channel",
          selectedSessionId,
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.SESSION_NOT_FOUND });
    } finally {
      await nestedService.close();
    }
  });

  it("removes only an unchanged private descriptor after its Broker is unreachable", async () => {
    const stalledBroker = await stalledLoopbackBroker();
    const runtimeDirectory = await resolveExternalHandoffRuntimeDirectory(false);
    const staleSessionId = "abcdef0123456789abcdef";
    const stalePath = path.join(runtimeDirectory, `${staleSessionId}.json`);
    const descriptor = externalHandoffDescriptorSchema.parse({
      schemaVersion: 1,
      brokerProtocolVersion: EXTERNAL_HANDOFF_BROKER_PROTOCOL_VERSION,
      projectKey: await computeExternalHandoffProjectKey(projectRoot),
      sessionId: staleSessionId,
      framework: "vite",
      endpoint: stalledBroker.endpoint,
      bridgeToken: "a".repeat(43),
      pid: process.pid,
      createdAt: new Date().toISOString(),
    });
    await writeFile(stalePath, JSON.stringify(descriptor), { mode: 0o600 });
    await initializePrivateExternalHandoffFile(stalePath);

    try {
      await expect(
        createSpotPatchBridgeClient(projectRoot).sessions(),
      ).resolves.toHaveLength(1);
      await expect(lstat(stalePath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await stalledBroker.close();
    }
  });

  it("claims an atomic active baseline and reports one delivery lifecycle", async () => {
    if (service === undefined) throw new Error("Expected running handoff service.");
    const bridge = createSpotPatchBridgeClient(projectRoot);
    const lease = await bridge.activeClaim("claude-channel");
    expect(lease).toMatchObject({
      adapterKind: "claude-channel",
      baselineCursor: undefined,
      sessionId: SESSION_ID,
    });
    expect(service.capability().activeAdapter).toMatchObject({
      kind: "claude-channel",
      state: "ready",
    });
    await expect(bridge.activeClaim("claude-channel")).rejects.toMatchObject({
      code: ERROR_CODES.ACTIVE_ADAPTER_CONFLICT,
    });

    const waiting = bridge.wait(lease.sessionId, lease.baselineCursor, 1_000);
    const published = await publishHandoff(service, annotation());
    expect(published.delivery).toMatchObject({
      mode: "active",
      dispatch: { phase: "queued" },
    });
    const delivery = await waiting;
    expect(delivery).toMatchObject({
      outcome: "handoff",
      receiptRecorded: true,
      snapshot: { cursor: published.handoff.cursor },
    });

    await bridge.activeHeartbeat(lease);
    await bridge.activeReport(lease, published.handoff.cursor, "dispatching");
    await bridge.activeReport(lease, published.handoff.cursor, "dispatched");
    await bridge.activeReport(lease, published.handoff.cursor, "working");
    await bridge.activeReport(lease, published.handoff.cursor, "completed");
    expect(service.status(published.handoff.cursor)).toMatchObject({
      activeAdapter: { state: "ready" },
      dispatch: { phase: "completed" },
      handoff: { pickupCount: 1 },
    });

    await bridge.activeRelease(lease);
    await expect(bridge.activeRelease(lease)).resolves.toBeUndefined();
    expect(service.capability().activeAdapter).toBeNull();
  });

  it("returns to ready and actively dispatches two consecutive handoffs", async () => {
    if (service === undefined) throw new Error("Expected running handoff service.");
    const revisions: number[] = [];
    const adapter: AgentAdapter = {
      kind: "claude-channel",
      close: vi.fn(() => Promise.resolve()),
      async deliver(handoff, lifecycle) {
        revisions.push(handoff.revision);
        await lifecycle.report("dispatched");
        await lifecycle.report("working");
        await lifecycle.report("completed");
      },
    };
    const pump = createActiveEventPump({
      adapter,
      client: createSpotPatchBridgeClient(projectRoot),
      waitTimeoutMs: 100,
    });
    const running = pump.run();

    await vi.waitFor(() => {
      expect(service?.capability().activeAdapter).toMatchObject({
        kind: "claude-channel",
        state: "ready",
      });
    });

    for (const expectedRevision of [1, 2]) {
      const published = await publishHandoff(service, annotation());
      expect(published).toMatchObject({
        delivery: {
          mode: "active",
          dispatch: { phase: "queued", revision: expectedRevision },
        },
        handoff: { revision: expectedRevision },
      });
      await vi.waitFor(() => {
        expect(service?.status(published.handoff.cursor)).toMatchObject({
          activeAdapter: { state: "ready" },
          dispatch: { phase: "completed", revision: expectedRevision },
          handoff: { pickupCount: 1, revision: expectedRevision },
        });
      });
    }

    expect(revisions).toEqual([1, 2]);
    await pump.close();
    await expect(running).resolves.toBeUndefined();
    expect(adapter.close).toHaveBeenCalledOnce();
    expect(service.capability().activeAdapter).toBeNull();
  });

  it("requires an explicit Session when active discovery finds multiple matches", async () => {
    const second = createExternalHandoffService({
      framework: "next",
      root: projectRoot,
      sessionId: "abcdef0123456789abcdef",
    });
    await second.start();

    try {
      const bridge = createSpotPatchBridgeClient(projectRoot);
      await expect(bridge.activeClaim("claude-channel")).rejects.toMatchObject({
        code: ERROR_CODES.SESSION_AMBIGUOUS,
      });
      const lease = await bridge.activeClaim("claude-channel", SESSION_ID);
      await bridge.activeRelease(lease);
    } finally {
      await second.close();
    }
  });

  it("binds a scoped MCP server to one exact development Session", async () => {
    const otherSessionId = "abcdef0123456789abcdef";
    const second = createExternalHandoffService({
      framework: "next",
      root: projectRoot,
      sessionId: otherSessionId,
    });
    await second.start();
    const mcpServer = createSpotPatchMcpServer(projectRoot, {
      sessionId: SESSION_ID,
    });
    const mcpClient = new Client({ name: "spotpatch-scoped", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    await mcpClient.connect(clientTransport);

    try {
      const listed = await mcpClient.callTool({
        name: "spotpatch_list_sessions",
        arguments: {},
      });
      expect(structured(listed)).toMatchObject({
        outcome: "sessions",
        sessions: [{ sessionId: SESSION_ID }],
      });
      expect((structured(listed).sessions as readonly unknown[]).length).toBe(1);

      const crossSession = await mcpClient.callTool({
        name: "spotpatch_get_current_handoff",
        arguments: { sessionId: otherSessionId },
      });
      expect(crossSession.isError).toBe(true);
      expect(crossSession.content).toEqual([
        {
          type: "text",
          text: "SpotPatch handoff request failed (SESSION_NOT_FOUND).",
        },
      ]);
    } finally {
      await mcpClient.close();
      await mcpServer.close();
      await second.close();
    }
  });

  it("passes the four-tool contract through the official MCP client", async () => {
    const mcpServer = createSpotPatchMcpServer(projectRoot);
    const mcpClient = new Client({ name: "spotpatch-integration", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    await mcpClient.connect(clientTransport);

    try {
      const listed = await mcpClient.listTools();
      expect(listed.tools.map(({ name }) => name)).toEqual([
        "spotpatch_list_sessions",
        "spotpatch_get_current_handoff",
        "spotpatch_wait_for_handoff",
        "spotpatch_ack_handoff",
      ]);
      expect(mcpClient.getServerCapabilities()?.experimental).toBeUndefined();
      expect(
        Object.fromEntries(
          listed.tools.map((tool) => [tool.name, tool.annotations?.readOnlyHint]),
        ),
      ).toEqual({
        spotpatch_list_sessions: true,
        spotpatch_get_current_handoff: false,
        spotpatch_wait_for_handoff: false,
        spotpatch_ack_handoff: false,
      });

      const empty = await mcpClient.callTool({
        name: "spotpatch_get_current_handoff",
        arguments: {},
      });
      expect(empty.isError).toBeUndefined();
      expect(structured(empty)).toMatchObject({
        outcome: "not-found",
        reason: "empty",
      });

      if (service === undefined) throw new Error("Expected running handoff service.");
      const published = await publishHandoff(service, annotation(true));
      const current = await mcpClient.callTool({
        name: "spotpatch_get_current_handoff",
        arguments: {},
      });
      expect(current.isError).toBeUndefined();
      expect(current.content).toEqual([
        {
          type: "text",
          text: [
            "SpotPatch handoff revision 1 is available.",
            "User-approved target summary (1):",
            "1. Source: src/Button.tsx:10:3",
            "   Element: <button>",
            "   Request: Update the selected button.",
            "Full validated context is available in structuredContent.",
          ].join("\n"),
        },
      ]);
      expect(structured(current)).toMatchObject({
        outcome: "handoff",
        receiptRecorded: true,
        snapshot: { revision: 1 },
      });
      const serializedBytes = Buffer.byteLength(
        JSON.stringify(current.structuredContent),
        "utf8",
      );
      expect(serializedBytes).toBeGreaterThan(225_000);
      expect(serializedBytes).toBeLessThanOrEqual(256 * 1_024);

      const waited = await mcpClient.callTool({
        name: "spotpatch_wait_for_handoff",
        arguments: { afterCursor: published.handoff.cursor, timeoutMs: 5 },
      });
      expect(waited.isError).toBeUndefined();
      expect(structured(waited)).toEqual({ outcome: "timeout" });

      const controller = new AbortController();
      const pending = mcpClient.callTool(
        {
          name: "spotpatch_wait_for_handoff",
          arguments: {
            afterCursor: published.handoff.cursor,
            timeoutMs: 25_000,
          },
        },
        { signal: controller.signal },
      );
      controller.abort("integration-cancel");
      await expect(pending).rejects.toBeDefined();

      const acknowledged = await mcpClient.callTool({
        name: "spotpatch_ack_handoff",
        arguments: { cursor: published.handoff.cursor },
      });
      expect(acknowledged.isError).toBeUndefined();
      expect(structured(acknowledged)).toMatchObject({
        outcome: "acknowledged",
        summary: { pickupCount: 1, revision: 1 },
      });
    } finally {
      await mcpClient.close();
      await mcpServer.close();
    }
  });
});
