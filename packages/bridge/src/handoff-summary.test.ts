import { externalHandoffSnapshotSchema } from "@spotpatch/shared";
import { describe, expect, it } from "vitest";

import { formatHandoffTaskSummary } from "./handoff-summary.js";

describe("bounded handoff task summary", () => {
  it("keeps location fields atomic and excludes full browser context", () => {
    const snapshot = externalHandoffSnapshotSchema.parse({
      schemaVersion: 1,
      cursor: "0123456789abcdef012345",
      session: { id: "abcdef0123456789abcdef", framework: "next" },
      revision: 1,
      publishedAt: "2026-08-24T00:00:00.000Z",
      expiresAt: "2026-08-24T00:15:00.000Z",
      annotation: {
        schemaVersion: 3,
        id: "summary-test",
        locale: "zh-CN",
        page: {
          url: "http://127.0.0.1:3000/private?token=hidden",
          pathname: "/private",
          title: "Private",
          viewportWidth: 1_440,
          viewportHeight: 900,
          devicePixelRatio: 2,
        },
        targets: [
          {
            instruction: "  改成\n深蓝色  ",
            source: {
              relativePath: "src/Derived.tsx",
              origin: "react-fiber",
              confidence: "probable",
            },
            react: { supported: true, componentStack: [] },
            element: {
              tagName: "div",
              selector: 'div#customer-token[data-testid="account-secret"]',
              sanitizedHtml: '<div data-token="hidden">private</div>',
              rect: { x: 0, y: 0, width: 100, height: 40 },
            },
            styles: {
              classNames: ["card"],
              matchedRules: [],
              computed: { color: "secret" },
              warnings: [],
            },
            code: {
              relativePath: "src/Authoritative.tsx",
              language: "tsx",
              startLine: 17,
              endLine: 20,
              excerpt: "const privateSource = true;",
              boundary: "nearby-lines",
            },
            warnings: [],
          },
        ],
        createdAt: "2026-08-24T00:00:00.000Z",
      },
    });

    const summary = formatHandoffTaskSummary(snapshot);

    expect(summary).toContain("Source: src/Authoritative.tsx:17");
    expect(summary).toContain("Element: <div>");
    expect(summary).toContain("Request: 改成 深蓝色");
    expect(summary).not.toContain("src/Derived.tsx:17");
    expect(summary).not.toContain("privateSource");
    expect(summary).not.toContain("data-token");
    expect(summary).not.toContain("account-secret");
    expect(summary).not.toContain("customer-token");
    expect(summary).not.toContain("token=hidden");
  });
});
