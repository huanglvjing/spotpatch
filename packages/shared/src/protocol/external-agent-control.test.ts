import { describe, expect, it } from "vitest";

import {
  EXTERNAL_AGENT_CONTROL_SCHEMA_VERSION,
  externalAgentControlConnectRequestSchema,
  externalAgentControlStatusSchema,
  managedFileSummarySchema,
} from "./external-agent-control.js";

describe("external Agent control protocol", () => {
  it("accepts the minimal disconnected managed status", () => {
    expect(
      externalAgentControlStatusSchema.parse({
        schemaVersion: EXTERNAL_AGENT_CONTROL_SCHEMA_VERSION,
        sequence: 0,
        mode: "inbox",
        adapter: {
          kind: "codex",
          maturity: "experimental",
          availability: "unavailable",
        },
        connectionState: "disconnected",
        authReadiness: "unknown",
        grantState: "missing",
        updatedAt: "2026-08-25T00:00:00.000Z",
      }),
    ).toMatchObject({ sequence: 0, mode: "inbox" });
  });

  it("rejects unknown control fields and non-fixed profiles", () => {
    const request = {
      requestId: "abcdefghijklmnopqrstuv",
      adapterKind: "codex",
      profile: "workspace-write",
    };

    expect(externalAgentControlConnectRequestSchema.safeParse(request).success).toBe(
      false,
    );
    expect(
      externalAgentControlConnectRequestSchema.safeParse({
        ...request,
        profile: "managed-apply-v1",
        cwd: "/tmp/project",
      }).success,
    ).toBe(false);
  });

  it.each(["/absolute.ts", "../escape.ts", "src\\file.ts", "src//file.ts"])(
    "rejects an unsafe managed file summary path: %s",
    (path) => {
      expect(
        managedFileSummarySchema.safeParse({
          path,
          additions: 1,
          deletions: 0,
        }).success,
      ).toBe(false);
    },
  );
});
