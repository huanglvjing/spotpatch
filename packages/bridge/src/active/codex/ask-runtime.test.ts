import { createHash } from "node:crypto";
import { access, chmod, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ContextualAskExecutorInput } from "@spotpatch/agent";
import { describe, expect, it } from "vitest";

import {
  createManagedCodexAskEnvironment,
  createManagedCodexAskProjection,
  managedCodexAskThreadConfig,
} from "./ask-runtime.js";

const CONTENT = "export function Card() {\n  return <article>Card</article>;\n}\n";
const HASH = createHash("sha256").update(CONTENT).digest("hex");

function input(relativePath = "src/Card.tsx"): ContextualAskExecutorInput {
  const source = Object.freeze({
    handleId: "source_handle",
    fileId: "source_file",
    relativePath,
    label: "Card.tsx",
    lineCount: 3,
    size: Buffer.byteLength(CONTENT),
    contentHash: HASH,
    confidence: "exact" as const,
    targetIds: Object.freeze(["target_1"]),
  });
  return {
    jobId: "ask_job",
    envelope: {} as ContextualAskExecutorInput["envelope"],
    grant: {
      contextHash: HASH,
      truncated: false,
      sources: Object.freeze([source]),
    },
    snapshot: {
      manifest: () => Object.freeze([source]),
      read: () => ({
        handleId: source.handleId,
        startLine: 1,
        endLine: 3,
        content: CONTENT,
      }),
      search: () => Object.freeze([]),
    },
  };
}

describe("Managed Codex Ask projection", () => {
  it("materializes only granted content as read-only and removes it on dispose", async () => {
    const projection = await createManagedCodexAskProjection(input());
    const temporaryRoot = path.dirname(projection.workspaceRoot);
    const sourcePath = path.join(projection.workspaceRoot, "src", "Card.tsx");
    try {
      await expect(readFile(sourcePath, "utf8")).resolves.toBe(CONTENT);
      if (process.platform !== "win32") {
        expect((await stat(sourcePath)).mode & 0o777).toBe(0o400);
        expect((await stat(path.dirname(sourcePath))).mode & 0o777).toBe(0o500);
      }
      await projection.verifyUnchanged();
      await chmod(sourcePath, 0o600);
      await writeFile(sourcePath, `${CONTENT}// mutation\n`);
      await expect(projection.verifyUnchanged()).rejects.toMatchObject({
        code: "ASK_WRITE_ATTEMPTED",
      });
    } finally {
      await projection.dispose();
    }
    await expect(access(temporaryRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([".env", ".git/config", "AGENTS.md", "pnpm-lock.yaml"])(
    "rejects sensitive projection path %s",
    async (relativePath) => {
      await expect(
        createManagedCodexAskProjection(input(relativePath)),
      ).rejects.toMatchObject({ code: "ASK_SOURCE_SCOPE_DENIED" });
    },
  );

  it("rejects duplicate handles or projection paths", async () => {
    const value = input();
    const source = value.grant.sources[0];
    if (source === undefined) throw new Error("Expected source fixture.");
    await expect(
      createManagedCodexAskProjection({
        ...value,
        grant: {
          ...value.grant,
          sources: [source, { ...source, handleId: "other_handle" }],
        },
      }),
    ).rejects.toMatchObject({ code: "ASK_SOURCE_SCOPE_DENIED" });
  });

  it("constructs a root-deny, workspace-read, network-disabled profile", () => {
    expect(managedCodexAskThreadConfig()).toMatchObject({
      agents: { enabled: false },
      features: { apps: false, hooks: false, plugins: false },
      mcp_servers: {},
      permissions: {
        "spotpatch-ask-readonly": {
          filesystem: {
            ":root": "deny",
            ":minimal": "read",
            ":workspace_roots": { ".": "read" },
          },
          network: { enabled: false },
        },
      },
      web_search: "disabled",
      shell_environment_policy: {
        inherit: "all",
        filters: { PATH: "include", NODE_ENV: "include" },
      },
    });
  });

  it("forwards only bounded runtime environment fields", () => {
    const environment = createManagedCodexAskEnvironment("/private/codex", {
      PATH: "/bin",
      OPENAI_API_KEY: "must-not-leak",
      SPOTPATCH_TEST_SECRET: "must-not-leak",
    });
    expect(environment).toMatchObject({
      CODEX_HOME: "/private/codex",
      HOME: "/private/codex",
      PATH: "/bin",
      USERPROFILE: "/private/codex",
    });
    expect(environment.OPENAI_API_KEY).toBeUndefined();
    expect(environment.SPOTPATCH_TEST_SECRET).toBeUndefined();
  });
});
