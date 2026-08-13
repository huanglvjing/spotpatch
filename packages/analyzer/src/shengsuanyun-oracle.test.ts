import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createStaticDataFlowAnalyzer } from "./static-analyzer.js";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const targetRoot = path.resolve(
  sourceDirectory,
  "../../../../shengsuanyun-web/shengsuanyun-web",
);

type DataFlowReport = ReturnType<
  ReturnType<typeof createStaticDataFlowAnalyzer>["analyzeComponent"]
>;

function lineContaining(relativePath: string, text: string): number {
  const lines = readFileSync(path.join(targetRoot, relativePath), "utf8").split("\n");
  const index = lines.findIndex((line) => line.includes(text));
  if (index < 0) throw new Error(`Missing oracle source text: ${text}`);
  return index + 1;
}

function endpointSet(report: DataFlowReport): Set<string> {
  return new Set(
    report.dependencies.map(
      ({ method, url }) => `${method ?? "UNKNOWN"} ${url?.pathname ?? "unknown"}`,
    ),
  );
}

function assertHasDependencies(report: DataFlowReport): void {
  if (report.dependencies.length === 0) {
    throw new Error(
      JSON.stringify({
        capability: report.capability,
        component: report.component,
        completeness: report.completeness,
        diagnostics: report.diagnostics,
      }),
    );
  }
}

describe.skipIf(!existsSync(path.join(targetRoot, "package.json")))(
  "shengsuanyun-web real-source oracle",
  () => {
    let sourceSequence = 0;
    const analyzer = createStaticDataFlowAnalyzer({
      root: targetRoot,
      registryEpoch: "shengsuanyun-oracle-v1",
      registerSource: () => `source_${String(++sourceSequence)}`,
    });

    it("proves SMS and account login endpoints through Zustand and Axios", () => {
      const smsPath = "src/pages/login/components/sms-login.tsx";
      const accountPath = "src/pages/login/components/account-login.tsx";
      const sms = analyzer.analyzeComponent({
        absolutePath: path.join(targetRoot, smsPath),
        line: lineContaining(smsPath, "const AccountLogin"),
        column: 1,
      });
      const account = analyzer.analyzeComponent({
        absolutePath: path.join(targetRoot, accountPath),
        line: lineContaining(accountPath, "const AccountLogin"),
        column: 1,
      });

      assertHasDependencies(sms);
      assertHasDependencies(account);
      expect(endpointSet(sms)).toContain("POST /v2/auth/login");
      expect([...endpointSet(account)]).toEqual(
        expect.arrayContaining(["POST /auth/email/login", "POST /base/login"]),
      );
      expect(
        sms.dependencies.find(({ url }) => url?.pathname === "/v2/auth/login")
          ?.association,
      ).toBe("transitive");
    });

    it("separates WeChat mount polling from click-triggered login", () => {
      const relativePath = "src/pages/login/components/wechat-login.tsx";
      const report = analyzer.analyzeComponent({
        absolutePath: path.join(targetRoot, relativePath),
        line: lineContaining(relativePath, "const WechatLogin"),
        column: 1,
      });
      const query = report.dependencies.find(
        ({ url }) => url?.pathname === "/wechat/query",
      );

      assertHasDependencies(report);
      expect([...endpointSet(report)]).toEqual(
        expect.arrayContaining(["GET /wechat/login", "POST /wechat/query"]),
      );
      expect(query?.parameters.map(({ path }) => path)).toEqual(
        expect.arrayContaining(["callback_url", "scene_id", "state"]),
      );
      expect(query?.response.consumedFields).toEqual(
        expect.arrayContaining([
          "code",
          "data.open_id",
          "data.token",
          "data.expires_in",
          "data.user",
          "data.redirectUrl",
        ]),
      );
      expect(query?.suppliedBindings).toEqual(
        expect.arrayContaining([
          "callback-prop:onSuccess",
          "zustand:openId",
          "zustand:user",
        ]),
      );
    });

    it("finds the model Table request, fields, and local state destinations", () => {
      const relativePath = "src/pages/serverless/model/index.tsx";
      const report = analyzer.analyzeComponent({
        absolutePath: path.join(targetRoot, relativePath),
        line: lineContaining(relativePath, "const Model"),
        column: 1,
      });
      const request = report.dependencies.find(
        ({ url }) => url?.pathname === "/model/list/user",
      );

      assertHasDependencies(report);
      expect(request?.parameters.map(({ path }) => path)).toEqual(
        expect.arrayContaining(["page", "pageSize", "name"]),
      );
      expect(request?.response.consumedFields).toEqual(
        expect.arrayContaining(["code", "data.list", "data.total"]),
      );
      expect(request?.suppliedBindings).toEqual(
        expect.arrayContaining(["react-state:data", "react-state:total"]),
      );
    });

    it("finds React Query v3 polling without treating a disabled query as observed", () => {
      const relativePath = "src/pages/home/example/index.tsx";
      const report = analyzer.analyzeComponent({
        absolutePath: path.join(targetRoot, relativePath),
        line: lineContaining(relativePath, "const ChargeModal"),
        column: 1,
      });
      const polling = report.dependencies.find(
        ({ url }) => url?.pathname === "/user/payQuery",
      );

      assertHasDependencies(report);
      expect(endpointSet(report)).toContain("POST /user/payQuery");
      expect(polling).toMatchObject({
        execution: "declared-not-observed",
        proof: "proven",
      });
      expect(polling?.parameters.map(({ path }) => path)).toContain("orderId");
    });
  },
);
