import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import type { HandoffWaitDelivery } from "../../client.js";
import type { ActiveBridgeLease, AgentHandoffSnapshot } from "../types.js";
import { CLAUDE_CHANNEL_NOTIFICATION_METHOD } from "./channel-adapter.js";
import {
  createClaudeChannelMcpHost,
  type ClaudeChannelBridgeClient,
} from "./mcp-server.js";

const SESSION_ID = "0123456789abcdef012345";
const CURSOR = "host_cursor_0123456789012";

function snapshot(): AgentHandoffSnapshot {
  const page = {
    url: "http://127.0.0.1:5173/catalog",
    pathname: "/catalog",
    title: "Catalog",
    viewportWidth: 1_440,
    viewportHeight: 900,
    devicePixelRatio: 2,
  };
  return {
    schemaVersion: 1,
    cursor: CURSOR,
    session: { id: SESSION_ID, framework: "vite" },
    revision: 8,
    publishedAt: "2026-08-23T00:00:00.000Z",
    expiresAt: "2026-08-23T00:15:00.000Z",
    annotation: {
      schemaVersion: 3,
      id: "claude-host-test",
      locale: "en-US",
      page,
      targets: [
        {
          instruction: "Make the selected card black.",
          source: { origin: "jsx-host", confidence: "exact" },
          react: { supported: true, componentStack: ["Card"] },
          element: {
            tagName: "a",
            selector: "a.card",
            sanitizedHtml: '<a class="card">Card</a>',
            rect: { x: 0, y: 0, width: 100, height: 40 },
          },
          styles: {
            classNames: ["card"],
            matchedRules: [],
            computed: { display: "block" },
            warnings: [],
          },
          warnings: [],
        },
      ],
      createdAt: "2026-08-23T00:00:00.000Z",
    },
  };
}

function abortableWait(signal?: AbortSignal): Promise<HandoffWaitDelivery> {
  return new Promise((_, reject) => {
    const abort = (): void => {
      reject(new Error("wait aborted"));
    };
    if (signal?.aborted === true) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

function fakeBridge(snapshotValue: AgentHandoffSnapshot): Readonly<{
  client: ClaudeChannelBridgeClient;
  claims: ReturnType<typeof vi.fn>;
  phases: string[];
  releases: ReturnType<typeof vi.fn>;
}> {
  const activeLease: ActiveBridgeLease = Object.freeze({
    adapterKind: "claude-channel",
    baselineCursor: "baseline_cursor_0123456789",
    heartbeatIntervalMs: 60_000,
    leaseToken: "lease_token_0123456789012",
    sessionId: SESSION_ID,
  });
  const claims = vi.fn(() => Promise.resolve(activeLease));
  const releases = vi.fn(() => Promise.resolve());
  const phases: string[] = [];
  let waits = 0;
  const client: ClaudeChannelBridgeClient = {
    activeClaim: claims,
    activeHeartbeat() {
      return Promise.resolve();
    },
    activeRelease: releases,
    activeReport(_lease, _cursor, phase) {
      phases.push(phase);
      return Promise.resolve();
    },
    ack() {
      return Promise.reject(new Error("Explicit ack is not used in this test."));
    },
    current() {
      return Promise.resolve({
        outcome: "handoff",
        receiptRecorded: true,
        snapshot: snapshotValue,
      } as const);
    },
    sessions() {
      return Promise.resolve([]);
    },
    async wait(_sessionId, _afterCursor, _timeoutMs, signal) {
      waits += 1;
      if (waits === 1) {
        return {
          outcome: "handoff",
          receiptRecorded: true,
          snapshot: snapshotValue,
        };
      }

      return abortableWait(signal);
    },
  };
  return Object.freeze({ claims, client, phases, releases });
}

function structured(result: {
  readonly structuredContent?: unknown;
}): Record<string, unknown> {
  const value = result.structuredContent;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected MCP structured content.");
  }

  return value as Record<string, unknown>;
}

describe("Claude Channel MCP host", () => {
  it("claims only after initialize, exposes Channel capability, and drives exact lifecycle tools", async () => {
    const handoff = snapshot();
    const bridge = fakeBridge(handoff);
    const host = createClaudeChannelMcpHost({ client: bridge.client });
    const mcpClient = new Client({ name: "claude-code-test", version: "1.0.0" });
    const notifications: unknown[] = [];
    mcpClient.setNotificationHandler(
      CLAUDE_CHANNEL_NOTIFICATION_METHOD,
      {
        params: z.strictObject({
          content: z.string(),
          meta: z.strictObject({
            cursor: z.string(),
            revision: z.string(),
            session_id: z.string(),
          }),
        }),
      },
      (params) => {
        notifications.push(params);
        return Promise.resolve();
      },
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await host.server.connect(serverTransport);
    expect(bridge.claims).not.toHaveBeenCalled();

    await mcpClient.connect(clientTransport);
    await vi.waitFor(() => {
      expect(bridge.claims).toHaveBeenCalledOnce();
    });
    expect(mcpClient.getServerCapabilities()).toMatchObject({
      experimental: { "claude/channel": {} },
      tools: {},
    });
    const listed = await mcpClient.listTools();
    expect(listed.tools.map(({ name }) => name)).toEqual([
      "spotpatch_list_sessions",
      "spotpatch_get_current_handoff",
      "spotpatch_wait_for_handoff",
      "spotpatch_ack_handoff",
      "spotpatch_report_handoff_result",
    ]);
    await vi.waitFor(() => {
      expect(notifications).toHaveLength(1);
    });

    const read = await mcpClient.callTool({
      name: "spotpatch_get_current_handoff",
      arguments: { cursor: CURSOR, sessionId: SESSION_ID },
    });
    expect(read.isError).toBeUndefined();
    expect(structured(read)).toMatchObject({
      outcome: "handoff",
      snapshot: { cursor: CURSOR },
    });
    await vi.waitFor(() => {
      expect(bridge.phases).toContain("working");
    });

    const reported = await mcpClient.callTool({
      name: "spotpatch_report_handoff_result",
      arguments: { cursor: CURSOR, outcome: "completed" },
    });
    expect(reported.isError).toBeUndefined();
    expect(structured(reported)).toEqual({
      outcome: "reported",
      cursor: CURSOR,
      result: "completed",
    });
    await vi.waitFor(() => {
      expect(bridge.phases).toEqual([
        "dispatching",
        "dispatched",
        "working",
        "completed",
      ]);
    });

    await host.close();
    await mcpClient.close();
    expect(bridge.releases).toHaveBeenCalledOnce();
  });

  it("fails closed when the initialized lifecycle is repeated", async () => {
    const bridge = fakeBridge(snapshot());
    const fatal = vi.fn();
    const host = createClaudeChannelMcpHost({
      client: bridge.client,
      onFatalError: fatal,
    });
    host.server.server.oninitialized?.();
    await vi.waitFor(() => {
      expect(bridge.claims).toHaveBeenCalledOnce();
    });
    host.server.server.oninitialized?.();
    await vi.waitFor(() => {
      expect(fatal).toHaveBeenCalledOnce();
    });
    expect(bridge.claims).toHaveBeenCalledOnce();
    await host.close();
  });
});
