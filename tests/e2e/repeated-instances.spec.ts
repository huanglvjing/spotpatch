import { expect, test } from "@playwright/test";

import { verifyRepeatedInstanceSelection } from "../helpers/repeated-instance-browser.js";

test("keeps shared React component instances distinct through selection and Prompt", async ({
  page,
}) => {
  await page.goto("/");
  await verifyRepeatedInstanceSelection(page);
  await page.getByRole("button", { name: "Back to edit" }).click();
  const third = page
    .getByTestId("repeated-card")
    .filter({ has: page.getByRole("heading", { name: "Product 3", exact: true }) });
  await page.getByRole("button", { name: "Reverse cards", exact: true }).click();
  await expect(third).toContainText("Product 3");
  const action = third.getByTestId("repeated-edit");
  await action.scrollIntoViewIfNeeded();
  const highlight = page.locator(
    '.spotpatch-selection-highlight[data-target-id="target-1"]',
  );
  await expect(highlight).toBeVisible();
  await expect
    .poll(async () => {
      const [targetBox, highlightBox] = await Promise.all([
        action.boundingBox(),
        highlight.boundingBox(),
      ]);
      return targetBox && highlightBox
        ? Math.max(
            Math.abs(targetBox.x - highlightBox.x),
            Math.abs(targetBox.y - highlightBox.y),
          )
        : Infinity;
    })
    .toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Recycle product 3", exact: true }).click();
  await expect(page.locator(".spotpatch-target-item").first()).toContainText(
    "Page content changed",
  );
  await expect(highlight).toHaveCount(0);
  await page.getByRole("button", { name: "Preview prompt" }).click();
  await expect(page.getByLabel("Generated prompt")).toContainText('"state":"changed"');
  await expect(page.getByLabel("Generated prompt")).not.toContainText("Product 103");
});
