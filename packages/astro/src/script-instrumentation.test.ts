import vm from "node:vm";

import { createDataFlowRuntime } from "@spotpatch/runtime/data-flow";
import { DEFAULT_RUNTIME_DATA_FLOW_LIMITS } from "@spotpatch/shared";
import ts from "typescript";
import { expect, it, vi } from "vitest";

import { injectAstroSourceMarkers } from "./astro-source-markers.js";
import { projectAstroSource } from "./source-projections.js";

it("preserves native listener identity, return values and fetch promises", () => {
  const code = `<button>Go</button><script>
const target = document;
function listener() { globalThis.promise = fetch("/event"); }
target.addEventListener("fixture", listener);
target.dispatchEvent(new Event("fixture"));
target.removeEventListener("fixture", listener);
target.dispatchEvent(new Event("fixture"));
globalThis.direct = fetch("/module");
</script>`;
  const result = injectAstroSourceMarkers({
    code,
    root: "/app",
    absolutePath: "/app/Page.astro",
    fileId: "file",
    dataFlow: { helperModule: "virtual:test" },
  });
  if (result === undefined) throw new Error("Expected native instrumentation");
  const script = projectAstroSource("/app/Page.astro", result.code)?.find(
    (scope) => scope.environment === "client",
  );
  if (script === undefined) throw new Error("Expected browser script");
  const expected = Promise.resolve(new Response(null, { status: 204 }));
  const originalFetch = vi.fn<typeof fetch>(() => expected);
  const target = {
    fetch: originalFetch,
    location: { href: "https://fixture.test/" } as Location,
    performance: { now: () => 1 } as Performance,
  };
  const runtime = createDataFlowRuntime(
    { enabled: true, runtime: "dispatch", limits: DEFAULT_RUNTIME_DATA_FLOW_LIMITS },
    target,
  );
  const executable = ts.transpileModule(
    script.code.replace(
      'import { dataFlowRuntime as __spotpatchDataFlow } from "virtual:test";',
      "const __spotpatchDataFlow = runtime;",
    ),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  const context: Record<string, unknown> = {
    runtime,
    document: new EventTarget(),
    Event,
    fetch: target.fetch,
  };
  try {
    vm.runInContext(executable, vm.createContext(context));
    expect(originalFetch).toHaveBeenCalledTimes(2);
    expect(context.promise).toBe(expected);
    expect(context.direct).toBe(expected);
    expect(runtime.observations()).toMatchObject([
      { url: { pathname: "/event" } },
      { url: { pathname: "/module" } },
    ]);
    const [event, module] = runtime.observations();
    expect(event?.componentSourceId).toBe(module?.componentSourceId);
    expect(event?.triggerCallsiteId).not.toBe(module?.triggerCallsiteId);
  } finally {
    runtime.dispose();
  }
});
