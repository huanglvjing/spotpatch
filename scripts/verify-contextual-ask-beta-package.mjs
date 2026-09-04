import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import {
  mkdtemp,
  mkdir,
  lstat,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_DIRECTORIES = Object.freeze([
  "shared",
  "compiler",
  "react-adapter",
  "runtime",
  "agent",
  "analyzer",
  "dev-server",
  "bridge",
  "vite",
  "next",
]);
const SPOTPATCH_RESIDUE = Object.freeze([
  "data-spotpatch-source",
  "spotpatch-root",
  "__spotpatch/v1",
  "runtime-contextual-ask-panel",
  "ASK_EXECUTOR_UNAVAILABLE",
]);
const HOST_MATRIX = Object.freeze({
  next: process.env.SPOTPATCH_Q7_NEXT_VERSION ?? "16.3.0",
  react: process.env.SPOTPATCH_Q7_REACT_VERSION ?? "19.2.8",
  vite: process.env.SPOTPATCH_Q7_VITE_VERSION ?? "7.3.6",
});
const ALLOWED_VITE_VERSIONS = new Set(["5.4.21", "6.4.3", "7.3.6"]);
const ALLOWED_NEXT_REACT_PAIRS = new Set(["15.3.9:18.3.1", "16.3.0:19.2.8"]);

if (
  !ALLOWED_VITE_VERSIONS.has(HOST_MATRIX.vite) ||
  !ALLOWED_NEXT_REACT_PAIRS.has(`${HOST_MATRIX.next}:${HOST_MATRIX.react}`)
) {
  throw new Error("Q7 received a host version outside the audited beta matrix.");
}
const commandName = (name) => (process.platform === "win32" ? `${name}.cmd` : name);

function pnpmCommand(arguments_) {
  const entrypoint = process.env.npm_execpath;
  if (
    typeof entrypoint === "string" &&
    path.isAbsolute(entrypoint) &&
    /\.(?:c|m)?js$/u.test(entrypoint)
  ) {
    return Object.freeze({
      command: process.execPath,
      arguments_: [entrypoint, ...arguments_],
    });
  }
  return Object.freeze({ command: commandName("pnpm"), arguments_ });
}

function run(command, arguments_, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: options.cwd ?? repositoryRoot,
      env: options.env ?? process.env,
      shell: false,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    child.stdout?.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      const result = Object.freeze({
        code,
        signal,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
      });
      if (code === 0 && signal === null) resolve(result);
      else {
        reject(
          new Error(
            `${command} exited with ${String(code ?? signal)}\n${result.stderr}`,
          ),
        );
      }
    });
  });
}

async function reserveLoopbackPort() {
  const server = createHttpServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert(address !== null && typeof address !== "string");
  const port = address.port;
  await new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  return port;
}

function providerToolTurn(responseId, callId, name, arguments_) {
  const item = {
    type: "function_call",
    call_id: callId,
    name,
    arguments: JSON.stringify(arguments_),
  };
  const events = [
    { type: "response.created", response: { id: responseId } },
    { type: "response.output_item.done", item },
    {
      type: "response.completed",
      response: { id: responseId, status: "completed", output: [item] },
    },
  ];
  return `${events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("")}data: [DONE]\n\n`;
}

async function startFakeResponsesProvider() {
  let turn = 0;
  const server = createHttpServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      turn += 1;
      const body = Buffer.concat(chunks).toString("utf8");
      assert(body.length > 0);
      const payload =
        turn === 1
          ? providerToolTurn("q7-capability-read", "q7-read", "read_source", {
              sourceId: "ask_capability_source",
              startLine: 1,
              endLine: 1,
            })
          : providerToolTurn("q7-capability-submit", "q7-submit", "submit_answer", {
              blocks: [
                {
                  kind: "paragraph",
                  text: "Q7 capability fixture.",
                  citations: [
                    {
                      handleId: "ask_capability_source",
                      startLine: 1,
                      endLine: 1,
                    },
                  ],
                },
              ],
              warnings: [],
            });
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
      });
      response.end(payload);
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert(address !== null && typeof address !== "string");
  return Object.freeze({
    origin: `http://127.0.0.1:${String(address.port)}/v1`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    },
    turns: () => turn,
  });
}

