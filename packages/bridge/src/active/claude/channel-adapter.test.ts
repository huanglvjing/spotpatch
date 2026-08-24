import { McpServer } from "@modelcontextprotocol/server";
import { ERROR_CODES } from "@spotpatch/shared";
import { describe, expect, it, vi } from "vitest";

import {
  ActiveDeliveryUnknownError,
  type AgentDeliveryLifecycle,
  type AgentHandoffSnapshot,
} from "../types.js";
import {
  CLAUDE_CHANNEL_NOTIFICATION_METHOD,
  createClaudeChannelAdapter,
} from "./channel-adapter.js";

const SESSION_ID = "0123456789abcdef012345";
const CURSOR = "claude_cursor_01234567890";

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
    revision: 7,
    publishedAt: "2026-08-23T00:00:00.000Z",
    expiresAt: "2026-08-23T00:15:00.000Z",
    annotation: {
      schemaVersion: 3,
      id: "claude-channel-test",
      locale: "en-US",
      page,
      targets: [
        {
          instruction: "Private instruction must not enter the notification.",
          source: {
            relativePath: "src/private-card.tsx",
            origin: "jsx-host",
            confidence: "exact",
          },
          react: { supported: true, componentStack: ["PrivateCard"] },
          element: {
            tagName: "a",
            selector: "a.private-card",
            sanitizedHtml: '<a class="private-card">Private</a>',
            rect: { x: 0, y: 0, width: 100, height: 40 },
          },
          styles: {
            classNames: ["private-card"],
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

function server(): McpServer {
  return new McpServer(
    { name: "claude-channel-test", version: "0.0.0" },
    { capabilities: { experimental: { "claude/channel": {} }, tools: {} } },
  );
}

function lifecycle(reports: string[]): AgentDeliveryLifecycle {
  return {
    report(phase) {
      reports.push(phase);
      return Promise.resolve();
    },
  };
}

describe("Claude Channel adapter", () => {
  it("sends only a short reference and waits for exact-read plus terminal tools", async () => {
    const mcp = server();
    const notification = vi
      .spyOn(mcp.server, "notification")
      .mockResolvedValue(undefined);
    const reports: string[] = [];
    const adapter = createClaudeChannelAdapter({ server: mcp });
    const delivering = adapter.deliver(
      snapshot(),
      lifecycle(reports),
      new AbortController().signal,
    );

    await vi.waitFor(() => {
      expect(notification).toHaveBeenCalledOnce();
    });
    expect(notification).toHaveBeenCalledWith({
      method: CLAUDE_CHANNEL_NOTIFICATION_METHOD,
      params: {
        content: `SpotPatch revision 7 is ready. Call spotpatch_get_current_handoff with sessionId ${SESSION_ID} and the exact cursor, implement the request, then report completed or failed.`,
        meta: {
          cursor: CURSOR,
          revision: "7",
          session_id: SESSION_ID,
        },
      },
    });
    const wireValue = JSON.stringify(notification.mock.calls[0]?.[0]);
    expect(wireValue).not.toContain("Private instruction");
    expect(wireValue).not.toContain("src/private-card.tsx");

    await adapter.reportExactRead(CURSOR);
    await adapter.reportResult(CURSOR, "completed");
    await expect(delivering).resolves.toBeUndefined();
    await expect(adapter.reportExactRead(CURSOR)).resolves.toBeUndefined();
    await expect(adapter.reportResult(CURSOR, "completed")).resolves.toBeUndefined();
    expect(reports).toEqual(["dispatched", "working", "completed"]);
  });

  it("rejects a result for a cursor other than the active delivery", async () => {
    const mcp = server();
    vi.spyOn(mcp.server, "notification").mockResolvedValue(undefined);
    const adapter = createClaudeChannelAdapter({ server: mcp });
    const delivering = adapter.deliver(
      snapshot(),
      lifecycle([]),
      new AbortController().signal,
    );

    await expect(
      adapter.reportResult("other_cursor_012345678901", "failed"),
    ).rejects.toMatchObject({
      code: ERROR_CODES.ACTIVE_DISPATCH_INVALID,
    });
    await adapter.reportResult(CURSOR, "failed");
    await expect(delivering).resolves.toBeUndefined();
  });

  it("reports delivery-unknown and stops when no terminal tool arrives", async () => {
    const mcp = server();
    vi.spyOn(mcp.server, "notification").mockResolvedValue(undefined);
    const reports: string[] = [];
    const adapter = createClaudeChannelAdapter({
      server: mcp,
      deliveryTimeoutMs: 5,
    });

    await expect(
      adapter.deliver(snapshot(), lifecycle(reports), new AbortController().signal),
    ).rejects.toBeInstanceOf(ActiveDeliveryUnknownError);
    expect(reports).toEqual(["dispatched", "delivery-unknown"]);
  });

  it("bounds a stalled notification write and ignores its late settlement", async () => {
    const mcp = server();
    let resolveNotification!: () => void;
    vi.spyOn(mcp.server, "notification").mockReturnValue(
      new Promise<void>((resolve) => {
        resolveNotification = resolve;
      }),
    );
    const reports: string[] = [];
    const adapter = createClaudeChannelAdapter({
      server: mcp,
      notificationTimeoutMs: 5,
    });

    await expect(
      adapter.deliver(snapshot(), lifecycle(reports), new AbortController().signal),
    ).rejects.toBeInstanceOf(ActiveDeliveryUnknownError);
    resolveNotification();
    await Promise.resolve();
    expect(reports).toEqual(["delivery-unknown"]);
  });

  it("unblocks a stalled notification write when the adapter closes", async () => {
    const mcp = server();
    const notification = vi.spyOn(mcp.server, "notification").mockReturnValue(
      new Promise<void>((resolve) => {
        void resolve;
      }),
    );
    const reports: string[] = [];
    const adapter = createClaudeChannelAdapter({ server: mcp });
    const delivering = adapter.deliver(
      snapshot(),
      lifecycle(reports),
      new AbortController().signal,
    );

    await vi.waitFor(() => {
      expect(notification).toHaveBeenCalledOnce();
    });
    await adapter.close();
    await expect(delivering).rejects.toBeInstanceOf(ActiveDeliveryUnknownError);
    expect(reports).toEqual(["delivery-unknown"]);
  });
});
