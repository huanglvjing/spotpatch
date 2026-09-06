import vm from "node:vm";

import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

import { injectSourceMarkers } from "./inject-source-markers.js";

const root = "/project";
const absolutePath = "/project/src/Login.tsx";

function transform(code: string) {
  return injectSourceMarkers({
    absolutePath,
    code,
    fileId: "file-login",
    root,
    dataFlow: { helperModule: "virtual:spotpatch/data-flow-runtime" },
  });
}

describe("data-flow instrumentation", () => {
  it.each([
    "(await Promise.resolve(receiver)).json()",
    'receiver[await Promise.resolve("json")]()',
    "(await Promise.resolve(() => receiver.json()))()",
    'receiver.get(await Promise.resolve("argument"))',
    "(await Promise.resolve(receiver)).get()",
    "(await (await Promise.resolve({ response: async () => receiver })).response()).json()",
    "(await Promise.resolve(receiver))?.json()",
    'receiver[await Promise.resolve("get")]()',
    'receiver.json(await Promise.resolve("argument"))',
  ])("preserves suspended call evaluation: %s", async (expression) => {
    const code = `async function run() {
      const receiver = {
        value: 42,
        json() { return this.value; },
        get() { return this.value; }
      };
      return ${expression};
    }
    globalThis.result = run();`;
    const transformed = transform(code);
    expect(transformed).toBeDefined();
    if (transformed === undefined) throw new Error("Expected instrumentation");
    expect(transformed.dataFlow?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "DATA_FLOW_UNSAFE_CALL_UNSUPPORTED" }),
      ]),
    );
    const runtime = {
      captureInvocation: () => undefined,
      withInvocation: (_token: unknown, callback: () => unknown) => callback(),
      withRequestFrame: (
        _token: unknown,
        _metadata: unknown,
        callback: () => unknown,
      ) => callback(),
    };
    for (const source of [code, transformed.code]) {
      const executable = ts.transpileModule(
        source.replace(
          /import \{ dataFlowRuntime as __spotpatchDataFlow \} from "virtual:spotpatch\/data-flow-runtime";\n/u,
          "const __spotpatchDataFlow = runtime;\n",
        ),
        {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.None,
          },
        },
      ).outputText;
      const sandbox: Record<string, unknown> = { runtime };
      vm.runInContext(executable, vm.createContext(sandbox));
      await expect(sandbox.result).resolves.toBe(42);
    }
  });

  it("keeps module directives before the injected helper import", () => {
    const result = transform(`"use client";

      export function Login() {
        return <button onClick={() => fetch("/login")}>Login</button>;
      }`);

    expect(result?.code).toMatch(
      /^"use client";\nimport \{ dataFlowRuntime as __spotpatchDataFlow \}/u,
    );
  });

  it("uses one original source coordinate space for DOM and request anchors", () => {
    const code = `export function Login() {
      async function onFinish(values: unknown) {
        await Promise.resolve();
        return fetch("/auth/login", { method: "POST", body: JSON.stringify(values) });
      }
      return <button onClick={onFinish}>Login</button>;
    }`;
    const result = transform(code);
    const request = result?.dataFlow?.anchors.find(({ kind }) => kind === "request");

    expect(result?.code).toContain('data-spotpatch-source="file-login:6:14"');
    expect(request).toMatchObject({ kind: "request", line: 4, column: 16 });
    expect(result?.code).toContain(".withRequestFrame(");
    expect(result?.code).toContain(".beginInvocation(");
    expect(result?.code).not.toContain(absolutePath);
  });

  it("preserves async handler results while request dispatch keeps its original Promise", async () => {
    const code = `function Login() {
      async function onFinish(values: unknown) {
        await Promise.resolve();
        return fetch("/auth/login", { method: "POST", body: JSON.stringify(values) });
      }
      return <button onClick={onFinish}>Login</button>;
    }
    globalThis.Login = Login;`;
    const transformed = transform(code);
    expect(transformed).toBeDefined();
    if (transformed === undefined) return;
    let currentToken: unknown;
    let frameToken: unknown;
    const runtime = {
      beginInvocation: (metadata: unknown) => Object.freeze(metadata),
      bindInvocation: (_token: unknown, callback: (...args: unknown[]) => unknown) =>
        callback,
      captureInvocation: () => currentToken,
      registerComponent: vi.fn(),
      withInvocation: (token: unknown, callback: () => unknown) => {
        const parent = currentToken;
        currentToken = token;
        try {
          return callback();
        } finally {
          currentToken = parent;
        }
      },
      withRequestFrame: (
        token: unknown,
        _metadata: unknown,
        callback: () => unknown,
      ) => {
        frameToken = token;
        return callback();
      },
    };
    const expected = Promise.resolve(new Response(null, { status: 204 }));
    const fetch = vi.fn(() => expected);
    const executable = transformed.code.replace(
      /import \{ dataFlowRuntime as __spotpatchDataFlow \} from "virtual:spotpatch\/data-flow-runtime";\n/u,
      "const __spotpatchDataFlow = runtime;\n",
    );
    const output = ts.transpileModule(executable, {
      compilerOptions: {
        jsx: ts.JsxEmit.React,
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    const sandbox: Record<string, unknown> = {
      React: {
        createElement: (
          type: unknown,
          props: Readonly<Record<string, unknown>>,
          children: unknown,
        ) => ({ type, props: { ...props, children } }),
      },
      Response,
      fetch,
      runtime,
    };
    vm.runInContext(output, vm.createContext(sandbox));
    const Login: unknown = sandbox.Login;
    expect(typeof Login).toBe("function");
    if (typeof Login !== "function") return;
    const element: unknown = Reflect.apply(Login, undefined, []);
    expect(typeof element).toBe("object");
    if (typeof element !== "object" || element === null || !("props" in element)) {
      return;
    }
    const props: unknown = element.props;
    if (typeof props !== "object" || props === null || !("onClick" in props)) return;
    const onClick: unknown = props.onClick;
    expect(typeof onClick).toBe("function");
    if (typeof onClick !== "function") return;

    const actual: unknown = await Reflect.apply(onClick, undefined, [
      { account: "redacted" },
    ]);

    expect(actual).toBe(await expected);
    expect(fetch).toHaveBeenCalledOnce();
    expect(frameToken).toBeTypeOf("object");
    expect(
      (frameToken as Readonly<Record<string, unknown>>).componentSourceId,
    ).toBeTypeOf("string");
  });

  it("registers aliased React wrappers without colliding with application bindings", () => {
    const result = transform(`import { memo as keep } from "react";
      const __spotpatchDataFlow = "application-owned";
      export const Login = keep(() => {
        async function submit() { return fetch("/login"); }
        return <button onClick={submit}>Login</button>;
      });`);

    expect(result?.code).toContain("dataFlowRuntime as __spotpatchDataFlow_1");
    expect(result?.code).toContain("const __spotpatchDataFlow =");
    expect(result?.code).toContain(".registerComponent(Login,");
    expect(result?.dataFlow?.anchors).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "component" })]),
    );
  });

  it("creates a fresh trigger boundary for an imported JSX handler", () => {
    const result = transform(`import { submit } from "./actions";
      export function Login() {
        return <button onClick={submit}>Login</button>;
      }`);

    expect(result?.code).toContain(".bindTrigger({componentSourceId:");
    expect(result?.code).toContain("triggerCallsiteId:");
    expect(result?.code).toContain(",submit)");
    expect(result?.dataFlow?.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "DATA_FLOW_CONCISE_TRIGGER_UNSUPPORTED",
        }),
      ]),
    );
  });

  it("creates an exact render trigger and uses it for a direct component fetch", () => {
    const result = transform(`export function Login() {
      const request = globalThis.fetch("/session");
      return <div>{String(request)}</div>;
    }`);
    const component = result?.dataFlow?.anchors.find(
      ({ kind }) => kind === "component",
    );
    const renderTrigger = result?.dataFlow?.anchors.find(
      ({ kind }) => kind === "trigger",
    );

    if (component === undefined || renderTrigger === undefined) {
      throw new Error("Expected component and render trigger anchors.");
    }
    expect(renderTrigger).toMatchObject({ kind: "trigger", line: 1, column: 1 });
    expect(result?.code).toContain(
      `.beginInvocation({componentSourceId:"${component.id}",triggerCallsiteId:"${renderTrigger.id}"`,
    );
    expect(result?.code).toContain(".captureInvocation()??__spotpatchToken_");
  });

  it("supports a concise JSX request handler without changing its expression body", () => {
    const result = transform(`export function Login() {
      return <button onClick={() => fetch("/login")}>Login</button>;
    }`);

    expect(result?.code).toContain(".bindTrigger({componentSourceId:");
    expect(result?.code).toContain(".withRequestFrame(");
    expect(result?.code).toContain('()=>fetch("/login")');
    expect(result?.dataFlow?.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "DATA_FLOW_CONCISE_TRIGGER_UNSUPPORTED" }),
      ]),
    );
  });

  it("propagates the invocation created by a concise trigger into a called service", () => {
    const result = transform(`function submit() { return fetch("/login"); }
      export function Login() {
        return <button onClick={() => submit()}>Login</button>;
      }`);

    expect(result?.code).toContain(".bindTrigger({componentSourceId:");
    expect(result?.code).toContain(
      ".withInvocation(__spotpatchDataFlow.captureInvocation()??",
    );
    expect(result?.code).toContain("()=>submit())");
  });

  it("prepends the pass-through observer to a statically declared tRPC link array", () => {
    const result =
      transform(`import { createTRPCClient, httpBatchLink } from "@trpc/client";
      const client = createTRPCClient({
        links: [httpBatchLink({ url: "/api/trpc" })],
      });
      export function Login() {
        return <button onClick={() => client.auth.login.mutate({ account: "hidden" })}>Login</button>;
      }`);

    expect(result?.code).toContain(
      "links: [__spotpatchDataFlow.createTrpcLink(),httpBatchLink",
    );
    expect(result?.code).toContain(".withRequestFrame(");
    expect(result?.code).not.toContain("DATA_FLOW_TRPC_LINK_CONFIG_UNSUPPORTED");
  });

  it("prepends the observer to a classic createTRPCReact client", () => {
    const result = transform(`import { createTRPCReact } from "@trpc/react-query";
      import { httpBatchLink } from "@trpc/client";
      const trpc = createTRPCReact();
      export const client = trpc.createClient({
        links: [httpBatchLink({ url: "/api/trpc" })],
      });`);

    expect(result?.code).toContain(
      "links: [__spotpatchDataFlow.createTrpcLink(),httpBatchLink",
    );
  });

  it("fails closed when a tRPC client uses a dynamic link configuration", () => {
    const result = transform(`import { createTRPCClient } from "@trpc/client";
      const links = makeLinks();
      export const client = createTRPCClient({ links });`);

    expect(result?.dataFlow?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "DATA_FLOW_TRPC_LINK_CONFIG_UNSUPPORTED" }),
      ]),
    );
    expect(result?.code).not.toContain("createTrpcLink(),");
  });

  it("creates an invocation boundary for a React Query v3 concise query function", () => {
    const result = transform(`import { useQuery as query } from "react-query";
      export function Payment() {
        const result = query("status", () => fetch("/user/payQuery"), { enabled: false });
        return <div>{String(result)}</div>;
      }`);

    expect(result?.code).toContain('query("status", __spotpatchDataFlow.bindTrigger(');
    expect(result?.code).toContain(".withRequestFrame(");
    expect(
      result?.dataFlow?.anchors.filter(({ kind }) => kind === "trigger"),
    ).toHaveLength(2);
  });

  it("does not instrument a local useQuery lookalike as a Query trigger", () => {
    const result = transform(`function useQuery(_key, callback) { return callback; }
      export function FakeQuery() {
        const result = useQuery("fake", () => fetch("/fake"));
        return <div>{String(result)}</div>;
      }`);

    expect(result?.code).not.toContain(
      'useQuery("fake", __spotpatchDataFlow.bindTrigger',
    );
  });
});
