import { describe, expect, it } from "vitest";

import {
  isSensitiveAttributeName,
  redactSensitiveText,
  sanitizeAttributeValue,
  sanitizeUrl,
} from "./content-sanitizer.js";

describe("content sanitizer", () => {
  it.each([
    "value",
    "defaultValue",
    "authorization",
    "cookie",
    "set-cookie",
    "data-access-token",
    "api_key",
    "client-secret",
  ])("identifies a permanently sensitive attribute: %s", (name) => {
    expect(isSensitiveAttributeName(name)).toBe(true);
  });

  it("does not mistake ARIA value metadata for a form value", () => {
    expect(isSensitiveAttributeName("aria-valuemax")).toBe(false);
  });

  it("removes sensitive attributes and inline payloads", () => {
    expect(
      sanitizeAttributeValue("data-token", "visible-secret", "http://localhost/"),
    ).toBeUndefined();
    expect(
      sanitizeAttributeValue(
        "style",
        "background:url(data:image/png;base64,QUJDREVGRw==)",
        "http://localhost/",
      ),
    ).toContain("[redacted inline data]");
    expect(redactSensitiveText("Authorization: Bearer abc.def.ghi")).not.toContain(
      "abc.def.ghi",
    );
  });

  it("cleans URL credentials, secret query parameters, blob URLs, and fragments", () => {
    const sanitized = sanitizeUrl(
      "https://person:password@example.com/callback?token=abc&view=wide#api-key=def",
      "http://localhost:5173/",
    );

    expect(sanitized).not.toContain("person");
    expect(sanitized).not.toContain("password");
    expect(sanitized).not.toContain("abc");
    expect(sanitized).not.toContain("def");
    expect(sanitized).toContain("token=%5Bredacted%5D");
    expect(sanitizeUrl("blob:http://localhost/secret", "http://localhost/")).toBe(
      "[redacted URL]",
    );
  });
});
