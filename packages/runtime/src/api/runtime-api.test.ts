import {
  SPOTPATCH_API_BASE,
  SPOTPATCH_ENDPOINTS,
  SPOTPATCH_TOKEN_HEADER,
  type CodeContext,
} from "@spotpatch/shared";
import { describe, expect, it, vi } from "vitest";

import { createRuntimeApi } from "./runtime-api.js";

const codeContext = Object.freeze({
  relativePath: "src/App.tsx",
  language: "tsx",
  startLine: 1,
  endLine: 20,
  excerpt: "export function App() {}",
  boundary: "component",
}) satisfies CodeContext;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("runtime API client", () => {
  it("uses shared endpoints and sends the token only in the request header", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ ok: true, data: codeContext }));
    const api = createRuntimeApi({
      apiBase: SPOTPATCH_API_BASE,
      fetch: fetchMock,
      sessionToken: "session-secret",
    });

    await expect(
      api.sourceContext({ fileId: "file-id", line: 4, column: 2, maxLines: 20 }),
    ).resolves.toEqual(codeContext);

    expect(fetchMock).toHaveBeenCalledWith(
      SPOTPATCH_ENDPOINTS.sourceContext,
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [SPOTPATCH_TOKEN_HEADER]: "session-secret",
        },
      }),
    );
    const requestBody = fetchMock.mock.calls[0]?.[1]?.body;
    expect(requestBody).toBeTypeOf("string");
    expect(requestBody).not.toContain("session-secret");
  });

  it("rejects non-success and malformed envelopes without exposing server text", async () => {
    const failureFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(
          { ok: false, error: { code: "INTERNAL_ERROR", message: "/private/path" } },
          500,
        ),
      );
    const malformedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ ok: true, data: { excerpt: 42 } }));
    const request = { fileId: "file-id", line: 1, column: 1, maxLines: 20 };

    await expect(
      createRuntimeApi({
        apiBase: SPOTPATCH_API_BASE,
        fetch: failureFetch,
        sessionToken: "token",
      }).sourceContext(request),
    ).rejects.not.toThrow("/private/path");
    await expect(
      createRuntimeApi({
        apiBase: SPOTPATCH_API_BASE,
        fetch: malformedFetch,
        sessionToken: "token",
      }).sourceContext(request),
    ).rejects.toThrow("response is invalid");
  });

  it("aborts every unfinished request during cancellation", async () => {
    let observedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      observedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        observedSignal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    const api = createRuntimeApi({
      apiBase: SPOTPATCH_API_BASE,
      fetch: fetchMock,
      sessionToken: "token",
    });
    const pending = api.openEditor({ fileId: "file-id", line: 1, column: 1 });

    api.cancelPending();

    expect(observedSignal?.aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
