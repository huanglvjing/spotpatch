import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";
import { spotPatch } from "@spotpatch/vite";
import react from "@vitejs/plugin-react-swc";
import { createServer, type ViteDevServer } from "vite";

const renderSource = (version: 1 | 2): string => {
  const linePadding = version === 1 ? "" : "\n\n";

  return `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function App() {
  return (${linePadding}
    <main>
      <p data-testid="hmr-target">HMR version ${String(version)}</p>
    </main>
  );
}

createRoot(document.querySelector("#root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`;
};

test("updates source lines through HMR without duplicating the runtime", async ({
  page,
}) => {
  const projectRoot = await mkdtemp(
    path.join(path.resolve("playgrounds/minimal-react-18"), ".spotpatch-hmr-"),
  );
  const sourceDirectory = path.join(projectRoot, "src");
  const sourceFile = path.join(sourceDirectory, "main.tsx");
  let server: ViteDevServer | undefined;

  try {
    await mkdir(sourceDirectory, { recursive: true });
    await writeFile(
      path.join(projectRoot, "index.html"),
      '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
      "utf8",
    );
    await writeFile(sourceFile, renderSource(1), "utf8");

    server = await createServer({
      configFile: false,
      root: projectRoot,
      logLevel: "silent",
      plugins: [spotPatch(), react()],
      server: {
        host: "127.0.0.1",
        port: 0,
        strictPort: false,
      },
    });
    await server.listen();
    const address = server.httpServer?.address();

    if (address === null || address === undefined || typeof address === "string") {
      throw new Error("The HMR fixture server did not expose a TCP port.");
    }

    await page.goto(`http://127.0.0.1:${String(address.port)}/`);
    const target = page.getByTestId("hmr-target");
    await expect(target).toHaveText("HMR version 1");
    const initialMarker = await target.getAttribute("data-spotpatch-source");
    expect(initialMarker).toMatch(/^[A-Za-z0-9_-]+:\d+:\d+$/u);

    await writeFile(sourceFile, renderSource(2), "utf8");

    await expect(target).toHaveText("HMR version 2");
    await expect
      .poll(() => target.getAttribute("data-spotpatch-source"))
      .not.toBe(initialMarker);
    const updatedMarker = await target.getAttribute("data-spotpatch-source");
    const initialParts = initialMarker?.split(":") ?? [];
    const updatedParts = updatedMarker?.split(":") ?? [];

    expect(updatedParts[0]).toBe(initialParts[0]);
    expect(updatedParts[1]).not.toBe(initialParts[1]);
    await expect(page.locator("spotpatch-root")).toHaveCount(1);
  } finally {
    await server?.close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});
