import assert from "node:assert/strict";

import { chromium } from "@playwright/test";

const baseUrl = process.argv[2];

if (baseUrl === undefined) {
  throw new Error("Usage: verify-antd-portal.mjs <base-url>");
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const pageErrors = [];
page.on("pageerror", (error) => {
  pageErrors.push(error.message);
});

const selectAndReadSummary = async (target) => {
  await page.getByRole("button", { name: "Select element" }).click();
  await target.click();
  const dialog = page.getByRole("dialog", { name: "Plan the change" });
  await dialog.waitFor({ state: "visible" });
  const summary = dialog.locator(".spotpatch-summary");
  await page.waitForFunction(() => {
    const root = document.querySelector("spotpatch-root")?.shadowRoot;
    const text = root?.querySelector(".spotpatch-summary")?.textContent ?? "";
    return (
      /Browser context: (?:failed|ready)/u.test(text) && !text.includes("API: loading")
    );
  });
  const text = (await summary.textContent()) ?? "";
  await dialog.getByRole("button", { name: "Close" }).click();
  return text;
};

try {
  await page.goto(new URL("/about", baseUrl).toString(), {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  const cooperationButton = page.getByRole("button", { name: "我要合作" });
  const buttonSummary = await selectAndReadSummary(cooperationButton);

  await cooperationButton.click();
  const modal = page.locator(".ant-modal");
  await modal.waitFor({ state: "visible" });
  const portalPlacement = await modal.evaluate((element) => {
    const portalRoot = element.closest(".ant-modal-root");
    const applicationRoot = document.querySelector("#root");
    return {
      outsideApplicationRoot:
        portalRoot !== null && applicationRoot?.contains(portalRoot) === false,
      underBody: portalRoot !== null && document.body.contains(portalRoot),
    };
  });
  const modalSummary = await selectAndReadSummary(modal.locator(".ant-modal-title"));
  const read = (text, prefix) =>
    text
      .split("\n")
      .find((line) => line.startsWith(prefix))
      ?.slice(prefix.length);
  const result = {
    buttonConfidence: read(buttonSummary, "Confidence: ")?.split(" ", 1)[0],
    buttonOrigin: read(buttonSummary, "Origin: "),
    buttonSourceAvailable: read(buttonSummary, "Source: ") !== "Unavailable",
    modalConfidence: read(modalSummary, "Confidence: ")?.split(" ", 1)[0],
    modalOrigin: read(modalSummary, "Origin: "),
    modalSourceAvailable: read(modalSummary, "Source: ") !== "Unavailable",
    outsideApplicationRoot: portalPlacement.outsideApplicationRoot,
    pageErrorCount: pageErrors.length,
    portalUnderBody: portalPlacement.underBody,
    runtimeCount: await page.locator("spotpatch-root").count(),
  };

  console.log(JSON.stringify(result, null, 2));
  assert.equal(result.buttonConfidence, "probable");
  assert.equal(result.buttonOrigin, "react-fiber");
  assert.equal(result.buttonSourceAvailable, true);
  assert.equal(result.modalConfidence, "probable");
  assert.equal(result.modalOrigin, "react-fiber");
  assert.equal(result.modalSourceAvailable, true);
  assert.equal(result.outsideApplicationRoot, true);
  assert.equal(result.pageErrorCount, 0);
  assert.equal(result.portalUnderBody, true);
  assert.equal(result.runtimeCount, 1);
} finally {
  await browser.close();
}
