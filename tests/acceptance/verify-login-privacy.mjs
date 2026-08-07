import assert from "node:assert/strict";

import { chromium } from "@playwright/test";

const baseUrl = process.argv[2];

if (baseUrl === undefined) {
  throw new Error("Usage: verify-login-privacy.mjs <base-url>");
}

const secrets = Object.freeze({
  pageToken: "acceptance-page-token-secret",
  password: "acceptance-password-secret",
  username: "13900001234",
});
const loginUrl = new URL("/login", baseUrl);
loginUrl.searchParams.set("redirect", "/private-callback");
loginUrl.searchParams.set("token", secrets.pageToken);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const pageErrors = [];
page.on("pageerror", (error) => {
  pageErrors.push(error.message);
});

try {
  await page.goto(loginUrl.toString(), {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "密码登录" }).click();
  await page.locator('input[type="text"]').first().fill(secrets.username);
  await page.locator('input[type="password"]').fill(secrets.password);

  const form = page.locator("form");
  await form.waitFor({ state: "visible" });
  const formPoint = await form.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const step = 4;

    for (let y = rect.top + step; y < rect.bottom; y += step) {
      for (let x = rect.left + step; x < rect.right; x += step) {
        if (document.elementFromPoint(x, y) === element) {
          return { x, y };
        }
      }
    }

    return undefined;
  });

  assert.notEqual(formPoint, undefined, "The form had no directly selectable area.");
  await page.getByRole("button", { name: "Select element" }).click();
  await page.mouse.click(formPoint?.x ?? 0, formPoint?.y ?? 0);

  const selectedDialog = page.getByRole("dialog", {
    name: "Plan the change",
  });
  await selectedDialog.waitFor({ state: "visible" });
  const summary = selectedDialog.locator(".spotpatch-summary");
  await assert.doesNotReject(async () => {
    await summary.waitFor({ state: "attached" });
  });
  await page.waitForFunction(() => {
    const root = document.querySelector("spotpatch-root")?.shadowRoot;
    return root
      ?.querySelector(".spotpatch-summary")
      ?.textContent.includes("Browser context: ready");
  });
  const summaryText = (await summary.textContent()) ?? "";
  await selectedDialog
    .locator("textarea[data-target-instruction-id]")
    .fill("Review the login layout without exposing credentials.");
  const previewButton = selectedDialog.getByRole("button", {
    name: "Preview prompt",
  });
  await previewButton.waitFor({ state: "visible" });
  assert.equal(await previewButton.isEnabled(), true);
  await previewButton.click();

  const prompt =
    (await page
      .getByRole("dialog", { name: "Review the request" })
      .getByLabel("Generated prompt")
      .textContent()) ?? "";
  const leakedSecrets = Object.values(secrets).filter((secret) =>
    prompt.includes(secret),
  );
  const result = {
    absolutePathLeaked: prompt.includes("/Users/"),
    confidence: summaryText.match(/Confidence: (\w+)/u)?.[1],
    leakedSecretCount: leakedSecrets.length,
    pageErrorCount: pageErrors.length,
    pathname: loginUrl.pathname,
    promptLength: prompt.length,
    redactionMarkerPresent:
      prompt.includes("[redacted]") || prompt.includes("%5Bredacted%5D"),
    runtimeCount: await page.locator("spotpatch-root").count(),
  };

  console.log(JSON.stringify(result, null, 2));
  assert.equal(result.absolutePathLeaked, false);
  assert.equal(result.leakedSecretCount, 0);
  assert.equal(result.pageErrorCount, 0);
  assert.equal(result.redactionMarkerPresent, true);
  assert.equal(result.runtimeCount, 1);
} finally {
  await browser.close();
}
