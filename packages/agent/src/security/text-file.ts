import { randomUUID } from "node:crypto";
import { open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import { ERROR_CODES, SpotPatchError } from "@spotpatch/shared";

import { resolveExistingAgentPath } from "./path-policy.js";

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const UTF8_BYTE_ORDER_MARK = Buffer.from([0xef, 0xbb, 0xbf]);

export interface ReadTextFileResult {
  readonly content: string;
  readonly relativePath: string;
  readonly size: number;
}

export async function readAgentTextFile(
  root: string,
  relativePath: string,
  maximumBytes: number,
): Promise<ReadTextFileResult> {
  const absolutePath = await resolveExistingAgentPath(root, relativePath);
  const metadata = await stat(absolutePath);

  if (metadata.size > maximumBytes) {
    throw new SpotPatchError(ERROR_CODES.AGENT_LIMIT_EXCEEDED);
  }

  const bytes = await readFile(absolutePath);

  if (bytes.includes(0)) {
    throw new SpotPatchError(ERROR_CODES.TOOL_PATH_DENIED);
  }

  let content: string;

  try {
    content = utf8Decoder.decode(bytes);
  } catch {
    throw new SpotPatchError(ERROR_CODES.TOOL_PATH_DENIED);
  }

  return Object.freeze({ content, relativePath, size: metadata.size });
}

function hasUtf8ByteOrderMark(bytes: Buffer): boolean {
  return (
    bytes.length >= UTF8_BYTE_ORDER_MARK.length &&
    bytes.subarray(0, UTF8_BYTE_ORDER_MARK.length).equals(UTF8_BYTE_ORDER_MARK)
  );
}

function encodeUtf8Text(content: string, includeByteOrderMark: boolean): Buffer {
  const encoded = Buffer.from(content, "utf8");
  return includeByteOrderMark
    ? Buffer.concat([UTF8_BYTE_ORDER_MARK, encoded])
    : encoded;
}

export async function writeAgentTextFileIfContentMatches(
  root: string,
  relativePath: string,
  expectedContent: string,
  nextContent: string,
  maximumBytes: number,
): Promise<void> {
  if (nextContent.includes("\0")) {
    throw new SpotPatchError(ERROR_CODES.TOOL_INPUT_INVALID);
  }

  const absolutePath = await resolveExistingAgentPath(root, relativePath);
  const [metadata, currentBytes] = await Promise.all([
    stat(absolutePath),
    readFile(absolutePath),
  ]);

  if (metadata.size > maximumBytes) {
    throw new SpotPatchError(ERROR_CODES.AGENT_LIMIT_EXCEEDED);
  }

  let currentContent: string;

  try {
    currentContent = utf8Decoder.decode(currentBytes);
  } catch {
    throw new SpotPatchError(ERROR_CODES.TOOL_PATH_DENIED);
  }

  if (currentBytes.includes(0) || currentContent !== expectedContent) {
    throw new SpotPatchError(ERROR_CODES.PATCH_REJECTED);
  }

  const nextBytes = encodeUtf8Text(nextContent, hasUtf8ByteOrderMark(currentBytes));

  if (nextBytes.length > maximumBytes) {
    throw new SpotPatchError(ERROR_CODES.AGENT_LIMIT_EXCEEDED);
  }

  const temporaryPath = path.join(
    path.dirname(absolutePath),
    `.spotpatch-agent-edit-${randomUUID()}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    handle = await open(temporaryPath, "wx", metadata.mode & 0o777);
    await handle.writeFile(nextBytes);
    await handle.sync();
    await handle.close();
    handle = undefined;

    const currentAbsolutePath = await resolveExistingAgentPath(root, relativePath);
    const bytesBeforeRename = await readFile(currentAbsolutePath);

    if (
      currentAbsolutePath !== absolutePath ||
      !bytesBeforeRename.equals(currentBytes)
    ) {
      throw new SpotPatchError(ERROR_CODES.PATCH_REJECTED);
    }

    await rename(temporaryPath, absolutePath);
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}
