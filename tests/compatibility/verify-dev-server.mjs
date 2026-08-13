import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = process.cwd();
const packageJsonPath = path.join(projectRoot, "package.json");
const packageManifest = JSON.parse(await readFile(packageJsonPath, "utf8"));
const requireFromProject = createRequire(packageJsonPath);
const viteEntry = requireFromProject.resolve("vite");
const viteModule = await import(pathToFileURL(viteEntry).href);
const createServer = viteModule.createServer ?? viteModule.default?.createServer;
assert.equal(typeof createServer, "function");
const syntheticCredential = "synthetic-compatibility-credential";
const environmentOverrides = {
  SPOTPATCH_AI_API_KEY: syntheticCredential,
  SPOTPATCH_AI_BASE_URL: "https://relay.example.test/v1",
  SPOTPATCH_AI_MODEL: "provider/compatibility-model",
};
const previousEnvironment = Object.fromEntries(
  Object.keys(environmentOverrides).map((name) => [name, process.env[name]]),
);
Object.assign(process.env, environmentOverrides);
const server = await createServer({
  root: projectRoot,
  logLevel: "silent",
  optimizeDeps: {
    force: true,
    include: [],
    noDiscovery: true,
  },
  server: {
    host: "127.0.0.1",
    port: 0,
    strictPort: false,
  },
});

try {
  await server.listen();
  const address = server.httpServer?.address();

  assert.notEqual(address, null);
  assert.notEqual(address, undefined);
  assert.notEqual(typeof address, "string");

  if (address === null || address === undefined || typeof address === "string") {
    throw new Error("Compatibility server did not expose a TCP port.");
  }

  const origin = `http://127.0.0.1:${String(address.port)}`;
  const htmlResponse = await fetch(`${origin}/`);
  assert.equal(htmlResponse.status, 200);
  const html = await htmlResponse.text();
  const clientPath = html.match(/src="([^"]*spotpatch\/client[^"]*)"/u)?.[1];
  const dataFlowPreludePath = html.match(
    /src="([^"]*spotpatch\/data-flow-runtime[^"]*)"/u,
  )?.[1];
  assert.notEqual(clientPath, undefined);
  assert.notEqual(dataFlowPreludePath, undefined);

  const sourceResponse = await fetch(`${origin}/src/main.jsx`);
  assert.equal(sourceResponse.status, 200);
  const transformedSource = await sourceResponse.text();
  const marker = transformedSource.match(/([A-Za-z0-9_-]+:\d+:\d+)/u)?.[1];
  assert.notEqual(marker, undefined);

  const runtimeResponse = await fetch(new URL(clientPath, origin));
  assert.equal(runtimeResponse.status, 200);
  const runtimeSource = await runtimeResponse.text();
  assert.match(runtimeSource, /"ai":\{"enabled":true/u);
  assert.doesNotMatch(runtimeSource, new RegExp(syntheticCredential, "u"));
  assert.doesNotMatch(runtimeSource, /relay\.example\.test/u);
  assert.doesNotMatch(runtimeSource, /provider\/compatibility-model/u);
  const expectedViteVersion = packageManifest.dependencies.vite;
  assert.match(
    runtimeSource,
    new RegExp(
      `"frameworkVersion":"${expectedViteVersion.replaceAll(".", "\\.")}"`,
      "u",
    ),
  );
  assert.match(runtimeSource, /"framework":"vite"/u);
  assert.match(runtimeSource, /"dataFlow":\{"enabled":true,"runtime":"dispatch"/u);
  const sessionToken = runtimeSource.match(/"sessionToken":"([^"]+)"/u)?.[1];
  assert.notEqual(sessionToken, undefined);

  const dataFlowPreludeResponse = await fetch(new URL(dataFlowPreludePath, origin));
  assert.equal(dataFlowPreludeResponse.status, 200);
  const dataFlowPreludeSource = await dataFlowPreludeResponse.text();
  assert.match(dataFlowPreludeSource, /"enabled":true/u);
  assert.match(dataFlowPreludeSource, /spotpatch\.data-flow\.runtime\.v1/u);

  const [fileId, line, column] = marker?.split(":") ?? [];
  const contextResponse = await fetch(`${origin}/__spotpatch/v1/source-context`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "x-spotpatch-token": sessionToken ?? "",
    },
    body: JSON.stringify({
      fileId,
      line: Number(line),
      column: Number(column),
      maxLines: 80,
    }),
  });
  assert.equal(contextResponse.status, 200);
  const context = await contextResponse.json();
  assert.equal(context.ok, true);
  assert.equal(context.data.relativePath, "src/main.jsx");

  const dataFlowResponse = await fetch(
    `${origin}/__spotpatch/v1/data-flow/component-report`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        "x-spotpatch-token": sessionToken ?? "",
      },
      body: JSON.stringify({
        schemaVersion: 1,
        fileId,
        line: Number(line),
        column: Number(column),
      }),
    },
  );
  assert.equal(dataFlowResponse.status, 200);
  const dataFlowReport = await dataFlowResponse.json();
  assert.equal(dataFlowReport.ok, true);
  assert.equal(dataFlowReport.data.capability.enabled, true);
  assert.equal(dataFlowReport.data.capability.runtimeObservation, "dispatch-only");
  assert.equal(dataFlowReport.data.component.displayName, "CompatibilityFixture");
} finally {
  await server.close();

  for (const [name, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) {
      Reflect.deleteProperty(process.env, name);
    } else {
      process.env[name] = value;
    }
  }
}
