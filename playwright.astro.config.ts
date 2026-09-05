import { defineConfig, devices } from "@playwright/test";

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