async function waitForHttp(url, child, diagnostics, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Host exited before becoming ready: ${url}\n${diagnostics()}`);
    }
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) {
        await response.body?.cancel();
        return;
      }
      await response.body?.cancel();
    } catch {
      // Startup connection failures are expected until the listener binds.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32" && child.pid !== undefined) {
    try {
      await run("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
        capture: true,
      });
    } catch {
      if (child.exitCode === null && child.signalCode === null)
        throw new Error("Failed to stop the Windows host process tree.");
    }
    return;
  }
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

async function packPackages(packRoot) {
  const tarballs = {};
  for (const directory of PACKAGE_DIRECTORIES) {
    const manifest = JSON.parse(
      await readFile(path.join(repositoryRoot, "packages", directory, "package.json")),
    );
    const invocation = pnpmCommand([
      "--filter",
      manifest.name,
      "pack",
      "--pack-destination",
      packRoot,
      "--json",
    ]);
    const result = await run(invocation.command, invocation.arguments_, {
      capture: true,
    });
    const packed = JSON.parse(result.stdout);
    assert.equal(packed.name, manifest.name);
    assert.equal(packed.version, manifest.version);
    tarballs[manifest.name] = await realpath(packed.filename);
  }
  return Object.freeze(tarballs);
}

async function writeConsumer(consumerRoot, tarballs) {
  const dependencies = Object.fromEntries(
    Object.entries(tarballs).map(([name, tarball]) => [name, `file:${tarball}`]),
  );
  Object.assign(dependencies, {
    next: HOST_MATRIX.next,
    react: HOST_MATRIX.react,
    "react-dom": HOST_MATRIX.react,
    vite: HOST_MATRIX.vite,
  });
  await writeFile(
    path.join(consumerRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "spotpatch-contextual-ask-beta-consumer",
        private: true,
        type: "module",
        dependencies,
      },
      null,
      2,
    )}\n`,
  );
  await runNpm(["install", "--no-audit", "--no-fund", "--package-lock=true"], {
    cwd: consumerRoot,
  });
}

