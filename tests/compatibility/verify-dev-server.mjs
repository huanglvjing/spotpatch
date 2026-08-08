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
  const clientPath = html.match(/src="([^"]*spotpatch[^"]*)"/u)?.[1];
  assert.notEqual(clientPath, undefined);

  const sourceResponse = await fetch(`${origin}/src/main.jsx`);
  assert.equal(sourceResponse.status, 200);
  const transformedSource = await sourceResponse.text();
  const marker = transformedSource.match(/([A-Za-z0-9_-]+:\d+:\d+)/u)?.[1];
  assert.notEqual(marker, undefined);

  const runtimeResponse = await fetch(new URL(clientPath, origin));
  assert.equal(runtimeResponse.status, 200);
  const runtimeSource = await runtimeResponse.text();
  const expectedViteVersion = packageManifest.dependencies.vite;
  assert.match(
    runtimeSource,
    new RegExp(`"viteVersion":"${expectedViteVersion.replaceAll(".", "\\.")}"`, "u"),
  );
  const sessionToken = runtimeSource.match(/"sessionToken":"([^"]+)"/u)?.[1];
  assert.notEqual(sessionToken, undefined);

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
} finally {
  await server.close();
}
