import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createStaticDataFlowAnalyzer } from "./static-analyzer.js";

type DataFlowReport = ReturnType<
  ReturnType<typeof createStaticDataFlowAnalyzer>["analyzeComponent"]
>;

let fixtureRoot = "";
let analyzer: ReturnType<typeof createStaticDataFlowAnalyzer>;

async function writeFixture(relativePath: string, source: string): Promise<void> {
  await writeFile(path.join(fixtureRoot, relativePath), source, "utf8");
}

async function lineContaining(relativePath: string, text: string): Promise<number> {
  const lines = (await readFile(path.join(fixtureRoot, relativePath), "utf8")).split(
    "\n",
  );
  const index = lines.findIndex((line) => line.includes(text));
  if (index < 0) throw new Error(`Missing portable oracle source text: ${text}`);
  return index + 1;
}

function endpointSet(report: DataFlowReport): Set<string> {
  return new Set(
    report.dependencies.map(
      ({ method, url }) => `${method ?? "UNKNOWN"} ${url?.pathname ?? "unknown"}`,
    ),
  );
}

describe("portable multi-module source oracle", () => {
  beforeAll(async () => {
    fixtureRoot = await mkdtemp(path.join(tmpdir(), "spotpatch-portable-oracle-"));
    await writeFixture(
      "auth-store.ts",
      `import axios from "axios";
      const http = axios.create({ baseURL: "/api" });
      export const useAuthStore = create((set) => ({
        authenticate: async (emailMode, email, password) => {
          const result = await http.post(emailMode ? "/auth/email/login" : "/auth/account/login", { email, password });
          set({ user: result.data.user });
        },
      }));`,
    );
    await writeFixture(
      "Login.tsx",
      `import { useAuthStore } from "./auth-store";
      export function Login() {
        const { authenticate } = useAuthStore();
        async function submit() { await authenticate(true, "private-email", "private-password"); }
        return <button onClick={submit}>Login</button>;
      }`,
    );
    await writeFixture(
      "SessionPolling.tsx",
      `import axios from "axios";
      import { useEffect, useState } from "react";
      export function SessionPolling({ onSuccess }) {
        const [session, setSession] = useState();
        useEffect(() => {
          async function query() {
            const result = await axios.post("/auth/session/query", { session_id: "private-id", state: "private-state" });
            setSession(result.data.session);
            onSuccess(result.data.token);
          }
          const timer = setInterval(query, 1000);
          return () => clearInterval(timer);
        }, [onSuccess]);
        return <div>{session?.status}</div>;
      }`,
    );
    await writeFixture(
      "ModelTable.tsx",
      `import axios from "axios";
      import { useState } from "react";
      export function ModelTable() {
        const [rows, setRows] = useState([]);
        const [total, setTotal] = useState(0);
        async function load() {
          const result = await axios.get("/models", { params: { page: 1, pageSize: 20, name: "private" } });
          setRows(result.data.list);
          setTotal(result.data.total);
        }
        return <button onClick={load}>{rows.length + total}</button>;
      }`,
    );
    await writeFixture(
      "PaymentStatus.tsx",
      `import { useQuery } from "react-query";
      import axios from "axios";
      export function PaymentStatus({ enabled }) {
        const query = useQuery("paymentStatus", () => axios.post("/payments/status", { orderId: "private-order" }), {
          enabled,
          refetchInterval: 1500,
        });
        return <div>{query.data?.code}</div>;
      }`,
    );

    let sourceSequence = 0;
    analyzer = createStaticDataFlowAnalyzer({
      root: fixtureRoot,
      registryEpoch: "portable-oracle-v1",
      registerSource: () => `source_${String(++sourceSequence)}`,
    });
  });

  afterAll(async () => {
    if (fixtureRoot.length > 0) {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("proves a transitive conditional authentication request", async () => {
    const relativePath = "Login.tsx";
    const report = analyzer.analyzeComponent({
      absolutePath: path.join(fixtureRoot, relativePath),
      line: await lineContaining(relativePath, "export function Login"),
      column: 1,
    });

    expect([...endpointSet(report)]).toEqual(
      expect.arrayContaining(["POST /auth/email/login", "POST /auth/account/login"]),
    );
    expect(report.dependencies.map(({ association }) => association)).toContain(
      "transitive",
    );
    expect(JSON.stringify(report)).not.toContain("private-");
  });

  it("separates mount polling and records consumed response fields", async () => {
    const relativePath = "SessionPolling.tsx";
    const report = analyzer.analyzeComponent({
      absolutePath: path.join(fixtureRoot, relativePath),
      line: await lineContaining(relativePath, "export function SessionPolling"),
      column: 1,
    });
    const request = report.dependencies.find(
      ({ url }) => url?.pathname === "/auth/session/query",
    );

    expect(request?.parameters.map(({ path }) => path)).toEqual(
      expect.arrayContaining(["session_id", "state"]),
    );
    expect(request?.response.consumedFields).toEqual(
      expect.arrayContaining(["data.session", "data.token"]),
    );
    expect(request?.suppliedBindings).toEqual(
      expect.arrayContaining(["callback-prop:onSuccess", "react-state:session"]),
    );
    expect(JSON.stringify(report)).not.toContain("private-");
  });

  it("finds table request parameters, response fields, and state destinations", async () => {
    const relativePath = "ModelTable.tsx";
    const report = analyzer.analyzeComponent({
      absolutePath: path.join(fixtureRoot, relativePath),
      line: await lineContaining(relativePath, "export function ModelTable"),
      column: 1,
    });
    const request = report.dependencies.find(({ url }) => url?.pathname === "/models");

    expect(request?.parameters.map(({ path }) => path)).toEqual(
      expect.arrayContaining(["page", "pageSize", "name"]),
    );
    expect(request?.response.consumedFields).toEqual(
      expect.arrayContaining(["data.list", "data.total"]),
    );
    expect(request?.suppliedBindings).toEqual(
      expect.arrayContaining(["react-state:rows", "react-state:total"]),
    );
    expect(JSON.stringify(report)).not.toContain("private");
  });

  it("keeps a disabled React Query request declared rather than observed", async () => {
    const relativePath = "PaymentStatus.tsx";
    const report = analyzer.analyzeComponent({
      absolutePath: path.join(fixtureRoot, relativePath),
      line: await lineContaining(relativePath, "export function PaymentStatus"),
      column: 1,
    });
    const polling = report.dependencies.find(
      ({ url }) => url?.pathname === "/payments/status",
    );

    expect(polling).toMatchObject({
      execution: "declared-not-observed",
      proof: "proven",
    });
    expect(polling?.parameters.map(({ path }) => path)).toContain("orderId");
    expect(JSON.stringify(report)).not.toContain("private-");
  });
});
