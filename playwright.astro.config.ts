import { defineConfig, devices } from "@playwright/test";

const LOOPBACK_PROXY_BYPASS = "127.0.0.1,localhost,::1";

/**
 * Playwright probes every `webServer.url` before it starts the test workers.
 * Some Windows CI images expose HTTP(S)_PROXY without loopback in NO_PROXY,
 * which routes that probe to the proxy and makes a healthy local Astro server
 * look unavailable. Keep the existing user value and add the only hosts used
 * by this test harness.
 */
function bypassProxyForLoopback(): void {
  for (const name of ["NO_PROXY", "no_proxy"] as const) {
    const existing = process.env[name]?.trim();
    process.env[name] =
      existing === undefined || existing.length === 0
        ? LOOPBACK_PROXY_BYPASS
        : `${existing},${LOOPBACK_PROXY_BYPASS}`;
  }
}

bypassProxyForLoopback();

export default defineConfig({
  testDir: "./tests/astro",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  use: { ...devices["Desktop Chrome"], trace: "retain-on-failure" },
  projects: [5, 6, 7].map((version) => ({
    name: `astro${String(version)}`,
    use: { baseURL: `http://127.0.0.1:${String(4322 + version)}` },
  })),
  webServer: [5, 6, 7].map((version) => ({
    command: `pnpm --filter @spotpatch/compat-astro${String(version)} dev --host 127.0.0.1 --port ${String(4322 + version)}`,
    url: `http://127.0.0.1:${String(4322 + version)}/models/`,
    reuseExistingServer: false,
    timeout: 60_000,
  })),
});
