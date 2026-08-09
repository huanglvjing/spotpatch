import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { injectSourceMarkers } = require("../dist/index.cjs");
const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const absolutePath = path.join(packageRoot, "src", "cjs-smoke.tsx");
const result = injectSourceMarkers({
  absolutePath,
  code: "export const CjsSmoke = () => <main />;\n",
  fileId: "cjs-smoke",
  root: packageRoot,
});

assert.ok(result, "The compiler CJS entry did not transform JSX.");
assert.match(result.code, /data-spotpatch-source="cjs-smoke:1:31"/u);
