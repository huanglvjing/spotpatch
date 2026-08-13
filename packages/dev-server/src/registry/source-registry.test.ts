import path from "node:path";

import { describe, expect, it } from "vitest";

import { createSourceRegistry } from "./source-registry.js";

describe("source registry", () => {
  it("keeps an ID stable for the same normalized path", () => {
    let sequence = 0;
    const registry = createSourceRegistry({
      createId: () => `id-${String(++sequence)}`,
    });
    const source = path.join(process.cwd(), "src", "App.tsx");

    expect(registry.register(source)).toBe("id-1");
    expect(registry.register(path.join(process.cwd(), "src", ".", "App.tsx"))).toBe(
      "id-1",
    );
  });

  it("resolves different files to different IDs and clears the session", () => {
    let sequence = 0;
    const registry = createSourceRegistry({
      createId: () => `id-${String(++sequence)}`,
    });
    const firstPath = path.join(process.cwd(), "src", "First.tsx");
    const secondPath = path.join(process.cwd(), "src", "Second.tsx");
    const firstId = registry.register(firstPath);
    const secondId = registry.register(secondPath);

    expect(firstId).not.toBe(secondId);
    expect(registry.resolve(firstId)).toBe(path.normalize(firstPath));
    expect(registry.resolve("missing")).toBeUndefined();

    registry.clear();
    expect(registry.resolve(firstId)).toBeUndefined();
  });

  it("retries a generated ID collision", () => {
    const ids = ["same-id", "same-id", "next-id"];
    const registry = createSourceRegistry({
      createId: () => ids.shift() ?? "fallback-id",
    });

    expect(registry.register("/root/first.tsx")).toBe("same-id");
    expect(registry.register("/root/second.tsx")).toBe("next-id");
  });

  it("replaces component anchors atomically when a source version changes", () => {
    const registry = createSourceRegistry({ createId: () => "file-id" });
    const source = "/root/App.tsx";

    registry.registerDataFlowComponents(source, "source_first", [
      { componentSourceId: "component_first", line: 3, column: 1 },
    ]);
    expect(registry.resolveDataFlowComponent("component_first")).toEqual({
      componentSourceId: "component_first",
      fileId: "file-id",
      line: 3,
      column: 1,
      sourceVersion: "source_first",
    });

    registry.registerDataFlowComponents(source, "source_second", [
      { componentSourceId: "component_second", line: 4, column: 2 },
    ]);
    expect(registry.resolveDataFlowComponent("component_first")).toBeUndefined();
    expect(registry.resolveDataFlowComponent("component_second")?.sourceVersion).toBe(
      "source_second",
    );
  });
});
