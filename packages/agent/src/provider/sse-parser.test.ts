import { describe, expect, it } from "vitest";

import { DEFAULT_AGENT_LIMITS, ERROR_CODES } from "@spotpatch/shared";

import { readSseEvents } from "./sse-parser.js";

const encoder = new TextEncoder();

function streamBytes(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }

      controller.close();
    },
  });
}

function options(
  overrides: Partial<{
    firstByteTimeoutMs: number;
    idleTimeoutMs: number;
    maxBytes: number;
    signal: AbortSignal;
  }> = {},
) {
  return {
    firstByteTimeoutMs: DEFAULT_AGENT_LIMITS.providerFirstByteTimeoutMs,
    idleTimeoutMs: DEFAULT_AGENT_LIMITS.providerIdleTimeoutMs,
    maxBytes: DEFAULT_AGENT_LIMITS.maxProviderResponseBytes,
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe("SSE parser", () => {
  it("preserves CRLF boundaries split across chunks and UTF-8 byte boundaries", async () => {
    const source =
      ': keepalive\r\nevent: response.output_text.delta\r\ndata: {"delta":"你"}\r\n\r\n' +
      "data: first\ndata: second\n\n";
    const bytes = encoder.encode(source);
    const chineseStart = source.indexOf("你");
    const prefixBytes = encoder.encode(source.slice(0, chineseStart)).byteLength;
    const chunks = [
      bytes.slice(0, 12),
      bytes.slice(12, prefixBytes + 1),
      bytes.slice(prefixBytes + 1, prefixBytes + 2),
      bytes.slice(prefixBytes + 2, prefixBytes + 5),
      bytes.slice(prefixBytes + 5),
    ];

    await expect(readSseEvents(streamBytes(chunks), options())).resolves.toEqual([
      {
        event: "response.output_text.delta",
        data: '{"delta":"你"}',
      },
      { data: "first\nsecond" },
    ]);
  });

  it("does not treat a split CRLF line ending as an empty event boundary", async () => {
    const chunks = [
      encoder.encode("data: one\r"),
      encoder.encode("\ndata: two\r\n\r\n"),
    ];

    await expect(readSseEvents(streamBytes(chunks), options())).resolves.toEqual([
      { data: "one\ntwo" },
    ]);
  });

  it("rejects missing, oversized, aborted, and stalled streams", async () => {
    await expect(readSseEvents(null, options())).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED,
    });
    await expect(
      readSseEvents(
        streamBytes([encoder.encode("data: too-large\n\n")]),
        options({ maxBytes: 2 }),
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.AGENT_LIMIT_EXCEEDED });

    const aborted = new AbortController();
    aborted.abort();
    await expect(
      readSseEvents(streamBytes([]), options({ signal: aborted.signal })),
    ).rejects.toMatchObject({ code: ERROR_CODES.AGENT_CANCELLED });

    const stalled = new ReadableStream<Uint8Array>({
      start(controller) {
        void controller;
      },
    });
    await expect(
      readSseEvents(stalled, options({ firstByteTimeoutMs: 5 })),
    ).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED,
    });
  });

  it("normalizes an underlying stream failure without exposing its message", async () => {
    const secret = "synthetic-reader-secret-do-not-use";
    const failed = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error(secret));
      },
    });

    let error: unknown;

    try {
      await readSseEvents(failed, options());
    } catch (caught: unknown) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED,
    });
    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
  });
});
