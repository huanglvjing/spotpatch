import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createSourceRegistry, resolveOptions } from "@spotpatch/dev-server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAstroTransform } from "./transform.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "spotpatch-astro-transform-"));
  roots.push(root);
  const registry = createSourceRegistry();
  const warn = vi.fn();
  const plugin = createAstroTransform({
    root,
    registry,
    options: () =>
      resolveOptions({ include: ["**/*.astro"], exclude: ["**/excluded/**"] }),
  });
  const hook = plugin.transform;
  if (hook === undefined || typeof hook === "function")
    throw new Error("Expected ordered transform hook.");
  const run = (code: string, id: string) =>
    hook.handler.call(
      { warn } as unknown as ThisParameterType<typeof hook.handler>,
      code,
      id,
    );
  const file = path.join(root, "Card.astro");
  await writeFile(file, "<button>Hi</button>");
  return { root, registry, warn, plugin, run, file };
}

describe("Astro transform boundary", () => {
  it("runs before Astro, keeps stable IDs, and refreshes original coordinates", async () => {
    const f = await fixture();
    expect(f.plugin.enforce).toBe("pre");
    expect(f.plugin.transform).toMatchObject({ order: "pre" });
    const result = await f.run("<button>Hi</button>", f.file);
    if (typeof result !== "object" || result === null)
      throw new Error("Expected source transform.");
    expect(result.code).toContain(":1:1:astro");
    const id = f.registry.findRegisteredId(await realpath(f.file));
    expect(id).toBeDefined();
    if (id === undefined) throw new Error("Expected registered source.");
    const updated = await f.run("\n<button>Hi</button>", f.file);
    if (typeof updated !== "object" || updated === null)
      throw new Error("Expected updated source.");
    expect(updated.code).toContain(`${id}:2:1:astro`);
  });

  it("skips queries, virtual IDs, exclusions, generated paths and outside roots", async () => {
    const f = await fixture();
    for (const id of [
      `${f.file}?astro&type=script`,
      `\0${f.file}`,
      path.join(f.root, "excluded/Card.astro"),
      path.join(f.root, "node_modules/Card.astro"),
      path.join(f.root, ".astro/Card.astro"),
      path.join(f.root, "dist/Card.astro"),
      path.join(f.root, "Card.tsx"),
      path.join(f.root, "../Outside.astro"),
    ]) {
      expect(await f.run("<div/>", id)).toBeNull();
      expect(f.registry.findRegisteredId(id)).toBeUndefined();
    }
    expect(f.warn).not.toHaveBeenCalled();
  });

  it("fails open once per malformed file and rejects symlink escapes", async () => {
    const f = await fixture();
    expect(await f.run("<div title={", f.file)).toBeNull();
    expect(await f.run("<div title={", f.file)).toBeNull();
    expect(f.warn).toHaveBeenCalledOnce();
    const nested = path.join(f.root, "nested");
    await mkdir(nested);
    const link = path.join(nested, "Escape.astro");
    await symlink(f.file, link);
    const registry = createSourceRegistry();
    const plugin = createAstroTransform({
      root: nested,
      registry,
      options: () => resolveOptions({ include: ["**/*.astro"] }),
    });
    if (plugin.transform === undefined || typeof plugin.transform === "function")
      throw new Error("Expected transform.");
    expect(
      await plugin.transform.handler.call(
        { warn: f.warn } as unknown as ThisParameterType<
          typeof plugin.transform.handler
        >,
        "<div/>",
        link,
      ),
    ).toBeNull();
    expect(registry.findRegisteredId(f.file)).toBeUndefined();
  });
});
