import { readFile, stat } from "node:fs/promises";

import { ERROR_CODES, SpotPatchError } from "@spotpatch/shared";

import { resolveExistingAgentPath } from "./path-policy.js";

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

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
    throw new SpotPatchError(ERROR_CODES.TOOL_DENIED);
  }

  let content: string;

  try {
    content = utf8Decoder.decode(bytes);
  } catch {
    throw new SpotPatchError(ERROR_CODES.TOOL_DENIED);
  }

  return Object.freeze({ content, relativePath, size: metadata.size });
}
