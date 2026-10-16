import { expect, test } from "@playwright/test";

import { verifyRepeatedInstanceSelection } from "../helpers/repeated-instance-browser.js";

test("preserves distinct native Astro instances and restores them as historical snapshots", async ({
  page,
}) => {
  await page.goto("/models/repeated/");
  await verifyRepeatedInstanceSelection(page);
  await page.reload();
  await expect(page.locator(".spotpatch-target-item")).toHaveCount(2);
  await expect(page.locator(".spotpatch-target-item").first()).toContainText(
    "Restored snapshot",
  );
  await expect(page.locator(".spotpatch-selection-highlight")).toHaveCount(0);
  await page.getByRole("button", { name: "Add element" }).click();
  await page.getByTestId("repeated-edit").nth(2).click();
  await expect(page.locator(".spotpatch-target-item")).toHaveCount(3);
});
