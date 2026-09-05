import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ERROR_CODES } from "@spotpatch/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyBridgeSetupPlan, createBridgeSetupPlan } from "./setup.js";

async function expectPrivateFile(filePath: string): Promise<void> {
  if (process.platform === "win32") return;
  expect((await stat(filePath)).mode & 0o777).toBe(0o600);
}

describe("external Agent project setup", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "spotpatch-bridge-setup-"));
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it("creates a private project configuration and is idempotent", async () => {
    const plan = createBridgeSetupPlan("cursor", "vite", root);

    await expect(applyBridgeSetupPlan(plan)).resolves.toBe("created");
    await expect(applyBridgeSetupPlan(plan)).resolves.toBe("unchanged");
    await expectPrivateFile(plan.path);
    expect(JSON.parse(await readFile(plan.path, "utf8"))).toMatchObject({
      mcpServers: {
        spotpatch: {
          command: "node",
          args: ["./node_modules/@spotpatch/vite/dist/cli.js", "bridge", "mcp"],
        },
      },
    });
  });

  it("uses the Astro adapter CLI for Inbox and active connectors", () => {
    for (const client of ["codex", "claude", "cursor"] as const) {
      const plan = createBridgeSetupPlan(client, "astro", root);
      expect(plan.content).toContain("./node_modules/@spotpatch/astro/dist/cli.js");
      expect(plan.content).not.toContain("@spotpatch/vite");
      expect(plan.content).not.toContain("@spotpatch/next");
    }
    const active = createBridgeSetupPlan("claude", "astro", root, "active");
    expect(JSON.parse(active.content)).toMatchObject({
      mcpServers: {
        spotpatch: {
          args: [
            "./node_modules/@spotpatch/astro/dist/cli.js",
            "bridge",
            "channel",
            "claude",
          ],
        },
      },
    });
  });

  it("whitelists only runtime-directory inputs in Codex MCP setup", () => {
    const plan = createBridgeSetupPlan("codex", "next", root);

    expect(plan.content).toContain(
      'env_vars = ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"]',
    );
    expect(plan.content).not.toContain("HOME");
    expect(plan.content).not.toContain("PATH");
    expect(plan.content).not.toContain("TOKEN");
    expect(createBridgeSetupPlan("claude", "next", root).content).not.toContain(
      "env_vars",
    );
    expect(createBridgeSetupPlan("cursor", "next", root).content).not.toContain(
      "env_vars",
    );
  });

  it("migrates only the exact previously generated Codex Inbox configuration", async () => {
    const plan = createBridgeSetupPlan("codex", "next", root);
    if (plan.legacyCodexContent === undefined) {
      throw new Error("Expected a generated legacy Codex configuration.");
    }
    await mkdir(path.dirname(plan.path), { recursive: true });
    await writeFile(plan.path, plan.legacyCodexContent, { mode: 0o600 });

    await expect(applyBridgeSetupPlan(plan)).resolves.toBe("updated");
    await expect(applyBridgeSetupPlan(plan)).resolves.toBe("unchanged");
    expect(await readFile(plan.path, "utf8")).toBe(plan.content);
    expect(await readFile(`${plan.path}.spotpatch.bak`, "utf8")).toBe(
      plan.legacyCodexContent,
    );
  });

  it("creates Claude active setup and only migrates the exact generated inbox entry", async () => {
    const inbox = createBridgeSetupPlan("claude", "next", root);
    await expect(applyBridgeSetupPlan(inbox)).resolves.toBe("created");
    const active = createBridgeSetupPlan("claude", "next", root, "active");

    await expect(applyBridgeSetupPlan(active)).resolves.toBe("updated");
    await expect(applyBridgeSetupPlan(active)).resolves.toBe("unchanged");
    expect(JSON.parse(await readFile(active.path, "utf8"))).toMatchObject({
      mcpServers: {
        spotpatch: {
          command: "node",
          args: [
            "./node_modules/@spotpatch/next/dist/cli.js",
            "bridge",
            "channel",
            "claude",
          ],
        },
      },
    });
    expect(await readFile(`${active.path}.spotpatch.bak`, "utf8")).toBe(inbox.content);
  });

  it("rejects active setup for clients without an active setup contract", () => {
    expect(() => createBridgeSetupPlan("cursor", "vite", root, "active")).toThrow();
    expect(() => createBridgeSetupPlan("codex", "vite", root, "active")).toThrow();
  });

  it("preserves other JSON servers and writes a non-overwritten private backup", async () => {
    const plan = createBridgeSetupPlan("claude", "next", root);
    const existing = `${JSON.stringify({
      mcpServers: {
        existing: { command: "existing-server", env: { API_KEY: "do-not-print" } },
      },
      projectSetting: true,
    })}\n`;
    await writeFile(plan.path, existing, { mode: 0o644 });

    await expect(applyBridgeSetupPlan(plan)).resolves.toBe("updated");
    expect(await readFile(`${plan.path}.spotpatch.bak`, "utf8")).toBe(existing);
    await expectPrivateFile(`${plan.path}.spotpatch.bak`);
    await expectPrivateFile(plan.path);
    expect(JSON.parse(await readFile(plan.path, "utf8"))).toMatchObject({
      mcpServers: {
        existing: { command: "existing-server", env: { API_KEY: "do-not-print" } },
        spotpatch: {
          args: ["./node_modules/@spotpatch/next/dist/cli.js", "bridge", "mcp"],
        },
      },
      projectSetting: true,
    });
  });

  it("refuses conflicts, unsafe backups, and existing TOML without changing input", async () => {
    const claudePlan = createBridgeSetupPlan("claude", "bridge", root);
    const conflict = '{"mcpServers":{"spotpatch":{"command":"other"}}}\n';
    await writeFile(claudePlan.path, conflict, { mode: 0o600 });
    await expect(applyBridgeSetupPlan(claudePlan)).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_REQUEST,
    });
    expect(await readFile(claudePlan.path, "utf8")).toBe(conflict);

    const cursorPlan = createBridgeSetupPlan("cursor", "bridge", root);
    await mkdir(path.dirname(cursorPlan.path), { recursive: true });
    await writeFile(cursorPlan.path, '{"mcpServers":{}}\n', { mode: 0o600 });
    await writeFile(`${cursorPlan.path}.spotpatch.bak`, "foreign", { mode: 0o600 });
    await chmod(`${cursorPlan.path}.spotpatch.bak`, 0o644);
    await expect(applyBridgeSetupPlan(cursorPlan)).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_REQUEST,
    });
    expect(await readFile(cursorPlan.path, "utf8")).toBe('{"mcpServers":{}}\n');

    const codexPlan = createBridgeSetupPlan("codex", "bridge", root);
    await mkdir(path.dirname(codexPlan.path), { recursive: true });
    await writeFile(codexPlan.path, 'model = "gpt-5"\n', { mode: 0o600 });
    await expect(applyBridgeSetupPlan(codexPlan)).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_REQUEST,
    });
    expect(await readFile(codexPlan.path, "utf8")).toBe('model = "gpt-5"\n');
  });

  it.runIf(process.platform !== "win32")(
    "refuses symlinked and oversized existing project configurations",
    async () => {
      const plan = createBridgeSetupPlan("claude", "bridge", root);
      const target = path.join(root, "outside-config.json");
      const original = '{"mcpServers":{}}\n';
      await writeFile(target, original, { mode: 0o600 });
      await symlink(target, plan.path);

      await expect(applyBridgeSetupPlan(plan)).rejects.toMatchObject({
        code: ERROR_CODES.INVALID_REQUEST,
      });
      expect(await readFile(target, "utf8")).toBe(original);

      await rm(plan.path);
      await writeFile(plan.path, "x".repeat(1_024 * 1_024 + 1), { mode: 0o600 });
      await expect(applyBridgeSetupPlan(plan)).rejects.toMatchObject({
        code: ERROR_CODES.INVALID_REQUEST,
      });
    },
  );
});
