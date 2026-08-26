"use strict";

const path = require("node:path");

const spotPatchNextLoader = require("../loader.cjs");

const epoch = "epoch_cjs_loader_smoke_01";
const fileId = "file_cjs_loader_smoke_01";
const source = "export const view = <main>Loader smoke test</main>;";
const resourcePath = path.join(process.cwd(), "src", "loader-smoke-fixture.tsx");
const warnings = [];
let callbackCount = 0;
let cacheableValue;

process.env.SPOTPATCH_NEXT_APP_ROOT = process.cwd();
process.env.SPOTPATCH_NEXT_BUNDLER = "webpack";
process.env.SPOTPATCH_NEXT_INTERNAL_ORIGIN = "http://127.0.0.1:43122";
process.env.SPOTPATCH_NEXT_INTERNAL_SECRET = "cjs-loader-smoke-secret";
process.env.SPOTPATCH_NEXT_REGISTRY_EPOCH = epoch;

globalThis.fetch = async () => {
  const body = JSON.stringify({ epoch, fileId });
  return new Response(body, {
    status: 200,
    headers: { "Content-Length": String(Buffer.byteLength(body)) },
  });
};

async function main() {
  const output = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("The built CJS Loader did not complete."));
    }, 3_000);

    spotPatchNextLoader.call(
      {
        resourcePath,
        async() {
          return (error, transformedSource, sourceMap) => {
            callbackCount += 1;
            clearTimeout(timer);

            if (error !== null) {
              reject(error);
              return;
            }

            resolve({ source: transformedSource, sourceMap });
          };
        },
        cacheable(value) {
          cacheableValue = value;
        },
        emitWarning(warning) {
          warnings.push(warning);
        },
        getOptions() {
          return { mode: "source", registryEpoch: epoch };
        },
      },
      source,
      undefined,
      undefined,
    );
  });

  if (
    callbackCount !== 1 ||
    cacheableValue !== true ||
    warnings.length !== 0 ||
    typeof output.source !== "string" ||
    !output.source.includes(`data-spotpatch-source="${fileId}:1:`) ||
    typeof output.sourceMap !== "object" ||
    output.sourceMap === null
  ) {
    throw new Error("The built CJS Loader failed its marker smoke test.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
