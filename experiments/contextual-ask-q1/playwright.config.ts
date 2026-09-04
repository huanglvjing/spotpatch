import { fileURLToPath } from "node:url";

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: fileURLToPath(new URL("./src", import.meta.url)),
  testMatch: "ui-browser-poc.test.ts",
  outputDir: ".artifacts/playwright-output",
  reporter: [["list"]],
  use: {
    browserName: "chromium",
    headless: true,
    viewport: { width: 320, height: 720 },
  },
});
