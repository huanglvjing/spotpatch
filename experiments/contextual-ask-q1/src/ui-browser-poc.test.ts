import { mkdir } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

const bundlePath = path.resolve(
  import.meta.dirname,
  "../.artifacts/ui-bundle/ask-panel-poc.global.js",
);

test("renders a long cited answer at 320px and enlarged text", async ({ page }) => {
  const screenshotRoot = path.resolve(import.meta.dirname, "../.artifacts/screenshots");
  await mkdir(screenshotRoot, { recursive: true });
  await page.setContent(
    "<!doctype html><html><body><main id=app></main></body></html>",
  );
  await page.addScriptTag({ path: bundlePath });
  await page.evaluate(() => {
    const globalValue = globalThis as typeof globalThis & {
      SpotPatchAskPoc: {
        mountAskPanelPoc(options: {
          blocks: readonly unknown[];
          citations: readonly unknown[];
          host: HTMLElement;
          question: string;
        }): unknown;
      };
    };
    const host = document.createElement("spotpatch-ask-poc");
    document.querySelector("#app")?.append(host);
    globalValue.SpotPatchAskPoc.mountAskPanelPoc({
      host,
      question: "What is this selected component?",
      blocks: Array.from({ length: 40 }, (_, index) => ({
        kind: index % 8 === 0 ? "code" : "paragraph",
        text: `${String(index)} ${"Long contextual answer. ".repeat(38)}`,
        citations: [`source-${String(index)}`],
      })),
      citations: Array.from({ length: 64 }, (_, index) => ({
        sourceId: `source-${String(index)}`,
        path: `src/components/Component${String(index)}.tsx`,
        startLine: index + 1,
        endLine: index + 3,
      })),
    });
  });

  const host = page.locator("spotpatch-ask-poc");
  await expect(host.locator(".answer-block")).toHaveCount(40);
  await expect(host.locator(".source-link")).toHaveCount(64);
  await expect(host.locator(".mode-tab").first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: path.join(screenshotRoot, "ask-320.png"),
    fullPage: true,
  });

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await expect(host.locator("textarea")).toBeVisible();
  await page.screenshot({
    path: path.join(screenshotRoot, "ask-320-text-200.png"),
    fullPage: true,
  });
});
