import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import probeContract from "../loader/probe-contract.json";

export const STRESS_MODULE_COUNT = 500;
export const STRESS_ROUTE_SEGMENT = "spotpatch-loader-stress";

const FILE_WRITE_CONCURRENCY = 32;

function getModuleIdentity(index: number): string {
  return String(index).padStart(4, "0");
}

function createStressModuleSource(index: number): string {
  const identity = getModuleIdentity(index);

  return `export function StressModule${identity}() {
  return (
    <li
      ${probeContract.attributeName}=${JSON.stringify(probeContract.inactiveValue)}
      data-stress-module=${JSON.stringify(identity)}
    >
      Stress module ${identity}
    </li>
  );
}
`;
}

function createStressPageSource(): string {
  const imports: string[] = [];
  const elements: string[] = [];

  for (let index = 0; index < STRESS_MODULE_COUNT; index += 1) {
    const identity = getModuleIdentity(index);
    imports.push(
      `import { StressModule${identity} } from "./modules/stress-module-${identity}";`,
    );
    elements.push(`        <StressModule${identity} />`);
  }

  return `${imports.join("\n")}

export default function StressPage() {
  return (
    <main ${probeContract.attributeName}=${JSON.stringify(probeContract.inactiveValue)}>
      <h1>SpotPatch Loader stress fixture</h1>
      <ol data-stress-module-count={${String(STRESS_MODULE_COUNT)}}>
${elements.join("\n")}
      </ol>
    </main>
  );
}
`;
}

async function writeInBatches(
  inputs: readonly { readonly path: string; readonly source: string }[],
): Promise<void> {
  for (let offset = 0; offset < inputs.length; offset += FILE_WRITE_CONCURRENCY) {
    const batch = inputs.slice(offset, offset + FILE_WRITE_CONCURRENCY);
    await Promise.all(
      batch.map((input) => writeFile(input.path, input.source, "utf8")),
    );
  }
}

export async function generateStressFixture(workDirectory: string): Promise<void> {
  const routeDirectory = path.join(workDirectory, "app", STRESS_ROUTE_SEGMENT);
  const modulesDirectory = path.join(routeDirectory, "modules");
  await mkdir(modulesDirectory, { recursive: true });

  const modules = Array.from({ length: STRESS_MODULE_COUNT }, (_unused, index) => {
    const identity = getModuleIdentity(index);

    return Object.freeze({
      path: path.join(modulesDirectory, `stress-module-${identity}.tsx`),
      source: createStressModuleSource(index),
    });
  });

  await writeInBatches(modules);
  await writeFile(
    path.join(routeDirectory, "page.tsx"),
    createStressPageSource(),
    "utf8",
  );
}