async function runNpm(arguments_, options) {
  if (process.platform !== "win32") {
    return run("npm", arguments_, options);
  }
  const npmCli = path.join(
    path.dirname(process.execPath),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  const metadata = await lstat(npmCli);
  assert(metadata.isFile(), "The Windows Node distribution must include npm-cli.js");
  return run(process.execPath, [npmCli, ...arguments_], options);
}

function collectInstalledSpotPatchPackages(tree, result = new Map()) {
  for (const [name, dependency] of Object.entries(tree.dependencies ?? {})) {
    if (name.startsWith("@spotpatch/") && typeof dependency.version === "string") {
      const versions = result.get(name) ?? new Set();
      versions.add(dependency.version);
      result.set(name, versions);
    }
    collectInstalledSpotPatchPackages(dependency, result);
  }
  return result;
}

async function verifyDependencyTree(consumerRoot) {
  const result = await runNpm(["ls", "--all", "--json"], {
    cwd: consumerRoot,
    capture: true,
  });
  const packages = collectInstalledSpotPatchPackages(JSON.parse(result.stdout));
  for (const directory of PACKAGE_DIRECTORIES) {
    const manifest = JSON.parse(
      await readFile(path.join(repositoryRoot, "packages", directory, "package.json")),
    );
    assert.deepEqual(
      [...(packages.get(manifest.name) ?? [])],
      [manifest.version],
      `${manifest.name} must resolve only to the packed workspace version`,
    );
  }
}

async function verifyExports(consumerRoot) {
  const probePath = path.join(consumerRoot, "exports-probe.cjs");
  await writeFile(
    probePath,
    `const assert = require("node:assert/strict");
const packageNames = ${JSON.stringify(PACKAGE_DIRECTORIES.map((name) => `@spotpatch/${name}`))};
for (const name of packageNames) assert.equal(typeof require(name), "object", name);
assert.equal(typeof require("@spotpatch/shared/contextual-ask-node"), "object");
assert.equal(typeof require("@spotpatch/shared/contextual-ask-browser"), "object");
assert.equal(typeof require("@spotpatch/runtime/contextual-ask-panel"), "object");
assert.equal(typeof require.resolve("@spotpatch/next/client"), "string");
assert.equal(typeof require("@spotpatch/next/loader"), "function");
`,
  );
  await run(process.execPath, [probePath], { cwd: consumerRoot });

  const esmProbePath = path.join(consumerRoot, "exports-probe.mjs");
  await writeFile(
    esmProbePath,
    `import assert from "node:assert/strict";
import { spotPatch } from "@spotpatch/vite";
import { withSpotPatch } from "@spotpatch/next";
import { createManagedCodexAskExecutor } from "@spotpatch/bridge";
assert.deepEqual(spotPatch({ enabled: false }), []);
assert.equal(typeof withSpotPatch, "function");
assert.equal(typeof createManagedCodexAskExecutor, "function");
`,
  );
  await run(process.execPath, [esmProbePath], { cwd: consumerRoot });
}

async function verifyBins(consumerRoot) {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  for (const name of ["spotpatch-bridge", "spotpatch-next", "spotpatch-vite"]) {
    const metadata = await lstat(
      path.join(consumerRoot, "node_modules", ".bin", `${name}${suffix}`),
    );
    assert(
      metadata.isFile() || metadata.isSymbolicLink(),
      `${name} must be installed as an npm executable`,
    );
  }
}

async function verifyViteHost(consumerRoot) {
  const hostRoot = path.join(consumerRoot, "vite-host");
  await mkdir(path.join(hostRoot, "src"), { recursive: true });
  await writeFile(
    path.join(hostRoot, "index.html"),
    '<div id="root"></div><script type="module" src="/src/main.jsx"></script>\n',
  );
  await writeFile(
    path.join(hostRoot, "src", "main.jsx"),
    "export function App() { return <h1>Vite package fixture</h1>; }\n",
  );
  await writeFile(
    path.join(hostRoot, "vite.config.mjs"),
    `import { defineConfig } from "vite";
import { spotPatch } from "@spotpatch/vite";
export default defineConfig({ optimizeDeps: { noDiscovery: true }, plugins: spotPatch({ ai: false, contextualAsk: true, dataFlow: {} }) });
`,
  );
  const probePath = path.join(consumerRoot, "vite-host-probe.mjs");
  await writeFile(
    probePath,
    `import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
const root = process.argv[2];
const configFile = fileURLToPath(new URL("./vite-host/vite.config.mjs", import.meta.url));
const server = await createServer({ root, configFile, server: { host: "127.0.0.1", port: 0 } });
try {
  await server.listen();
  assert.equal(path.resolve(server.config.root), path.resolve(root));
  assert(server.config.plugins.some((plugin) => plugin.name === "spotpatch:transform"));
  const address = server.httpServer?.address();
  assert(address && typeof address !== "string");
  const origin = "http://127.0.0.1:" + String(address.port);
  const page = await fetch(origin + "/");
  assert.equal(page.status, 200);
  const module = await fetch(origin + "/src/main.jsx");
  assert.equal(module.status, 200);
  assert.match(await module.text(), /data-spotpatch-source/);
  const runtime = await fetch(origin + "/@id/__x00__virtual:spotpatch/client");
  assert.equal(runtime.status, 200);
  const runtimeSource = await runtime.text();
  assert(runtimeSource.includes("virtual:spotpatch/contextual-ask-panel"));
  assert(runtimeSource.includes('"framework":"vite"'));
  assert(runtimeSource.includes('"contextualAsk":{"enabled":true}'));
} finally {
  await server.close();
}
`,
  );
  await run(process.execPath, [probePath, hostRoot], { cwd: consumerRoot });
  await run(
    process.execPath,
    [
      path.join(consumerRoot, "node_modules", "vite", "bin", "vite.js"),
      "build",
      hostRoot,
      "--config",
      path.join(hostRoot, "vite.config.mjs"),
    ],
    { cwd: consumerRoot },
  );
  const assetDirectory = path.join(hostRoot, "dist", "assets");
  const output = (
    await Promise.all(
      (await readdir(assetDirectory)).map((name) =>
        readFile(path.join(assetDirectory, name), "utf8"),
      ),
    )
  ).join("\n");
  for (const signature of SPOTPATCH_RESIDUE) assert(!output.includes(signature));
}

async function verifyNextHost(consumerRoot) {
  const hostRoot = path.join(consumerRoot, "next-host");
  const provider = await startFakeResponsesProvider();
  const nextAdapterManifest = JSON.parse(
    await readFile(
      path.join(consumerRoot, "node_modules", "@spotpatch", "next", "package.json"),
    ),
  );
  await mkdir(path.join(hostRoot, "app"), { recursive: true });
  await writeFile(
    path.join(hostRoot, "package.json"),
    JSON.stringify({
      name: "spotpatch-next-package-host",
      private: true,
      devDependencies: {
        "@spotpatch/next": nextAdapterManifest.version,
        next: HOST_MATRIX.next,
        react: HOST_MATRIX.react,
        "react-dom": HOST_MATRIX.react,
      },
      scripts: { dev: "spotpatch-next dev" },
      type: "module",
    }),
  );
  await writeFile(
    path.join(hostRoot, "next.config.mjs"),
    `import { withSpotPatch } from "@spotpatch/next";
export default withSpotPatch({ ai: { baseURL: ${JSON.stringify(provider.origin)}, model: "q7-model", protocol: "responses" }, contextualAsk: true })({});
`,
  );
  await writeFile(
    path.join(hostRoot, "instrumentation-client.js"),
    'import "@spotpatch/next/client";\n',
  );
  await writeFile(
    path.join(hostRoot, "app", "layout.js"),
    "export default function Layout({ children }) { return <html><body>{children}</body></html>; }\n",
  );
  await writeFile(
    path.join(hostRoot, "app", "page.js"),
    "export default function Page() { return <main><h1>Next package fixture</h1></main>; }\n",
  );

  const port = await reserveLoopbackPort();
  const cliPath = path.join(
    consumerRoot,
    "node_modules",
    "@spotpatch",
    "next",
    "dist",
    "cli.js",
  );
  await run(process.execPath, [cliPath, "init"], { cwd: hostRoot });
  const child = spawn(
    process.execPath,
    [cliPath, "dev", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: hostRoot,
      env: { ...process.env, SPOTPATCH_AI_API_KEY: "q7-package-fixture-key" },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  const logs = [];
  child.stdout.on("data", (chunk) => logs.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => logs.push(Buffer.from(chunk)));
  try {
    const origin = `http://127.0.0.1:${String(port)}`;
    await waitForHttp(origin, child, () => Buffer.concat(logs).toString("utf8"));
    const page = await fetch(origin);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Next package fixture/);
    const bootstrap = await fetch(`${origin}/__spotpatch/v1/bootstrap`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        "Sec-Fetch-Site": "same-origin",
      },
      body: "{}",
    });
    assert.equal(bootstrap.status, 200, Buffer.concat(logs).toString("utf8"));
    const payload = await bootstrap.json();
    assert.equal(payload.data.framework, "next");
    assert.equal(payload.data.contextualAsk.enabled, true);
    const capability = await fetch(`${origin}/__spotpatch/v1/ask/capability`, {
      headers: {
        Origin: origin,
        "Sec-Fetch-Site": "same-origin",
        "X-SpotPatch-Token": payload.data.sessionToken,
      },
    });
    assert.equal(capability.status, 200, Buffer.concat(logs).toString("utf8"));
    const capabilityPayload = await capability.json();
    const executorKinds = capabilityPayload.data.executors.map(
      (executor) => executor.kind,
    );
    assert.deepEqual(executorKinds, ["configured-key", "managed-codex"]);
    assert.equal(capabilityPayload.data.executors[0].state, "ready");
    assert.equal(provider.turns(), 2);
  } finally {
    await stopChild(child);
    await provider.close();
  }

  await run(
    process.execPath,
    [path.join(consumerRoot, "node_modules", "next", "dist", "bin", "next"), "build"],
    { cwd: hostRoot },
  );
  const buildManifest = await readFile(
    path.join(hostRoot, ".next", "build-manifest.json"),
    "utf8",
  );
  for (const signature of SPOTPATCH_RESIDUE) assert(!buildManifest.includes(signature));
}

async function main() {
  const build = pnpmCommand(["--filter", "./packages/*", "build"]);
  await run(build.command, build.arguments_);
  const temporaryRoot = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "spotpatch-contextual-ask-beta-package-")),
  );
  const packRoot = path.join(temporaryRoot, "packs");
  const consumerRoot = path.join(temporaryRoot, "consumer");
  await Promise.all([
    mkdir(packRoot, { recursive: true }),
    mkdir(consumerRoot, { recursive: true }),
  ]);
  try {
    const tarballs = await packPackages(packRoot);
    await writeConsumer(consumerRoot, tarballs);
    await verifyDependencyTree(consumerRoot);
    await verifyExports(consumerRoot);
    await verifyBins(consumerRoot);
    await verifyViteHost(consumerRoot);
    await verifyNextHost(consumerRoot);
    process.stdout.write(
      `[spotpatch:q7] packed npm consumer passed on ${process.platform} / Node ${process.versions.node} / Vite ${HOST_MATRIX.vite} / Next ${HOST_MATRIX.next} / React ${HOST_MATRIX.react}.\n`,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

await main();
