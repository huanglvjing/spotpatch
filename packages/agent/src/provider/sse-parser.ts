import { ERROR_CODES, SpotPatchError } from "@spotpatch/shared";

export interface SseEvent {
  readonly event?: string;
  readonly data: string;
}

interface ReadSseOptions {
  readonly firstByteTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly maxBytes: number;
  readonly signal: AbortSignal;
}

function providerProtocolError(): SpotPatchError {
  return new SpotPatchError(ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED);
}

function parseEventBlock(block: string): SseEvent | undefined {
  let event: string | undefined;
  const data: string[] = [];

  const normalizedBlock = block.replaceAll("\r\n", "\n").replaceAll("\r", "\n");

  for (const line of normalizedBlock.split("\n")) {
    if (line.length === 0 || line.startsWith(":")) {
      continue;
    }

    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const rawValue = separator === -1 ? "" : line.slice(separator + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

    if (field === "event") {
      event = value;
    } else if (field === "data") {
      data.push(value);
    }
  }

  if (data.length === 0) {
    return undefined;
  }

  return Object.freeze({
    ...(event === undefined || event.length === 0 ? {} : { event }),
    data: data.join("\n"),
  });
}

function lineBreakLengthAt(value: string, index: number): number {
  const character = value[index];

  if (character === "\n") {
    return 1;
  }

  if (character === "\r") {
    return value[index + 1] === "\n" ? 2 : 1;
  }

  return 0;
}

function findEventBoundary(
  buffer: string,
): Readonly<{ index: number; length: number }> | undefined {
  for (let index = 0; index < buffer.length; index += 1) {
    const firstLength = lineBreakLengthAt(buffer, index);

    if (firstLength === 0) {
      continue;
    }

    const secondLength = lineBreakLengthAt(buffer, index + firstLength);

    if (secondLength > 0) {
      return Object.freeze({
        index,
        length: firstLength + secondLength,
      });
    }

    index += firstLength - 1;
  }

  return undefined;
}

async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) {
    throw new SpotPatchError(ERROR_CODES.AGENT_CANCELLED);
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;

  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(providerProtocolError());
        }, timeoutMs);
        abortListener = () => {
          reject(new SpotPatchError(ERROR_CODES.AGENT_CANCELLED));
        };
        signal.addEventListener("abort", abortListener, { once: true });
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }

    if (abortListener !== undefined) {
      signal.removeEventListener("abort", abortListener);
    }
  }
}

export async function readSseEvents(
  stream: ReadableStream<Uint8Array> | null,
  options: ReadSseOptions,
): Promise<readonly SseEvent[]> {
  if (stream === null) {
    throw providerProtocolError();
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const events: SseEvent[] = [];
  let buffer = "";
  let bytes = 0;
  let firstRead = true;

  try {
    for (;;) {
      const result = await readWithTimeout(
        reader,
        firstRead ? options.firstByteTimeoutMs : options.idleTimeoutMs,
        options.signal,
      );
      firstRead = false;

      if (result.done) {
        buffer += decoder.decode();
        break;
      }

      bytes += result.value.byteLength;

      if (bytes > options.maxBytes) {
        throw new SpotPatchError(ERROR_CODES.AGENT_LIMIT_EXCEEDED);
      }

      buffer += decoder.decode(result.value, { stream: true });

      let boundary = findEventBoundary(buffer);

      while (boundary !== undefined) {
        const event = parseEventBlock(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary.length);

        if (event !== undefined) {
          events.push(event);
        }

        boundary = findEventBoundary(buffer);
      }
    }

    const trailing = parseEventBlock(buffer);

    if (trailing !== undefined) {
      events.push(trailing);
    }

    return Object.freeze(events);
  } catch (error: unknown) {
    await reader.cancel().catch(() => undefined);

    if (error instanceof SpotPatchError) {
      throw error;
    }

    throw providerProtocolError();
  } finally {
    reader.releaseLock();
  }
}
