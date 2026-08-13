import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { DEFAULT_DATA_FLOW_LIMITS } from "@spotpatch/shared";
import { afterEach, describe, expect, it } from "vitest";

import { createStaticDataFlowAnalyzer } from "./static-analyzer.js";

let fixtureRoot: string | undefined;

afterEach(async () => {
  if (fixtureRoot !== undefined) {
    await rm(fixtureRoot, { recursive: true, force: true });
    fixtureRoot = undefined;
  }
});

describe("static data-flow analyzer", () => {
  it("analyzes a direct global fetch without exposing query values", async () => {
    fixtureRoot = await mkdtemp(path.join(tmpdir(), "spotpatch-analyzer-"));
    const sourcePath = path.join(fixtureRoot, "Example.tsx");
    await writeFile(
      sourcePath,
      `export const Example = () => {
        async function load() {
          const result = await fetch("/users?token=never-returned", { method: "POST", body: JSON.stringify({ page: 1 }) });
          return result.json();
        }
        return <button onClick={load}>Load</button>;
      };`,
      "utf8",
    );
    const analyzer = createStaticDataFlowAnalyzer({
      root: fixtureRoot,
      registryEpoch: "fixture-registry",
      registerSource: () => "fixture-source",
    });
    const report = analyzer.analyzeComponent({
      absolutePath: sourcePath,
      line: 1,
      column: 1,
    });

    expect(report.dependencies).toMatchObject([
      {
        method: "POST",
        url: { pathname: "/users", queryKeys: ["token"] },
      },
    ]);
    expect(report.dependencies[0]?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "token",
          position: "query",
          sensitive: true,
          valueState: "not-collected",
        }),
      ]),
    );
    expect(JSON.stringify(report)).not.toContain("never-returned");
  });

  it("matches an entry source through an equivalent normalized path", async () => {
    fixtureRoot = await mkdtemp(path.join(tmpdir(), "spotpatch-analyzer-"));
    const sourcePath = path.join(fixtureRoot, "EquivalentPath.tsx");
    await writeFile(
      sourcePath,
      `export function EquivalentPath() {
        return <button onClick={() => fetch("/normalized-path")}>Load</button>;
      }`,
      "utf8",
    );
    const analyzer = createStaticDataFlowAnalyzer({
      root: path.join(fixtureRoot, "."),
      registryEpoch: "fixture-registry",
      registerSource: () => "fixture-source",
    });

    const report = analyzer.analyzeComponent({
      absolutePath: path.join(fixtureRoot, "nested", "..", "EquivalentPath.tsx"),
      line: 1,
      column: 1,
    });

    expect(report.dependencies[0]?.url?.pathname).toBe("/normalized-path");
  });

  it("analyzes a fetch dispatched directly during component render", async () => {
    fixtureRoot = await mkdtemp(path.join(tmpdir(), "spotpatch-analyzer-"));
    const sourcePath = path.join(fixtureRoot, "RenderFetch.tsx");
    await writeFile(
      sourcePath,
      `export function RenderFetch() {
        const request = globalThis.fetch("/render-session");
        return <div>{String(request)}</div>;
      }`,
      "utf8",
    );
    const analyzer = createStaticDataFlowAnalyzer({
      root: fixtureRoot,
      registryEpoch: "fixture-registry",
      registerSource: () => "fixture-source",
    });

    const report = analyzer.analyzeComponent({
      absolutePath: sourcePath,
      line: 1,
      column: 1,
    });

    expect(report.dependencies).toMatchObject([
      {
        association: "direct",
        kind: "http",
        method: "GET",
        url: { pathname: "/render-session" },
      },
    ]);
  });

  it("extracts classic tRPC queries and the actual bound mutation trigger", async () => {
    fixtureRoot = await mkdtemp(path.join(tmpdir(), "spotpatch-analyzer-"));
    const sourcePath = path.join(fixtureRoot, "TrpcProfile.tsx");
    await writeFile(
      sourcePath,
      `import { createTRPCReact } from "@trpc/react-query";
      const trpc = createTRPCReact();
      export function TrpcProfile() {
        const profile = trpc.user.byId.useQuery({ userId: "hidden" });
        const update = trpc.user.update.useMutation();
        function submit() { return update.mutate({ displayName: "hidden" }); }
        return <button onClick={submit}>{profile.data?.name}</button>;
      }`,
      "utf8",
    );
    const analyzer = createStaticDataFlowAnalyzer({
      root: fixtureRoot,
      registryEpoch: "fixture-registry",
      registerSource: () => "fixture-source",
    });

    const report = analyzer.analyzeComponent({
      absolutePath: sourcePath,
      line: 3,
      column: 7,
    });

    const query = report.dependencies.find(
      ({ operation }) => operation === "user.byId",
    );
    const mutation = report.dependencies.find(
      ({ operation, parameters }) =>
        operation === "user.update" &&
        parameters.some(({ path }) => path === "displayName"),
    );
    expect(query).toMatchObject({ kind: "rpc", method: "QUERY" });
    expect(query?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "userId", position: "variable" }),
      ]),
    );
    expect(query?.response.consumedFields).toContain("data.name");
    expect(mutation).toMatchObject({ kind: "rpc", method: "MUTATION" });
    expect(mutation?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "displayName", position: "variable" }),
      ]),
    );
    expect(JSON.stringify(report)).not.toContain("hidden");
  });

  it("treats React Query v3 query functions as declared triggers without assuming dispatch", async () => {
    fixtureRoot = await mkdtemp(path.join(tmpdir(), "spotpatch-analyzer-"));
    const sourcePath = path.join(fixtureRoot, "Polling.tsx");
    await writeFile(
      sourcePath,
      `import { useQuery } from "react-query";
      import axios from "axios";
      export function Polling({ enabled }) {
        const query = useQuery("payStatus", () => axios.post("/user/payQuery", { orderId: "hidden" }), {
          enabled,
          refetchInterval: 1500,
        });
        return <div>{query.data?.code}</div>;
      }`,
      "utf8",
    );
    const analyzer = createStaticDataFlowAnalyzer({
      root: fixtureRoot,
      registryEpoch: "fixture-registry",
      registerSource: () => "fixture-source",
    });

    const report = analyzer.analyzeComponent({
      absolutePath: sourcePath,
      line: 3,
      column: 7,
    });

    expect(report.dependencies).toMatchObject([
      {
        execution: "declared-not-observed",
        kind: "http",
        method: "POST",
        url: { pathname: "/user/payQuery" },
        parameters: [expect.objectContaining({ path: "orderId", position: "body" })],
      },
    ]);
    expect(JSON.stringify(report)).not.toContain("hidden");
  });

  it("does not treat an application function named useQuery as a Query adapter", async () => {
    fixtureRoot = await mkdtemp(path.join(tmpdir(), "spotpatch-analyzer-"));
    const sourcePath = path.join(fixtureRoot, "FakeQuery.tsx");
    await writeFile(
      sourcePath,
      `function useQuery(_key, callback) { return callback; }
      export function FakeQuery() {
        useQuery("fake", () => fetch("/must-not-be-attributed"));
        return <div />;
      }`,
      "utf8",
    );
    const analyzer = createStaticDataFlowAnalyzer({
      root: fixtureRoot,
      registryEpoch: "fixture-registry",
      registerSource: () => "fixture-source",
    });

    const report = analyzer.analyzeComponent({
      absolutePath: sourcePath,
      line: 2,
      column: 7,
    });

    expect(report.dependencies).toEqual([]);
  });

  it("returns a deterministic partial prefix for excessive URL branches", async () => {
    fixtureRoot = await mkdtemp(path.join(tmpdir(), "spotpatch-analyzer-"));
    const sourcePath = path.join(fixtureRoot, "Branches.tsx");
    await writeFile(
      sourcePath,
      `export function Branches({ first, second, third }) {
        function load() {
          return fetch(first ? "/first" : second ? "/second" : third ? "/third" : "/fourth");
        }
        return <button onClick={load}>Load</button>;
      }`,
      "utf8",
    );
    const analyzer = createStaticDataFlowAnalyzer({
      root: fixtureRoot,
      registryEpoch: "fixture-registry",
      registerSource: () => "fixture-source",
      limits: Object.freeze({
        ...DEFAULT_DATA_FLOW_LIMITS,
        graphMaxCallsites: 2,
      }),
    });

    const report = analyzer.analyzeComponent({
      absolutePath: sourcePath,
      line: 1,
      column: 1,
    });

    expect(report.dependencies.map(({ url }) => url?.pathname)).toEqual([
      "/first",
      "/second",
    ]);
    expect(report.completeness).toMatchObject({
      complete: false,
      truncatedBy: "callsites",
    });
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "DATA_FLOW_ANALYSIS_TRUNCATED" }),
      ]),
    );
  });

  it("proves response fields supplied to React state without collecting values", async () => {
    fixtureRoot = await mkdtemp(path.join(tmpdir(), "spotpatch-analyzer-"));
    const sourcePath = path.join(fixtureRoot, "Table.tsx");
    await writeFile(
      sourcePath,
      `import { useState } from "react";
      export const Table = () => {
        const [rows, setRows] = useState([]);
        async function load() {
          const result = await fetch("/rows");
          const { data } = await result.json();
          setRows(data.list);
        }
        return <button onClick={load}>{rows.length}</button>;
      };`,
      "utf8",
    );
    const analyzer = createStaticDataFlowAnalyzer({
      root: fixtureRoot,
      registryEpoch: "fixture-registry",
      registerSource: () => "fixture-source",
    });
    const report = analyzer.analyzeComponent({
      absolutePath: sourcePath,
      line: 2,
      column: 7,
    });

    expect(report.dependencies[0]).toMatchObject({
      suppliedBindings: ["react-state:rows"],
    });
  });

  it("analyzes a component wrapped by an aliased React memo binding", async () => {
    fixtureRoot = await mkdtemp(path.join(tmpdir(), "spotpatch-analyzer-"));
    const sourcePath = path.join(fixtureRoot, "Memo.tsx");
    await writeFile(
      sourcePath,
      `import { memo as keep } from "react";
      export const MemoTable = keep(() => {
        async function load() { return fetch("/memo-rows"); }
        return <button onClick={load}>Load</button>;
      });`,
      "utf8",
    );
    const analyzer = createStaticDataFlowAnalyzer({
      root: fixtureRoot,
      registryEpoch: "fixture-registry",
      registerSource: () => "fixture-source",
    });
    const report = analyzer.analyzeComponent({
      absolutePath: sourcePath,
      line: 2,
      column: 7,
    });

    expect(report.component.displayName).toBe("MemoTable");
    expect(
      report.dependencies.some(
        (dependency) => dependency.url?.pathname === "/memo-rows",
      ),
    ).toBe(true);
  });

  it("invalidates a cached program when an imported request module changes", async () => {
    fixtureRoot = await mkdtemp(path.join(tmpdir(), "spotpatch-analyzer-"));
    const sourcePath = path.join(fixtureRoot, "App.tsx");
    const requestPath = path.join(fixtureRoot, "api.ts");
    await writeFile(
      sourcePath,
      `import { loadRows } from "./api";
      export function App() { return <button onClick={loadRows}>Load</button>; }`,
      "utf8",
    );
    await writeFile(
      requestPath,
      `export async function loadRows() { return fetch("/first"); }`,
      "utf8",
    );
    const analyzer = createStaticDataFlowAnalyzer({
      root: fixtureRoot,
      registryEpoch: "fixture-registry",
      registerSource: () => "fixture-source",
    });
    const input = { absolutePath: sourcePath, line: 2, column: 7 };
    expect(analyzer.analyzeComponent(input).dependencies[0]?.url?.pathname).toBe(
      "/first",
    );

    await writeFile(
      requestPath,
      `export async function loadRows() { return fetch("/second"); }`,
      "utf8",
    );
    expect(analyzer.analyzeComponent(input).dependencies[0]?.url?.pathname).toBe(
      "/second",
    );
  });

  it("marks a directly imported JSX handler as a transitive component edge", async () => {
    fixtureRoot = await mkdtemp(path.join(tmpdir(), "spotpatch-analyzer-"));
    const sourcePath = path.join(fixtureRoot, "App.tsx");
    const requestPath = path.join(fixtureRoot, "actions.ts");
    await writeFile(
      sourcePath,
      `import { submit } from "./actions";
      export function App() { return <button onClick={submit}>Submit</button>; }`,
      "utf8",
    );
    await writeFile(
      requestPath,
      `export function submit() { return fetch("/shared-submit"); }`,
      "utf8",
    );
    const analyzer = createStaticDataFlowAnalyzer({
      root: fixtureRoot,
      registryEpoch: "fixture-registry",
      registerSource: () => "fixture-source",
    });

    const report = analyzer.analyzeComponent({
      absolutePath: sourcePath,
      line: 2,
      column: 7,
    });

    expect(report.dependencies[0]).toMatchObject({
      association: "transitive",
      url: { pathname: "/shared-submit" },
    });
  });

  it("extracts nested Axios params and headers by binding without values", async () => {
    fixtureRoot = await mkdtemp(path.join(tmpdir(), "spotpatch-analyzer-"));
    const sourcePath = path.join(fixtureRoot, "Search.tsx");
    await writeFile(
      sourcePath,
      `import axios from "axios";
      export function Search() {
        async function load() {
          return axios.get("/search", {
            params: { page: 1, token: "never-return" },
            headers: { "x-trace-id": "never-return-trace" },
          });
        }
        return <button onClick={load}>Search</button>;
      }`,
      "utf8",
    );
    const analyzer = createStaticDataFlowAnalyzer({
      root: fixtureRoot,
      registryEpoch: "fixture-registry",
      registerSource: () => "fixture-source",
    });
    const report = analyzer.analyzeComponent({
      absolutePath: sourcePath,
      line: 2,
      column: 7,
    });

    expect(report.dependencies[0]?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "page", position: "query" }),
        expect.objectContaining({
          path: "token",
          position: "query",
          sensitive: true,
        }),
        expect.objectContaining({ path: "x-trace-id", position: "header" }),
      ]),
    );
    expect(JSON.stringify(report)).not.toContain("never-return");
  });

  it("keeps a portable oracle for conditional Zustand and timer polling patterns", async () => {
    fixtureRoot = await mkdtemp(path.join(tmpdir(), "spotpatch-analyzer-"));
    const storePath = path.join(fixtureRoot, "auth-store.ts");
    const loginPath = path.join(fixtureRoot, "Login.tsx");
    const pollingPath = path.join(fixtureRoot, "Polling.tsx");
    await writeFile(
      storePath,
      `import axios from "axios";
      const http = axios.create({ baseURL: "/api" });
      export const useAuthStore = create((set) => ({
        authenticate: async (emailMode, email, password) => {
          const result = await http.post(emailMode ? "/auth/email/login" : "/base/login", { email, password });
          set({ user: result.data.user });
        },
      }));`,
      "utf8",
    );
    await writeFile(
      loginPath,
      `import { useAuthStore } from "./auth-store";
      export function Login() {
        const { authenticate } = useAuthStore();
        async function submit() { await authenticate(true, "hidden", "hidden"); }
        return <button onClick={submit}>Login</button>;
      }`,
      "utf8",
    );
    await writeFile(
      pollingPath,
      `import axios from "axios";
      import { useEffect } from "react";
      export function Polling({ onSuccess }) {
        useEffect(() => {
          async function query() {
            const result = await axios.post("/auth/session/query", { session_id: "hidden", state: "hidden" });
            onSuccess(result.data.token);
          }
          const timer = setInterval(query, 1000);
          return () => clearInterval(timer);
        }, [onSuccess]);
        return <div>Waiting</div>;
      }`,
      "utf8",
    );
    const analyzer = createStaticDataFlowAnalyzer({
      root: fixtureRoot,
      registryEpoch: "portable-oracle",
      registerSource: () => "fixture-source",
    });
    const login = analyzer.analyzeComponent({
      absolutePath: loginPath,
      line: 2,
      column: 7,
    });
    const polling = analyzer.analyzeComponent({
      absolutePath: pollingPath,
      line: 3,
      column: 7,
    });

    expect(login.dependencies.map(({ url }) => url?.pathname)).toEqual(
      expect.arrayContaining(["/auth/email/login", "/base/login"]),
    );
    expect(
      login.dependencies.flatMap(({ parameters }) =>
        parameters.map(({ path }) => path),
      ),
    ).toEqual(expect.arrayContaining(["email", "password"]));
    const query = polling.dependencies.find(
      ({ url }) => url?.pathname === "/auth/session/query",
    );
    expect(query?.parameters.map(({ path }) => path)).toEqual(
      expect.arrayContaining(["session_id", "state"]),
    );
    expect(query?.response.consumedFields).toContain("data.token");
    expect(JSON.stringify({ login, polling })).not.toContain("hidden");
  });
});
