import { opendir, open } from "node:fs/promises";
import path from "node:path";

import { ERROR_CODES, SpotPatchError } from "@spotpatch/shared";

import {
  assertAgentPathAllowed,
  resolveExistingAgentPath,
} from "../security/path-policy.js";

const MAX_DISCOVERED_FILES = 20_000;
const TEXT_SAMPLE_BYTES = 8_192;
const TEXT_CLASSIFICATION_CONCURRENCY = 16;

export interface AgentFileCatalog {
  readonly invalidate: () => void;
  readonly list: (
    glob: string,
    maximumResults: number,
    signal?: AbortSignal,
  ) => Promise<readonly string[]>;
}

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
    throw new SpotPatchError(ERROR_CODES.TOOL_ARGUMENTS_INVALID);
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

export function createAgentFileCatalog(root: string): AgentFileCatalog {
  let discoveredFiles: Promise<readonly string[]> | undefined;
  const textFiles = new Map<string, Promise<boolean>>();

  const discover = (signal?: AbortSignal): Promise<readonly string[]> => {
    discoveredFiles ??= (async () => {
      const files: string[] = [];
      await discoverFiles(root, "", files, signal);
      files.sort((left, right) => left.localeCompare(right, "en"));
      return Object.freeze(files);
    })();
    return discoveredFiles;
  };

  const classify = (relativePath: string): Promise<boolean> => {
    const cached = textFiles.get(relativePath);

    if (cached !== undefined) {
      return cached;
    }

    const pending = isTextFile(root, relativePath);
    textFiles.set(relativePath, pending);
    return pending;
  };

  return Object.freeze({
    invalidate(): void {
      discoveredFiles = undefined;
      textFiles.clear();
    },
    async list(
      glob: string,
      maximumResults: number,
      signal?: AbortSignal,
    ): Promise<readonly string[]> {
      const matcher = compileGlob(glob);
      const candidates = (await discover(signal)).filter((relativePath) =>
        matcher.test(relativePath),
      );
      const results: string[] = [];

      for (
        let offset = 0;
        offset < candidates.length;
        offset += TEXT_CLASSIFICATION_CONCURRENCY
      ) {
        if (signal?.aborted === true) {
          throw new SpotPatchError(ERROR_CODES.AGENT_CANCELLED);
        }

        const batch = candidates.slice(
          offset,
          offset + TEXT_CLASSIFICATION_CONCURRENCY,
        );
        const classifications = await Promise.all(batch.map(classify));

        for (const [index, relativePath] of batch.entries()) {
          if (classifications[index] === true) {
            results.push(relativePath);
          }

          if (results.length >= maximumResults) {
            return Object.freeze(results);
          }
        }
      }

      return Object.freeze(results);
    },
  });
}
