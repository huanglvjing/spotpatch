import { opendir, open } from "node:fs/promises";
import path from "node:path";

import { ERROR_CODES, SpotPatchError } from "@spotpatch/shared";

import {
  assertAgentPathAllowed,
  resolveExistingAgentPath,
} from "../security/path-policy.js";

const MAX_DISCOVERED_FILES = 20_000;
const TEXT_SAMPLE_BYTES = 8_192;

function compileGlob(glob: string): RegExp {
  if (
    glob.length === 0 ||
    glob.length > 256 ||
    glob.includes("\0") ||
    glob.includes("\\") ||
    glob.startsWith("/") ||
    ["[", "]", "{", "}", "(", ")", "!"].some((character) => glob.includes(character)) ||
    glob.split("/").some((segment) => segment === "..")
  ) {
    throw new SpotPatchError(ERROR_CODES.TOOL_DENIED);
  }

  let expression = "^";

  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index] ?? "";

    if (character === "*") {
      const next = glob[index + 1];

      if (next === "*") {
        const following = glob[index + 2];
        index += 1;

        if (following === "/") {
          expression += "(?:.*/)?";
          index += 1;
        } else {
          expression += ".*";
        }
      } else {
        expression += "[^/]*";
      }
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
    }
  }

  return new RegExp(`${expression}$`, "u");
}

async function discoverFiles(
  root: string,
  relativeDirectory: string,
  files: string[],
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted === true) {
    throw new SpotPatchError(ERROR_CODES.AGENT_CANCELLED);
  }

  const directory = await opendir(
    relativeDirectory.length === 0
      ? root
      : path.join(root, ...relativeDirectory.split("/")),
  );

  for await (const entry of directory) {
    const relativePath =
      relativeDirectory.length === 0
        ? entry.name
        : `${relativeDirectory}/${entry.name}`;
    let allowedPath: string;

    try {
      allowedPath = assertAgentPathAllowed(relativePath);
    } catch {
      continue;
    }

    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      await discoverFiles(root, allowedPath, files, signal);
      continue;
    }

    if (entry.isFile()) {
      files.push(allowedPath);

      if (files.length > MAX_DISCOVERED_FILES) {
        throw new SpotPatchError(ERROR_CODES.AGENT_LIMIT_EXCEEDED);
      }
    }
  }
}

async function isTextFile(root: string, relativePath: string): Promise<boolean> {
  const absolutePath = await resolveExistingAgentPath(root, relativePath);
  const handle = await open(absolutePath, "r");

  try {
    const buffer = Buffer.alloc(TEXT_SAMPLE_BYTES);
    const result = await handle.read(buffer, 0, buffer.length, 0);
    const sample = buffer.subarray(0, result.bytesRead);

    if (sample.includes(0)) {
      return false;
    }

    try {
      new TextDecoder("utf-8", { fatal: true }).decode(sample, {
        stream: result.bytesRead === TEXT_SAMPLE_BYTES,
      });
      return true;
    } catch {
      return false;
    }
  } finally {
    await handle.close();
  }
}

export async function listAgentFiles(
  root: string,
  glob: string,
  maximumResults: number,
  signal?: AbortSignal,
): Promise<readonly string[]> {
  const matcher = compileGlob(glob);
  const discovered: string[] = [];
  await discoverFiles(root, "", discovered, signal);
  discovered.sort((left, right) => left.localeCompare(right, "en"));
  const results: string[] = [];

  for (const relativePath of discovered) {
    if (signal?.aborted === true) {
      throw new SpotPatchError(ERROR_CODES.AGENT_CANCELLED);
    }

    if (!matcher.test(relativePath)) {
      continue;
    }

    if (await isTextFile(root, relativePath)) {
      results.push(relativePath);
    }

    if (results.length >= maximumResults) {
      break;
    }
  }

  return Object.freeze(results);
}
