import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    host: { type: "string", default: "127.0.0.1" },
    port: { type: "string", default: "4329" },
  },
});
const fromFixture = createRequire(path.join(process.cwd(), "package.json"));
const { dev } = await import(pathToFileURL(fromFixture.resolve("astro")).href);
// Astro 7's CLI may daemonize when launched by an agent. Own the server directly
// so Playwright and Ctrl+C have one observable, awaited lifecycle on every version.
const server = await dev({ server: { host: values.host, port: Number(values.port) } });
let closing;
function close() {
  closing ??= server.stop();
  closing.catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
process.once("SIGINT", close);
process.once("SIGTERM", close);
