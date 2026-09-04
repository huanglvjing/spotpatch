import type { IncomingMessage } from "node:http";

import { ERROR_CODES, SPOTPATCH_TOKEN_HEADER, SpotPatchError } from "@spotpatch/shared";
import { describe, expect, it } from "vitest";

import { assertRequestAuthorized, isLoopbackHostname } from "./request-security.js";

const sessionToken = "test-session-token";

function requestWithHeaders(
  headers: IncomingMessage["headers"],
  method = "POST",
): IncomingMessage {
  return { headers, method } as IncomingMessage;
}

function expectErrorCode(callback: () => void, code: string): void {
  try {
    callback();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(SpotPatchError);
    expect((error as SpotPatchError).code).toBe(code);
    return;
  }

  throw new Error("Expected request authorization to fail.");
}

describe("request security", () => {
  it.each([
    "localhost",
    "app.localhost",
    "127.0.0.1",
    "127.42.1.9",
    "::1",
    "::ffff:127.0.0.1",
  ])("recognizes loopback hostname %s", (hostname) => {
    expect(isLoopbackHostname(hostname)).toBe(true);
  });

  it.each(["0.0.0.0", "192.168.1.10", "example.com", "::2"])(
    "rejects non-loopback hostname %s",
    (hostname) => {
      expect(isLoopbackHostname(hostname)).toBe(false);
    },
  );

  it("accepts an authenticated loopback request", () => {
    const request = requestWithHeaders({
      host: "127.0.0.1:5173",
      origin: "http://localhost:5173",
      [SPOTPATCH_TOKEN_HEADER.toLowerCase()]: sessionToken,
    });

    expect(() => {
      assertRequestAuthorized(request, { allowLan: false, sessionToken });
    }).not.toThrow();
  });

  it("accepts an authenticated same-origin browser GET without an Origin header", () => {
    const request = requestWithHeaders(
      {
        host: "localhost:5173",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        [SPOTPATCH_TOKEN_HEADER.toLowerCase()]: sessionToken,
      },
      "GET",
    );

    expect(() => {
      assertRequestAuthorized(request, { allowLan: false, sessionToken });
    }).not.toThrow();
  });

  it.each([
    ["missing Fetch Metadata", {}, "GET"],
    [
      "cross-site Fetch Metadata",
      {
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "cross-site",
      },
      "GET",
    ],
    [
      "a non-GET method",
      {
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
      },
      "POST",
    ],
  ])("rejects an Origin-less request with %s", (_label, metadata, method) => {
    const request = requestWithHeaders(
      {
        host: "localhost:5173",
        ...metadata,
        [SPOTPATCH_TOKEN_HEADER.toLowerCase()]: sessionToken,
      },
      method,
    );

    expectErrorCode(() => {
      assertRequestAuthorized(request, { allowLan: false, sessionToken });
    }, ERROR_CODES.ORIGIN_NOT_ALLOWED);
  });

  it("rejects missing and incorrect tokens before origin processing", () => {
    const missing = requestWithHeaders({
      host: "localhost:5173",
      origin: "http://localhost:5173",
    });
    const incorrect = requestWithHeaders({
      host: "localhost:5173",
      origin: "http://localhost:5173",
      [SPOTPATCH_TOKEN_HEADER.toLowerCase()]: "wrong",
    });

    expectErrorCode(() => {
      assertRequestAuthorized(missing, { allowLan: false, sessionToken });
    }, ERROR_CODES.INVALID_TOKEN);
    expectErrorCode(() => {
      assertRequestAuthorized(incorrect, { allowLan: false, sessionToken });
    }, ERROR_CODES.INVALID_TOKEN);
  });

  it("rejects non-loopback host and origin while LAN access is disabled", () => {
    const request = requestWithHeaders({
      host: "192.168.1.20:5173",
      origin: "http://192.168.1.20:5173",
      [SPOTPATCH_TOKEN_HEADER.toLowerCase()]: sessionToken,
    });

    expectErrorCode(() => {
      assertRequestAuthorized(request, { allowLan: false, sessionToken });
    }, ERROR_CODES.ORIGIN_NOT_ALLOWED);
  });

  it("allows a matching LAN origin only when explicitly enabled", () => {
    const matching = requestWithHeaders({
      host: "192.168.1.20:5173",
      origin: "http://192.168.1.20:5173",
      [SPOTPATCH_TOKEN_HEADER.toLowerCase()]: sessionToken,
    });
    const foreign = requestWithHeaders({
      host: "192.168.1.20:5173",
      origin: "http://evil.example:5173",
      [SPOTPATCH_TOKEN_HEADER.toLowerCase()]: sessionToken,
    });

    expect(() => {
      assertRequestAuthorized(matching, { allowLan: true, sessionToken });
    }).not.toThrow();
    expectErrorCode(() => {
      assertRequestAuthorized(foreign, { allowLan: true, sessionToken });
    }, ERROR_CODES.ORIGIN_NOT_ALLOWED);
  });
});
