import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createStaticDataFlowAnalyzer } from "@spotpatch/analyzer";
import { createDataFlowSourceVersion } from "@spotpatch/compiler";
import { transform } from "@astrojs/compiler-rs";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

import { injectAstroSourceMarkers } from "./astro-source-markers.js";
import { projectAstroSource } from "./source-projections.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Astro native data-flow scopes", () => {
  it("does not turn adjacent template expressions into invented calls", () => {
    const code =
      '---\nconst value = 1\n---\n{value}{fetch("/adjacent")}\n{fetch("/next-line")}';
    const scopes = projectAstroSource("/app/Page.astro", code) ?? [];
    expect(scopes).toHaveLength(3);
    for (const scope of scopes) {
      const source = ts.createSourceFile(
        "Page.tsx",
        scope.code,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const calls: string[] = [];
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) calls.push(node.expression.getText(source));
        ts.forEachChild(node, visit);
      };
      visit(source);
      expect(calls.every((callee) => callee === "fetch")).toBe(true);
    }
  });
  it("retains UTF-16 offsets and CRLF without sharing frontmatter or script bindings", () => {
    const code =
      '---\r\nconst endpoint="/server"; // 中文😀\r\n---\r\n<button>Go</button><script>const endpoint="/browser";fetch(endpoint)</script><script>fetch(endpoint)</script>';
    const scopes = projectAstroSource("/app/Page.astro", code);
    expect(scopes).toHaveLength(3);
    for (const scope of scopes ?? []) {
      expect(scope.code.length).toBe(code.length);
      expect([...scope.code.matchAll(/\r\n/gu)].map((match) => match.index)).toEqual(
        [...code.matchAll(/\r\n/gu)].map((match) => match.index),
      );
    }
    expect(scopes?.[0]?.code).not.toContain("/browser");
    expect(scopes?.[1]?.code.indexOf("fetch(endpoint)")).toBe(
      code.indexOf("fetch(endpoint)"),
    );
    expect(scopes?.[2]?.code).not.toContain("const endpoint");
  });

  it("traces server, browser module, DOM events and imported helpers to original files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotpatch-astro-data-flow-"));
    roots.push(root);
    const file = path.join(root, "Page.astro");
    const code =
      '---\nconst endpoint="/server"; await fetch(endpoint);\n---\n<button>Go</button>\n<script>\nimport { load } from "./api";\nconst endpoint="/browser"; fetch(endpoint);\ndocument.addEventListener("click", () => { load(); });\n</script>';
    await writeFile(file, code);
    await writeFile(
      path.join(root, "api.ts"),
      'export function load() { return fetch("/imported"); }',
    );
    const analyzer = createStaticDataFlowAnalyzer({
      root,
      registryEpoch: "fixture",
      registerSource: (source) => path.basename(source),
      projectSource: projectAstroSource,
    });
    const report = analyzer.analyzeComponent({
      absolutePath: file,
      line: 4,
      column: 1,
    });
    expect(report.completeness.complete).toBe(true);
    expect(report.dependencies).toMatchObject([
      {
        url: { pathname: "/server" },
        environment: "server",
        execution: "declared-not-observed",
      },
      {
        url: { pathname: "/browser" },
        environment: "client",
      },
      {
        url: { pathname: "/imported" },
        environment: "client",
      },
    ]);
    expect(
      report.evidence.find((entry) => entry.source?.line === 7)?.source?.sourceVersion,
    ).toBe(createDataFlowSourceVersion(code));
    const injected = injectAstroSourceMarkers({
      code,
      root,
      absolutePath: file,
      fileId: "file",
      dataFlow: { helperModule: "virtual:test-data-flow" },
    });
    expect(injected?.dataFlow?.sourceVersion).toBe(createDataFlowSourceVersion(code));
    const browserRequest = report.dependencies.find(
      (dependency) => dependency.url?.pathname === "/browser",
    );
    expect(
      injected?.dataFlow?.anchors.some(
        (anchor) => anchor.id === browserRequest?.origin?.requestCallsiteId,
      ),
    ).toBe(true);
    expect(injected?.code.slice(0, code.indexOf("<button>"))).toBe(
      code.slice(0, code.indexOf("<button>")),
    );
    expect(injected?.code).toContain('from "virtual:test-data-flow"');
    expect(transform(injected?.code ?? "", { filename: file })).toHaveProperty("code");
  });

  it("does not turn inline scripts into modules or touch styles", () => {
    const code =
      '<button>Go</button><script is:inline>fetch("/inline")</script><style>button{color:red}</style>';
    const result = injectAstroSourceMarkers({
      code,
      root: "/app",
      absolutePath: "/app/Page.astro",
      fileId: "file",
      dataFlow: { helperModule: "virtual:test" },
    });
    expect(result?.code).toContain('<script is:inline>fetch("/inline")</script>');
    expect(result?.code).not.toContain("virtual:test");
  });
});
