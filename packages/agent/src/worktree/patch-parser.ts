import {
  ERROR_CODES,
  SpotPatchError,
  type AgentFileChangeKind,
} from "@spotpatch/shared";

import { assertAgentPathAllowed } from "../security/path-policy.js";

export interface ParsedPatchFile {
  readonly kind: AgentFileChangeKind;
  readonly relativePath: string;
}

function rejectPatch(): never {
  throw new SpotPatchError(ERROR_CODES.PATCH_REJECTED);
}

function parseDiffHeader(line: string): string {
  if (!line.startsWith("diff --git a/")) {
    return rejectPatch();
  }

  const separator = line.lastIndexOf(" b/");

  if (separator <= "diff --git a/".length) {
    return rejectPatch();
  }

  const left = line.slice("diff --git a/".length, separator);
  const right = line.slice(separator + " b/".length);

  if (left !== right || left.startsWith('"') || right.startsWith('"')) {
    return rejectPatch();
  }

  return assertAgentPathAllowed(left);
}

function parseFileHeader(
  line: string,
  prefix: "--- " | "+++ ",
  expectedPath: string,
): "file" | "null" {
  if (!line.startsWith(prefix)) {
    return rejectPatch();
  }

  const value = line.slice(prefix.length);

  if (value === "/dev/null") {
    return "null";
  }

  const side = prefix === "--- " ? "a/" : "b/";

  if (value !== `${side}${expectedPath}`) {
    return rejectPatch();
  }

  return "file";
}

export function parseUnifiedPatch(patch: string): readonly ParsedPatchFile[] {
  if (
    patch.trim().length === 0 ||
    patch.includes("\0") ||
    patch.includes("GIT binary patch") ||
    patch.includes("Binary files ") ||
    /^(?:rename|copy) (?:from|to) /mu.test(patch) ||
    /^(?:old mode|new mode|similarity index|dissimilarity index) /mu.test(patch) ||
    /^(?:new file mode|deleted file mode) (?!100644$)/mu.test(patch)
  ) {
    return rejectPatch();
  }

  const lines = patch.replaceAll("\r\n", "\n").split("\n");
  const results: ParsedPatchFile[] = [];
  let currentPath: string | undefined;
  let oldHeader: "file" | "null" | undefined;
  let newHeader: "file" | "null" | undefined;

  const finishCurrent = (): void => {
    if (currentPath === undefined) {
      return;
    }

    if (oldHeader === undefined || newHeader === undefined) {
      rejectPatch();
    }

    if (oldHeader === "null" && newHeader === "null") {
      rejectPatch();
    }

    results.push(
      Object.freeze({
        relativePath: currentPath,
        kind:
          oldHeader === "null"
            ? "added"
            : newHeader === "null"
              ? "deleted"
              : "modified",
      }),
    );
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      finishCurrent();
      currentPath = parseDiffHeader(line);
      oldHeader = undefined;
      newHeader = undefined;
      continue;
    }

    if (currentPath === undefined) {
      if (line.length > 0) {
        rejectPatch();
      }

      continue;
    }

    if (oldHeader === undefined && line.startsWith("--- ")) {
      oldHeader = parseFileHeader(line, "--- ", currentPath);
      continue;
    }

    if (oldHeader !== undefined && newHeader === undefined && line.startsWith("+++ ")) {
      newHeader = parseFileHeader(line, "+++ ", currentPath);
    }
  }

  finishCurrent();

  if (results.length === 0) {
    return rejectPatch();
  }

  const uniquePaths = new Set(results.map((result) => result.relativePath));

  if (uniquePaths.size !== results.length) {
    return rejectPatch();
  }

  return Object.freeze(results);
}
